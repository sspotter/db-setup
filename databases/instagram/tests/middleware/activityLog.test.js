process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'; // config/jwt.js throws without it

const request = require('supertest');
const express = require('express');
const pool = require('../../db');
const { activityLog, logServerError } = require('../../middleware/activityLog');
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
const SEEN_ID = '99999999-2222-3333-4444-555555555555';
app.get('/api/slow', async (req, res) => { await new Promise((r) => setTimeout(r, 30)); res.json({ ok: true }); });
app.get('/api/boom', (req, res) => {
    try { throw new Error('relation "x" does not exist'); }
    catch (err) { logServerError(res, err); res.status(500).json({ error: 'Internal server error' }); }
});
app.get('/api/flagged-ok', (req, res) => { res.locals.activity = { reason: 'reset_success', email: 'r@x.com' }; res.json({ success: true }); });
app.get('/api/seen', (req, res) => { req.user = { id: SEEN_ID, email: 'seen@example.com' }; res.json({ ok: true }); });

// The INSERT is fired on 'finish'; let it run before asserting.
const flush = () => new Promise(setImmediate);
const insertCalls = () => pool.query.mock.calls.filter(([sql]) => /INSERT INTO api_events/.test(sql));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/admin/events', (req, res) => res.json({ events: [] }));
app.post('/api/save', (req, res) => { req.user = { id: '88888888-2222-3333-4444-555555555555', email: 'saver@example.com' }; res.json({ success: true }); });

describe('activityLog middleware', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.ACTIVITY_LOG_SUCCESS = 'none'; // most cases below assert on failures/slow only
        delete process.env.SLOW_REQUEST_MS;
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

    it('stores duration and the real 5xx message while the client still gets the generic one', async () => {
        const res = await request(app).get('/api/boom');
        await flush();

        expect(res.body).toEqual({ error: 'Internal server error' });
        const [, params] = insertCalls()[0];
        expect(params[6]).toBe('Internal server error');            // existing `error` column
        expect(typeof params[10]).toBe('number');                    // duration_ms
        expect(params[11]).toBe('relation "x" does not exist');      // server_error
    });

    it('logs a successful request only when it is slower than SLOW_REQUEST_MS', async () => {
        process.env.SLOW_REQUEST_MS = '10';
        await request(app).get('/api/slow');
        await flush();
        process.env.SLOW_REQUEST_MS = '5000';
        await request(app).get('/api/slow');
        await flush();
        delete process.env.SLOW_REQUEST_MS;

        const calls = insertCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0][1][4]).toBe(200);
        expect(calls[0][1][10]).toBeGreaterThanOrEqual(10);
    });

    it('records a successful non-login request when the route set an explicit reason', async () => {
        await request(app).get('/api/flagged-ok');
        await flush();

        const calls = insertCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0][1][4]).toBe(200);
        expect(calls[0][1][5]).toBe('reset_success');
        expect(calls[0][1][1]).toBe('r@x.com');
    });

    it('records successful reads and writes by default, with the authed user', async () => {
        delete process.env.ACTIVITY_LOG_SUCCESS;
        await request(app).get('/api/ok');
        await request(app).post('/api/save').send({});
        await flush();

        const calls = insertCalls();
        expect(calls.map(([, p]) => `${p[2]} ${p[3]} ${p[4]}`)).toEqual(['GET /api/ok 200', 'POST /api/save 200']);
        expect(calls[1][1][1]).toBe('saver@example.com');
        expect(calls[1][1][5]).toBeNull(); // no reason: plain success
    });

    it("'writes' mode skips successful GETs but keeps successful POSTs", async () => {
        process.env.ACTIVITY_LOG_SUCCESS = 'writes';
        await request(app).get('/api/ok');
        await request(app).post('/api/save').send({});
        await flush();

        expect(insertCalls().map(([, p]) => p[3])).toEqual(['/api/save']);
    });

    it('never records the health check or admin panel GET polling', async () => {
        delete process.env.ACTIVITY_LOG_SUCCESS;
        await request(app).get('/api/health');
        await request(app).get('/api/admin/events');
        await flush();

        expect(insertCalls()).toHaveLength(0);
    });

    it('writes users.last_seen at most once per window per user', async () => {
        await request(app).get('/api/seen');
        await request(app).get('/api/seen');
        await flush();

        const seen = pool.query.mock.calls.filter(([sql]) => /UPDATE users SET last_seen/.test(sql));
        expect(seen).toHaveLength(1);
        expect(seen[0][1]).toEqual([SEEN_ID]);
    });
});
