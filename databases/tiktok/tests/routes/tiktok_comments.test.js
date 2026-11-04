const request = require('supertest');
const express = require('express');
const pool = require('../../db');
const commentsRouter = require('../../routes/tiktok_comments');

jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 1 }; next(); });
app.use('/api', commentsRouter);

const KEYWORD = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';

// Answers pool.query by SQL fragment; anything unmatched returns no rows.
function answer(rules) {
    pool.query.mockImplementation(async (sql, params) => {
        for (const [needle, rows] of rules) {
            if (sql.includes(needle)) return { rows: typeof rows === 'function' ? rows(params) : rows };
        }
        return { rows: [] };
    });
}
const ranSql = (needle) => pool.query.mock.calls.some(([sql]) => sql.includes(needle));

describe('tiktok comments — ownership', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('GET /api/tiktok/comments', () => {
        it('404s for a keyword the caller does not own and never reads comments', async () => {
            answer([]); // ownership lookup finds nothing
            const res = await request(app).get(`/api/tiktok/comments?keyword_id=${KEYWORD}`);
            expect(res.status).toBe(404);
            expect(res.body).toEqual({ success: false, error: 'Not found' });
            expect(ranSql('SELECT * FROM tiktok_comments')).toBe(false);
        });

        it('returns the comments of an owned keyword in the same shape as before', async () => {
            answer([
                ['SELECT * FROM tiktok_comments', [{ id: 'c1', text: 'hi' }]],
                ['search_keywords sk', [{ id: KEYWORD, project_id: PROJECT }]],
            ]);
            const res = await request(app).get(`/api/tiktok/comments?keyword_id=${KEYWORD}`);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, comments: [{ id: 'c1', text: 'hi' }] });
        });

        it('404s for a video the caller does not own and never reads comments', async () => {
            answer([]);
            const res = await request(app).get('/api/tiktok/comments?video_id=v9');
            expect(res.status).toBe(404);
            expect(ranSql('SELECT * FROM tiktok_comments')).toBe(false);
        });

        it('for an owned video, still leaves out comments captured under other users\' keywords', async () => {
            answer([
                ['SELECT * FROM tiktok_comments', [{ id: 'c1' }]],
                ['FROM tiktok_videos v', [{ id: 'row' }]],
            ]);
            const res = await request(app).get('/api/tiktok/comments?video_id=v1');
            expect(res.status).toBe(200);
            const [sql, params] = pool.query.mock.calls.find(([s]) => s.includes('SELECT * FROM tiktok_comments'));
            expect(sql).toContain('p.user_id = $2');
            expect(params).toEqual(['v1', 1]);
        });

        it('still 400s when neither keyword_id nor video_id is given', async () => {
            const res = await request(app).get('/api/tiktok/comments');
            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/tiktok/comments/batch', () => {
        let client;
        beforeEach(() => {
            client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
            pool.connect.mockResolvedValue(client);
        });
        const body = (extra = {}) => ({ video_id: 'v1', comments: [{ id: 'c1', text: 'x' }], ...extra });

        it('404s and writes nothing when the keyword is not the caller\'s', async () => {
            answer([]);
            const res = await request(app).post('/api/tiktok/comments/batch').send(body({ keyword_id: KEYWORD }));
            expect(res.status).toBe(404);
            expect(client.query).not.toHaveBeenCalledWith('BEGIN');
            expect(client.query.mock.calls.some(([s]) => String(s).includes('INSERT INTO tiktok_comments'))).toBe(false);
            expect(client.release).toHaveBeenCalled();
        });

        it('404s and writes nothing when the video is not the caller\'s', async () => {
            answer([['search_keywords sk', [{ id: KEYWORD, project_id: PROJECT }]]]); // keyword ok, video not
            const res = await request(app).post('/api/tiktok/comments/batch').send(body({ keyword_id: KEYWORD }));
            expect(res.status).toBe(404);
            expect(client.query).not.toHaveBeenCalledWith('BEGIN');
        });

        it('saves the comments and scopes the status update to the caller and keyword', async () => {
            answer([
                ['search_keywords sk', [{ id: KEYWORD, project_id: PROJECT }]],
                ['FROM tiktok_videos v', [{ id: 'row' }]],
            ]);
            const res = await request(app).post('/api/tiktok/comments/batch').send(body({ keyword_id: KEYWORD }));
            expect(res.status).toBe(200);
            const update = client.query.mock.calls.find(([s]) => String(s).includes('UPDATE tiktok_videos'));
            expect(update[0]).toContain('p.user_id = $2');
            expect(update[1]).toEqual(['v1', 1, KEYWORD]);
            expect(client.query).toHaveBeenLastCalledWith('COMMIT');
        });
    });

    describe('POST /api/tiktok/graphql_captures', () => {
        const capture = (extra = {}) => ({ url: 'https://x', ...extra });

        it('404s and inserts nothing when the session is not the caller\'s', async () => {
            answer([['search_keywords sk', [{ id: KEYWORD, project_id: PROJECT }]]]); // keyword ok, session not
            const res = await request(app).post('/api/tiktok/graphql_captures')
                .send(capture({ keyword_id: KEYWORD, session_id: '33333333-3333-4333-8333-333333333333' }));
            expect(res.status).toBe(404);
            expect(ranSql('INSERT INTO tiktok_graphql_captures')).toBe(false);
        });

        it('inserts when everything it is tagged with belongs to the caller', async () => {
            answer([
                ['search_keywords sk', [{ id: KEYWORD, project_id: PROJECT }]],
                ['FROM keyword_search_sessions', [{ id: 's' }]],
            ]);
            const res = await request(app).post('/api/tiktok/graphql_captures')
                .send(capture({ keyword_id: KEYWORD, session_id: '33333333-3333-4333-8333-333333333333' }));
            expect(res.status).toBe(200);
            expect(ranSql('INSERT INTO tiktok_graphql_captures')).toBe(true);
        });

        it('still accepts an untagged capture', async () => {
            const res = await request(app).post('/api/tiktok/graphql_captures').send(capture());
            expect(res.status).toBe(200);
        });
    });
});
