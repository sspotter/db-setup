const request = require('supertest');
const express = require('express');
const tiktokVideosRouter = require('../../routes/tiktok_videos');
const pool = require('../../db');

// Mock the database pool (query for single statements, connect for transactions)
jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));

const app = express();
app.use(express.json());

// Mock auth middleware — authenticated as user id 1
app.use((req, res, next) => {
    req.user = { id: 1 };
    next();
});

app.use('/api', tiktokVideosRouter);

/**
 * Regression tests for the object-level authorization (IDOR) fix.
 * Each endpoint must reject a resource the caller does not own with 403,
 * and must still serve a resource the caller DOES own.
 *
 * An empty ownership query result ({ rows: [] }) models "not owned".
 */
describe('tiktok_videos — ownership enforcement (IDOR regression)', () => {
    let mockClient;

    beforeEach(() => {
        jest.clearAllMocks();
        mockClient = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'x' }] }), release: jest.fn() };
        pool.connect.mockResolvedValue(mockClient);
    });

    describe('GET /api/tiktok/videos/hidden', () => {
        it('returns 403 when the project is not owned by the user', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] }); // ownership check fails

            const res = await request(app).get('/api/tiktok/videos/hidden?project_id=p1');

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
        });

        it('returns the hidden videos when the project is owned', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });            // ownership ok
            pool.query.mockResolvedValueOnce({ rows: [{ video_id: 'v1' }] });      // data query

            const res = await request(app).get('/api/tiktok/videos/hidden?project_id=p1');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.videos).toHaveLength(1);
        });

        it('returns 400 (and never queries) when project_id is missing', async () => {
            const res = await request(app).get('/api/tiktok/videos/hidden');

            expect(res.status).toBe(400);
            expect(pool.query).not.toHaveBeenCalled();
        });
    });

    describe('GET /api/tiktok/videos', () => {
        it('returns 403 when the keyword is not owned by the user', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] }); // keyword ownership fails

            const res = await request(app).get('/api/tiktok/videos?keyword_id=k1');

            expect(res.status).toBe(403);
        });

        it('returns the videos when the keyword is owned', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ id: 'k1', project_id: 'p1' }] }); // ownership ok
            pool.query.mockResolvedValueOnce({ rows: [{ video_id: 'v1' }] });             // data query

            const res = await request(app).get('/api/tiktok/videos?keyword_id=k1');

            expect(res.status).toBe(200);
            expect(res.body.videos).toHaveLength(1);
        });
    });

    describe('POST /api/tiktok/videos/batch', () => {
        it('returns 403 when the keyword is not owned by the user', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] }); // getOwnedKeyword fails

            const res = await request(app)
                .post('/api/tiktok/videos/batch')
                .send({ videos: [{ video_id: 'v1' }], keyword_id: 'k1', project_id: 'attacker-supplied' });

            expect(res.status).toBe(403);
            // ownership failed before the transaction began
            expect(mockClient.query).not.toHaveBeenCalled();
        });

        it('returns 400 when keyword_id is missing', async () => {
            const res = await request(app)
                .post('/api/tiktok/videos/batch')
                .send({ videos: [{ video_id: 'v1' }] });

            expect(res.status).toBe(400);
            expect(pool.query).not.toHaveBeenCalled();
        });
    });

    describe('PATCH /api/tiktok/videos/:video_id/qualify', () => {
        it('returns 403 when no owned row matches the video', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] }); // scoped UPDATE affects 0 rows

            const res = await request(app)
                .patch('/api/tiktok/videos/v1/qualify')
                .send({ included_in_reach: true });

            expect(res.status).toBe(403);
        });

        it('updates and refreshes stats when an owned row matches', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ video_id: 'v1', keyword_id: 'k1' }] }); // UPDATE
            pool.query.mockResolvedValueOnce({ rows: [] });                                     // stats refresh

            const res = await request(app)
                .patch('/api/tiktok/videos/v1/qualify')
                .send({ included_in_reach: true });

            expect(res.status).toBe(200);
            expect(res.body.video.video_id).toBe('v1');
        });

        it('returns 400 (and never queries) when there are no fields to update', async () => {
            const res = await request(app)
                .patch('/api/tiktok/videos/v1/qualify')
                .send({});

            expect(res.status).toBe(400);
            expect(pool.query).not.toHaveBeenCalled();
        });
    });

    describe('GET /api/keywords/:id/analytics', () => {
        it('returns 403 when the keyword is not owned by the user', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] }); // keyword ownership fails

            const res = await request(app).get('/api/keywords/k1/analytics');

            expect(res.status).toBe(403);
        });
    });

    describe('DELETE /api/tiktok/videos/:video_id', () => {
        it('returns 403 when the keyword is not owned by the user', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] }); // keyword ownership fails

            const res = await request(app).delete('/api/tiktok/videos/v1?keyword_id=k1');

            expect(res.status).toBe(403);
        });

        it('deletes when the keyword is owned', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ id: 'k1', project_id: 'p1' }] }); // ownership ok
            pool.query.mockResolvedValueOnce({ rows: [] }); // DELETE
            pool.query.mockResolvedValueOnce({ rows: [] }); // stats refresh

            const res = await request(app).delete('/api/tiktok/videos/v1?keyword_id=k1');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('returns 400 (and never queries) when keyword_id is missing', async () => {
            const res = await request(app).delete('/api/tiktok/videos/v1');

            expect(res.status).toBe(400);
            expect(pool.query).not.toHaveBeenCalled();
        });
    });
});
