// Ownership of data that hangs off a SHARED post row: metrics history (GET /posts/:shortcode/history)
// and comments (POST /comments, POST /comments/log).
const request = require('supertest');
const express = require('express');
const pool = require('../../db');
const postsRouter = require('../../routes/posts');
const commentsRouter = require('../../routes/comments');

jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));
jest.mock('../../utils/videoSync', () => ({
    syncHiddenAcrossTables: jest.fn().mockResolvedValue(undefined)
}));

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 1 }; next(); });
app.use('/api', postsRouter);
app.use('/api', commentsRouter);

// checkPostAccess is the only query containing UNION ALL; "has" decides whether it finds a row.
function postAccess(has, other = {}) {
    pool.query.mockImplementation(async (sql) => {
        if (sql.includes('UNION ALL')) return { rows: has ? [{ '?column?': 1 }] : [] };
        for (const [needle, rows] of Object.entries(other)) if (sql.includes(needle)) return { rows };
        return { rows: [] };
    });
}
const ranSql = (needle) => pool.query.mock.calls.some(([s]) => s.includes(needle));

describe('post-attached data — ownership', () => {
    let client;
    beforeEach(() => {
        jest.clearAllMocks();
        client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
        pool.connect.mockResolvedValue(client);
    });

    describe('GET /api/posts/:shortcode/history', () => {
        it('404s when the caller does not have the post and never reads its history', async () => {
            postAccess(false);
            const res = await request(app).get('/api/posts/abc/history');
            expect(res.status).toBe(404);
            expect(res.body).toEqual({ success: false, error: 'Not found' });
            expect(ranSql('FROM post_metrics_history')).toBe(false);
        });

        it('checks both project links and the caller\'s saved posts for the right user', async () => {
            postAccess(true, { 'FROM post_metrics_history': [] });
            await request(app).get('/api/posts/abc/history');
            const [sql, params] = pool.query.mock.calls.find(([s]) => s.includes('UNION ALL'));
            expect(sql).toContain('project_posts');
            expect(sql).toContain('user_scraped_posts');
            expect(params).toEqual(['abc', 1]);
        });

        it('returns the history in the same shape for a post the caller has', async () => {
            postAccess(true, { 'FROM post_metrics_history': [{ likes_count: 5 }] });
            const res = await request(app).get('/api/posts/abc/history');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, shortcode: 'abc', history: [{ likes_count: 5 }], snapshots: 1 });
        });
    });

    describe('POST /api/comments', () => {
        const body = { post_shortcode: 'abc', comments: [{ id: 'c1', text: 'hi' }] };

        it('404s and writes nothing when the caller does not have the post', async () => {
            postAccess(false);
            const res = await request(app).post('/api/comments').send(body);
            expect(res.status).toBe(404);
            expect(client.query).not.toHaveBeenCalledWith('BEGIN');
            expect(client.release).toHaveBeenCalled();
        });

        it('saves comments exactly as before for a post the caller has', async () => {
            postAccess(true);
            client.query.mockImplementation(async (sql) => (String(sql).includes('INSERT INTO comments') ? { rows: [{ is_insert: true }] } : { rows: [] }));
            const res = await request(app).post('/api/comments').send(body);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, post_shortcode: 'abc', inserted: 1, updated: 0, total: 1 });
            expect(client.query).toHaveBeenLastCalledWith('COMMIT');
        });
    });

    describe('POST /api/comments/log', () => {
        it('404s and logs nothing when the caller does not have the post', async () => {
            postAccess(false);
            const res = await request(app).post('/api/comments/log').send({ post_shortcode: 'abc', api_calls: 2 });
            expect(res.status).toBe(404);
            expect(ranSql('INSERT INTO comment_scrape_logs')).toBe(false);
        });

        it('logs for a post the caller has', async () => {
            postAccess(true, { 'INSERT INTO comment_scrape_logs': [{ id: 'l1' }] });
            const res = await request(app).post('/api/comments/log').send({ post_shortcode: 'abc', api_calls: 2 });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, log: { id: 'l1' } });
        });
    });
});
