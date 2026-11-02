const request = require('supertest');
const express = require('express');
const pool = require('../../db');

jest.mock('../../db', () => ({ query: jest.fn(), connect: jest.fn(), end: jest.fn() }));
process.env.JWT_SECRET = 'test-secret';
const authRouter = require('../../routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

describe('POST /api/auth/reset-password', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rejects short passwords without touching the db', async () => {
        const res = await request(app).post('/api/auth/reset-password').send({ token: 'abc', password: 'short' });
        expect(res.status).toBe(400);
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('400s when the token is invalid, used or expired', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        const res = await request(app).post('/api/auth/reset-password').send({ token: 'abc', password: 'longenough1' });
        expect(res.status).toBe(400);
    });

    it('sets the password when the token is claimed', async () => {
        pool.query.mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'bob@x.com' }] });
        const res = await request(app).post('/api/auth/reset-password').send({ token: 'abc', password: 'longenough1' });
        expect(res.status).toBe(200);
        const [, params] = pool.query.mock.calls[0];
        expect(params[0]).toHaveLength(64);
        expect(params[1]).toMatch(/^\$2[aby]\$/);
    });
});
