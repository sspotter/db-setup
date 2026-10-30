process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'; // config/jwt.js throws without it

const request = require('supertest');
const express = require('express');
const pool = require('../../db');
const { activityLog } = require('../../middleware/activityLog');
const authRouter = require('../../routes/auth');

// Mock the database pool (login uses pool.connect() -> client.query)
const client = { query: jest.fn(), release: jest.fn() };
jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));

const USER_ID = '11111111-2222-3333-4444-555555555555';

const app = express();
app.use(express.json());
app.use('/api', activityLog);
app.use('/api/auth', authRouter);
app.get('/api/ok', (req, res) => res.json({ success: true }));
app.get('/api/secret', (req, res) => {
    req.user = { id: USER_ID, email: 'authed@example.com' }; // stands in for authenticateToken
    res.status(404).json({ error: 'Project not found', message: 'id 42' });
});

// The INSERT is fired on 'finish'; let it run before asserting.
const flush = () => new Promise(setImmediate);
const insertCalls = () => pool.query.mock.calls.filter(([sql]) => /INSERT INTO api_events/.test(sql));

describe('activityLog middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pool.query.mockResolvedValue({ rows: [] });
        pool.connect.mockResolvedValue(client);
    });

    it('records a failed login with its reason and email', async () => {
        client.query.mockResolvedValueOnce({ rows: [] }); // no such user

        const res = await request(app)
            .post('/api/auth/login')
            .set('X-Extension-Version', '1.2.3')
            .send({ email: 'nobody@example.com', password: 'hunter2' });
        await flush();

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'Invalid email or password' });
        const calls = insertCalls();
        expect(calls).toHaveLength(1);
        const [, params] = calls[0];
        expect(params[1]).toBe('nobody@example.com');
        expect(params[3]).toBe('/api/auth/login');
        expect(params[4]).toBe(401);
        expect(params[5]).toBe('no_such_user');
        expect(params[9]).toBe('1.2.3');
    });

    it('does not record a 2xx on a non-login route', async () => {
        const res = await request(app).get('/api/ok');
        await flush();

        expect(res.status).toBe(200);
        expect(insertCalls()).toHaveLength(0);
    });

    it('records a 4xx on an authed route with user_id and the error text', async () => {
        const res = await request(app).get('/api/secret?x=1');
        await flush();

        expect(res.status).toBe(404);
        const [, params] = insertCalls()[0];
        expect(params[0]).toBe(USER_ID);
        expect(params[1]).toBe('authed@example.com');
        expect(params[3]).toBe('/api/secret');
        expect(params[6]).toBe('Project not found — id 42');
    });

    it('never passes the password to any query', async () => {
        client.query.mockResolvedValueOnce({ rows: [{ id: USER_ID, email: 'a@b.c', password_hash: 'not-a-real-hash' }] });

        await request(app)
            .post('/api/auth/login')
            .send({ email: 'a@b.c', password: 'S3cret-Pa55' });
        await flush();

        expect(insertCalls()[0][1][5]).toBe('wrong_password');
        const everything = JSON.stringify([pool.query.mock.calls, client.query.mock.calls]);
        expect(everything).not.toContain('S3cret-Pa55');
    });
});
