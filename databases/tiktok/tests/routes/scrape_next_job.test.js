const request = require('supertest');
const express = require('express');
const pool = require('../../db');
const scrapeRouter = require('../../routes/scrape');

jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 1 }; next(); });
app.use('/api', scrapeRouter);

const SESSION = '44444444-4444-4444-8444-444444444444';

describe('GET /api/scrape/sessions/:id/next-job — ownership', () => {
    beforeEach(() => jest.clearAllMocks());

    it('404s for a session that is not the caller\'s and never reads its jobs', async () => {
        pool.query.mockResolvedValue({ rows: [] });
        const res = await request(app).get(`/api/scrape/sessions/${SESSION}/next-job`);
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ success: false, error: 'Not found' });
        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(pool.query.mock.calls[0][0]).toContain('FROM scrape_sessions');
        expect(pool.query.mock.calls[0][1]).toEqual([SESSION, 1]);
    });

    it('returns the next pending job of an owned session', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id: SESSION }] })
            .mockResolvedValueOnce({ rows: [{ id: 'job1', post_shortcode: 'abc' }] });
        const res = await request(app).get(`/api/scrape/sessions/${SESSION}/next-job`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, job: { id: 'job1', post_shortcode: 'abc' } });
    });

    it('still answers "No pending jobs" for an owned session with none', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{ id: SESSION }] })
            .mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get(`/api/scrape/sessions/${SESSION}/next-job`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, job: null, message: 'No pending jobs' });
    });
});
