const request = require('supertest');
const express = require('express');
const pool = require('../../db');

jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));

const scrapeRouter = require('../../routes/scrape');
const postsRouter = require('../../routes/posts');
const commentsRouter = require('../../routes/comments');

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 'user-A' }; next(); });
app.use('/api', scrapeRouter);
app.use('/api', postsRouter);
app.use('/api', commentsRouter);

const sqlOf = (call) => String(call[0]);

describe('cross-user ownership (instagram)', () => {
    let client;
    beforeEach(() => {
        jest.resetAllMocks();
        client = { query: jest.fn(), release: jest.fn() };
        pool.connect.mockResolvedValue(client);
    });

    describe('PATCH /scrape/jobs/:id', () => {
        it('404s and runs no UPDATE/INSERT when the job belongs to another user', async () => {
            client.query.mockImplementation(async (sql) => ({ rows: [] })); // owned-job lookup finds nothing

            const res = await request(app).patch('/api/scrape/jobs/job-B').send({ status: 'completed', has_next_page: true, end_cursor: 'x' });

            expect(res.status).toBe(404);
            const sqls = client.query.mock.calls.map(sqlOf);
            expect(sqls.some((s) => /^\s*(UPDATE|INSERT)/i.test(s))).toBe(false);
            expect(client.query).toHaveBeenCalledWith('ROLLBACK');
            expect(client.release).toHaveBeenCalled();
        });

        it('looks the job up by id AND the caller\'s user id', async () => {
            client.query.mockImplementation(async () => ({ rows: [] }));
            await request(app).patch('/api/scrape/jobs/job-B').send({ status: 'running' });
            const lookup = client.query.mock.calls.find((c) => /FROM scrape_jobs/.test(sqlOf(c)));
            expect(sqlOf(lookup)).toMatch(/scrape_sessions[\s\S]*user_id = \$2/);
            expect(lookup[1]).toEqual(['job-B', 'user-A']);
        });

        it('still updates the caller\'s own job', async () => {
            client.query.mockImplementation(async (sql) => {
                if (/FROM scrape_jobs sj/.test(sql)) return { rows: [{ id: 'job-A', session_id: 's1', post_shortcode: 'p', page_number: 1 }] };
                return { rows: [] };
            });
            const res = await request(app).patch('/api/scrape/jobs/job-A').send({ status: 'running' });
            expect(res.status).toBe(200);
            expect(client.query.mock.calls.map(sqlOf).some((s) => /UPDATE scrape_jobs SET/.test(s))).toBe(true);
            expect(client.query).toHaveBeenLastCalledWith('COMMIT');
        });
    });

    describe('GET /scrape/sessions/:id/next-job', () => {
        it('404s without reading jobs when the session is another user\'s', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] }); // session ownership
            const res = await request(app).get('/api/scrape/sessions/sess-B/next-job');
            expect(res.status).toBe(404);
            expect(pool.query).toHaveBeenCalledTimes(1);
            expect(pool.query.mock.calls[0][1]).toEqual(['sess-B', 'user-A']);
        });

        it('returns the next job for the owner', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ id: 'sess-A' }] })
                      .mockResolvedValueOnce({ rows: [{ id: 'job1', post_shortcode: 'p' }] });
            const res = await request(app).get('/api/scrape/sessions/sess-A/next-job');
            expect(res.status).toBe(200);
            expect(res.body.job).toEqual({ id: 'job1', post_shortcode: 'p' });
        });
    });

    describe('GET /posts/:shortcode/history', () => {
        it('404s and reads no metrics when the caller does not have the post', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] }); // userHasPost
            const res = await request(app).get('/api/posts/abc/history');
            expect(res.status).toBe(404);
            expect(pool.query).toHaveBeenCalledTimes(1);
            expect(sqlOf(pool.query.mock.calls[0])).toMatch(/user_scraped_posts[\s\S]*project_posts/);
            expect(pool.query.mock.calls[0][1]).toEqual(['user-A', 'abc']);
        });

        it('returns history when the caller has the post', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
                      .mockResolvedValueOnce({ rows: [{ likes_count: 5 }] });
            const res = await request(app).get('/api/posts/abc/history');
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ success: true, shortcode: 'abc', snapshots: 1 });
        });
    });

    describe('POST /comments', () => {
        const body = { post_shortcode: 'abc', comments: [{ id: 'c1', text: 'hi' }] };

        it('404s and writes nothing when the caller does not have the post', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] }); // userHasPost
            const res = await request(app).post('/api/comments').send(body);
            expect(res.status).toBe(404);
            expect(client.query).not.toHaveBeenCalled();
            expect(client.release).toHaveBeenCalled();
        });

        it('still writes comments for a post the caller has', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
            client.query.mockImplementation(async (sql) => (/INSERT INTO comments/.test(sql) ? { rows: [{ is_insert: true }] } : { rows: [] }));
            const res = await request(app).post('/api/comments').send(body);
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ success: true, inserted: 1 });
            expect(client.query).toHaveBeenCalledWith('COMMIT');
        });

        it('keeps the 400 for a malformed body without touching ownership', async () => {
            const res = await request(app).post('/api/comments').send({ post_shortcode: 'abc' });
            expect(res.status).toBe(400);
            expect(pool.query).not.toHaveBeenCalled();
        });
    });
});
