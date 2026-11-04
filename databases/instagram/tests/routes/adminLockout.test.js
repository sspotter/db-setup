const request = require('supertest');
const express = require('express');
const pool = require('../../db');

jest.mock('../../db', () => ({ query: jest.fn(), connect: jest.fn() }));

process.env.ADMIN_PASSWORD = 'admin-test';

const lockout = require('../../utils/adminLockout');
const verifyAdmin = require('../../middleware/adminAuth');
const { clientIp } = require('../../utils/adminAudit');
const adminRoutes = require('../../routes/admin');

const app = express();
app.use(express.json());
app.get('/guarded', verifyAdmin, (req, res) => res.json({ ok: true }));
app.use('/api/admin', adminRoutes);

const guess = (value, ip = '198.51.100.1') => request(app).get('/guarded').set('x-admin-password', value).set('x-forwarded-for', ip);

describe('x-admin-password lockout', () => {
    beforeEach(() => {
        lockout.reset();
        jest.clearAllMocks();
        pool.query.mockResolvedValue({ rows: [] });
    });

    it('locks the IP after 5 different wrong passwords, even for the right one', async () => {
        for (let i = 0; i < 5; i++) expect((await guess(`wrong-${i}`)).status).toBe(401);
        const locked = await guess('admin-test');
        expect(locked.status).toBe(429);
        expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('does not count one stale password resent on parallel calls', async () => {
        await Promise.all(Array.from({ length: 10 }, () => guess('stale')));
        expect((await guess('admin-test')).status).toBe(200);
    });

    it('leaves other IPs alone', async () => {
        for (let i = 0; i < 5; i++) await guess(`wrong-${i}`);
        expect((await guess('admin-test', '198.51.100.2')).status).toBe(200);
    });

    it('does not count a request with no password', async () => {
        for (let i = 0; i < 6; i++) expect((await request(app).get('/guarded')).status).toBe(401);
        expect((await request(app).get('/guarded').set('x-admin-password', 'admin-test')).status).toBe(200);
    });

    it('shares the counter with POST /login in both directions', async () => {
        for (let i = 0; i < 5; i++) await guess(`wrong-${i}`);
        const viaLogin = await request(app).post('/api/admin/login').set('x-forwarded-for', '198.51.100.1').send({ password: 'admin-test' });
        expect(viaLogin.status).toBe(429);

        for (let i = 0; i < 5; i++) {
            await request(app).post('/api/admin/login').set('x-forwarded-for', '198.51.100.3').send({ password: `no-${i}` });
        }
        expect((await guess('admin-test', '198.51.100.3')).status).toBe(429);
    });
});

describe('adminLockout', () => {
    beforeEach(() => lockout.reset());

    it('keeps the map at its size cap, dropping the oldest key', () => {
        for (let i = 0; i < lockout.MAX_KEYS + 10; i++) lockout.addFail(`k${i}`);
        expect(lockout.size()).toBe(lockout.MAX_KEYS);
        expect(lockout.count('k0')).toBe(0);
        expect(lockout.count(`k${lockout.MAX_KEYS + 9}`)).toBe(1);
    });
});

describe('clientIp', () => {
    const req = (peer, xff) => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: peer }, ip: peer });

    it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('trusts the last forwarded entry from the local proxy at %s', (peer) => {
        expect(clientIp(req(peer, 'forged, 203.0.113.9'))).toBe('203.0.113.9');
    });

    it('ignores the header on a direct connection, so a caller cannot choose its own IP', () => {
        expect(clientIp(req('192.168.1.50', '203.0.113.9'))).toBe('192.168.1.50');
    });

    it('uses the socket address when there is no header', () => {
        expect(clientIp(req('127.0.0.1'))).toBe('127.0.0.1');
    });
});
