const request = require('supertest');
const express = require('express');
const keywordsRouter = require('../../routes/keywords');
const pool = require('../../db');

jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));

const app = express();
app.use(express.json());
app.use((req, res, next) => {
    req.user = { id: 1 };
    next();
});
app.use('/api', keywordsRouter);

describe('keywords — session ownership enforcement (IDOR regression)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('PATCH /api/keywords/:id/sessions/:sid', () => {
        it('returns 403 when the session is not owned by the user', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] }); // session ownership fails

            const res = await request(app)
                .patch('/api/keywords/k1/sessions/s1')
                .send({ status: 'completed' });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            // Must reject before issuing the UPDATE
            expect(pool.query).toHaveBeenCalledTimes(1);
        });

        it('updates the session when it is owned', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ id: 's1' }] });                 // ownership ok
            pool.query.mockResolvedValueOnce({ rows: [{ id: 's1', status: 'completed' }] }); // UPDATE

            const res = await request(app)
                .patch('/api/keywords/k1/sessions/s1')
                .send({ status: 'completed' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.session.id).toBe('s1');
        });

        it('returns 400 when there are no fields to update (but ownership passed)', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ id: 's1' }] }); // ownership ok

            const res = await request(app)
                .patch('/api/keywords/k1/sessions/s1')
                .send({});

            expect(res.status).toBe(400);
        });
    });
});
