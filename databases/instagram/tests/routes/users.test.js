const request = require('supertest');
const express = require('express');
const pool = require('../../db');

jest.mock('../../db', () => ({ query: jest.fn(), connect: jest.fn() }));

const usersRoutes = require('../../routes/users');

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: 'user-1' }; next(); });
app.use('/api', usersRoutes);

// Fields the extension's sendProfileToBackend builds from an Instagram capture.
const captured = { id: '18972716944', username: 'moussyarabia', follower_count: 6296, following_count: 3, media_count: 225, latest_post_timestamp: 1790000000, role: 'root' };
// The same profile after the dashboard merged the backend's row over the browser's copy.
const echoed = { ...captured, follower_count: 12500, scraped_at: '2026-11-05T06:09:29.523Z', added_to_project: '2026-07-31T12:27:21.041Z', observed_at: null };
const tiktokProfile = { id: '7106859335401505793', username: 'suntop_arabia', follower_count: 84900, heart_count: 10, video_count: 296, signature: 'bio' };

const post = (users) => request(app).post('/api/users').send({ users });
const upserts = () => pool.query.mock.calls.filter(([sql]) => /INSERT INTO ig_users/.test(sql));
const OBSERVED_AT = 9; // $10 in the INSERT

describe('POST /api/users', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pool.query.mockResolvedValue({ rows: [] });
    });

    it('stamps a fresh capture as observed now, so a lower real count can replace a stale one', async () => {
        const before = Date.now();
        const res = await post([captured]);
        expect(res.status).toBe(200);
        expect(res.body.upserted).toBe(1);
        const stamp = Date.parse(upserts()[0][1][OBSERVED_AT]);
        expect(stamp).toBeGreaterThanOrEqual(before);
        expect(stamp).toBeLessThanOrEqual(Date.now());
    });

    it('does not stamp a row echoed back from the backend, so it cannot re-assert an old count', async () => {
        await post([echoed]);
        expect(upserts()[0][1][OBSERVED_AT]).toBeNull();
    });

    it('keeps an observation time the client sent', async () => {
        await post([{ ...captured, observedAt: '2026-10-01T10:00:00Z' }]);
        expect(upserts()[0][1][OBSERVED_AT]).toBe('2026-10-01T10:00:00.000Z');
    });

    it('skips TikTok profiles and still saves the Instagram ones in the batch', async () => {
        const res = await post([tiktokProfile, captured]);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ upserted: 1, skipped: 1 });
        expect(upserts()).toHaveLength(1);
        expect(upserts()[0][1][1]).toBe('moussyarabia');
    });
});
