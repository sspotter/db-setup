const request = require('supertest');
const express = require('express');
const pool = require('../../db');
const creatorsRouter = require('../../routes/tiktok_creators');

jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 1 }; next(); });
app.use('/api', creatorsRouter);

const KEYWORD = '11111111-1111-4111-8111-111111111111';

describe('GET /api/tiktok/creators — ownership', () => {
    beforeEach(() => jest.clearAllMocks());

    it('404s for a keyword the caller does not own and never lists creators', async () => {
        pool.query.mockResolvedValue({ rows: [] });
        const res = await request(app).get(`/api/tiktok/creators?keyword_id=${KEYWORD}`);
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ success: false, error: 'Not found' });
        expect(pool.query.mock.calls.some(([s]) => s.includes('tiktok_creators'))).toBe(false);
    });

    it('lists creators for an owned keyword in the same shape as before', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id: KEYWORD, project_id: 'p' }] })   // ownership
            .mockResolvedValueOnce({ rows: [{ id: 'cr1', username: 'a' }] });      // creators
        const res = await request(app).get(`/api/tiktok/creators?keyword_id=${KEYWORD}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, creators: [{ id: 'cr1', username: 'a' }] });
        expect(pool.query.mock.calls[0][1]).toEqual([KEYWORD, 1]);
    });

    it('still 400s without a keyword_id', async () => {
        const res = await request(app).get('/api/tiktok/creators');
        expect(res.status).toBe(400);
    });
});
