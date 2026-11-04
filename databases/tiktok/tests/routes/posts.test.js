const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');
const postsRouter = require('../../routes/posts');
const pool = require('../../db');
const { syncHiddenAcrossTables } = require('../../utils/videoSync');

jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));
jest.mock('../../utils/videoSync', () => ({
    syncHiddenAcrossTables: jest.fn()
}));

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 1 }; next(); });
app.use('/api', postsRouter);

const PROJ = '22222222-2222-4222-8222-222222222222';
const sqlOf = (client) => client.query.mock.calls.map((c) => String(c[0]));

describe('posts — per-project hide + soft delete', () => {
    let mockClient;

    beforeEach(() => {
        jest.clearAllMocks();
        syncHiddenAcrossTables.mockReset();
        pool.query.mockReset();
        mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
        pool.connect.mockResolvedValue(mockClient);
    });

    describe('PATCH /api/posts/:shortcode/hide', () => {
        it('404s and rolls back when the caller has the post in none of their projects', async () => {
            syncHiddenAcrossTables.mockResolvedValueOnce({ posts: 0, videos: 0, projectIds: [] });

            const res = await request(app).patch('/api/posts/abc123/hide').send({ is_hidden: true });

            expect(res.status).toBe(404);
            expect(mockClient.query).toHaveBeenLastCalledWith('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('without project_id hides in every project of the caller, never touching the shared posts row', async () => {
            syncHiddenAcrossTables.mockResolvedValueOnce({ posts: 2, videos: 1, projectIds: ['a', 'b'] });

            const res = await request(app).patch('/api/posts/abc123/hide').send({ is_hidden: true });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, shortcode: 'abc123', is_hidden: true });
            expect(syncHiddenAcrossTables).toHaveBeenCalledWith(mockClient, 'abc123', 1, true, null);
            expect(sqlOf(mockClient)).toEqual(['BEGIN', 'COMMIT']);
            expect(sqlOf(mockClient).join(' ')).not.toMatch(/UPDATE posts/);
        });

        it('with project_id (body) changes only that project, after an ownership check', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ id: PROJ }] }); // checkProjectOwnership
            syncHiddenAcrossTables.mockResolvedValueOnce({ posts: 1, videos: 0, projectIds: [PROJ] });

            const res = await request(app).patch('/api/posts/abc123/hide').send({ is_hidden: true, project_id: PROJ });

            expect(res.status).toBe(200);
            expect(pool.query.mock.calls[0][1]).toEqual([PROJ, 1]);
            expect(syncHiddenAcrossTables).toHaveBeenCalledWith(mockClient, 'abc123', 1, true, [PROJ]);
        });

        it('accepts project_id in the query string too', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ id: PROJ }] });
            syncHiddenAcrossTables.mockResolvedValueOnce({ posts: 1, videos: 0, projectIds: [PROJ] });

            const res = await request(app).patch(`/api/posts/abc123/hide?project_id=${PROJ}`).send({});

            expect(res.status).toBe(200);
            expect(syncHiddenAcrossTables).toHaveBeenCalledWith(mockClient, 'abc123', 1, true, [PROJ]);
        });

        it('404s without changing anything when the project belongs to someone else', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] }); // checkProjectOwnership: not theirs

            const res = await request(app).patch('/api/posts/abc123/hide').send({ project_id: PROJ });

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Project not found');
            expect(syncHiddenAcrossTables).not.toHaveBeenCalled();
            expect(mockClient.query).not.toHaveBeenCalled();
        });

        it('400s on a malformed project_id without any query', async () => {
            const res = await request(app).patch('/api/posts/abc123/hide').send({ project_id: 'nope' });

            expect(res.status).toBe(400);
            expect(pool.query).not.toHaveBeenCalled();
            expect(syncHiddenAcrossTables).not.toHaveBeenCalled();
        });

        it('unhide passes false to the sync, which also clears deleted_at on those project rows', async () => {
            syncHiddenAcrossTables.mockResolvedValueOnce({ posts: 1, videos: 0, projectIds: ['a'] });

            const res = await request(app).patch('/api/posts/abc123/hide').send({ is_hidden: false });

            expect(res.status).toBe(200);
            expect(res.body.is_hidden).toBe(false);
            expect(syncHiddenAcrossTables).toHaveBeenCalledWith(mockClient, 'abc123', 1, false, null);
        });
    });

    describe('DELETE /api/posts/:shortcode', () => {
        it('404s and rolls back when the caller has no project with the post', async () => {
            syncHiddenAcrossTables.mockResolvedValueOnce({ posts: 0, videos: 0, projectIds: [] });

            const res = await request(app).delete('/api/posts/abc123');

            expect(res.status).toBe(404);
            expect(mockClient.query).toHaveBeenLastCalledWith('ROLLBACK');
        });

        it('soft-deletes only the project rows the hide matched, not the shared post', async () => {
            syncHiddenAcrossTables.mockResolvedValueOnce({ posts: 2, videos: 1, projectIds: ['a', 'b'] });

            const res = await request(app).delete('/api/posts/abc123');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, shortcode: 'abc123' });
            expect(syncHiddenAcrossTables).toHaveBeenCalledWith(mockClient, 'abc123', 1, true, null);
            const upd = mockClient.query.mock.calls.find((c) => String(c[0]).includes('UPDATE project_posts'));
            expect(upd[0]).toMatch(/SET deleted_at = CURRENT_TIMESTAMP/);
            expect(upd[1]).toEqual(['abc123', ['a', 'b']]);
            expect(sqlOf(mockClient).join(' ')).not.toMatch(/UPDATE posts/);
            expect(mockClient.query).toHaveBeenLastCalledWith('COMMIT');
        });

        it('scopes to one project when project_id is given', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ id: PROJ }] });
            syncHiddenAcrossTables.mockResolvedValueOnce({ posts: 1, videos: 0, projectIds: [PROJ] });

            const res = await request(app).delete(`/api/posts/abc123?project_id=${PROJ}`);

            expect(res.status).toBe(200);
            expect(syncHiddenAcrossTables).toHaveBeenCalledWith(mockClient, 'abc123', 1, true, [PROJ]);
        });
    });

    describe('listings read the project flags, not the shared posts row', () => {
        const listing = async (url) => {
            pool.query.mockResolvedValueOnce({ rows: [] });                 // posts
            pool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });   // count
            const res = await request(app).get(url);
            expect(res.status).toBe(200);
            return pool.query.mock.calls.map((c) => String(c[0]));
        };

        it('GET /api/posts?project_id filters on project_posts is_hidden / deleted_at', async () => {
            const [list, count] = await listing(`/api/posts?project_id=${PROJ}`);
            for (const sql of [list, count]) {
                expect(sql).toMatch(/ppo\.is_hidden = false AND ppo\.deleted_at IS NULL/);
                expect(sql).not.toMatch(/p\.is_hidden|p\.deleted_at/);
            }
        });

        it('GET /api/posts (user-wide) hides a post only when ALL of the caller\'s project rows are hidden', async () => {
            const [list, count] = await listing('/api/posts');
            for (const sql of [list, count]) {
                expect(sql).toMatch(/NOT \(\s*EXISTS \(SELECT 1 FROM project_posts x/);
                expect(sql).toMatch(/AND NOT EXISTS \(SELECT 1 FROM project_posts x[\s\S]*x\.is_hidden = false AND x\.deleted_at IS NULL/);
                expect(sql).not.toMatch(/p\.is_hidden|p\.deleted_at/);
            }
        });

        it('GET /api/posts/hidden?project_id lists that project\'s hidden rows', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });
            await request(app).get(`/api/posts/hidden?project_id=${PROJ}`);
            const sql = String(pool.query.mock.calls[0][0]);
            expect(sql).toMatch(/ppo\.is_hidden = true/);
            expect(sql).toMatch(/ORDER BY ppo\.hidden_at DESC/);
            expect(sql).not.toMatch(/p\.is_hidden/);
        });

        it('GET /api/posts/hidden (user-wide) lists exactly what the user-wide listing hides', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });
            await request(app).get('/api/posts/hidden');
            const sql = String(pool.query.mock.calls[0][0]);
            expect(sql).toMatch(/JOIN LATERAL/);
            expect(sql).toMatch(/agg\.links > 0 AND agg\.visible = 0/);
            expect(sql).not.toMatch(/p\.is_hidden = true/);
        });
    });

    describe('migration v6_project_post_hide.sql', () => {
        const sql = fs.readFileSync(path.join(__dirname, '../../migrations/v6_project_post_hide.sql'), 'utf8');

        it('adds visible-by-default per-project columns, so a re-created project starts clean', () => {
            expect(sql).toMatch(/ADD COLUMN is_hidden\s+boolean\s+NOT NULL DEFAULT false/);
            expect(sql).toMatch(/ADD COLUMN hidden_at\s+timestamptz/);
            expect(sql).toMatch(/ADD COLUMN deleted_at\s+timestamptz/);
        });

        it('is idempotent and never drops the old posts columns', () => {
            expect(sql).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM information_schema\.columns/);
            expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/);
            expect(sql).not.toMatch(/DROP COLUMN/i);
        });
    });
});
