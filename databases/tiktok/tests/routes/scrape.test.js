const request = require('supertest');
const express = require('express');
const scrapeRouter = require('../../routes/scrape');
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
app.use('/api', scrapeRouter);

describe('scrape — job ownership enforcement (IDOR regression)', () => {
    let mockClient;

    beforeEach(() => {
        jest.clearAllMocks();
        mockClient = {
            // SELECT returns a job row; other statements ignore the result
            query: jest.fn().mockResolvedValue({
                rows: [{ id: 'j1', session_id: 's1', post_shortcode: 'abc', page_number: 1 }]
            }),
            release: jest.fn()
        };
        pool.connect.mockResolvedValue(mockClient);
    });

    describe('PATCH /api/scrape/jobs/:id', () => {
        it("returns 403 when the job's session is not owned by the user", async () => {
            pool.query.mockResolvedValueOnce({ rows: [] }); // job ownership fails

            const res = await request(app)
                .patch('/api/scrape/jobs/j1')
                .send({ status: 'running' });

            expect(res.status).toBe(403);
            // rejected before the transaction started
            expect(mockClient.query).not.toHaveBeenCalled();
        });

        it('updates the job when its session is owned', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ id: 'j1' }] }); // ownership ok

            const res = await request(app)
                .patch('/api/scrape/jobs/j1')
                .send({ status: 'running' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockClient.query).toHaveBeenCalled(); // transaction ran
        });
    });
});
