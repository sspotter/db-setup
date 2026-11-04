const request = require('supertest');
const express = require('express');
const pool = require('../../db');

jest.mock('../../db', () => ({
    query: jest.fn(),
    end: jest.fn()
}));

process.env.ADMIN_PASSWORD = 'admin-test';
const usageRouter = require('../../routes/adminUsage');

const app = express();
app.use(express.json());
app.use('/api/admin', usageRouter);

const admin = (r) => r.set('x-admin-password', 'admin-test');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

// Answers each usage query by what it selects; `over` replaces rows per key.
const answers = (over = {}) => {
    const rows = {
        users: [
            { id: A, email: 'ann@x.com', plan: 'pro', status: 'active', last_login: null },
            { id: B, email: 'bob@x.com', plan: 'none', status: 'active', last_login: null },
            { id: C, email: 'cat@x.com', plan: 'none', status: 'disabled', last_login: null },
        ],
        sessions: [{ user_id: A, n: 4 }],
        jobs: [{ user_id: A, total: 20, failed: 3 }, { user_id: B, total: 2, failed: 0 }],
        stuck: [{ user_id: A, n: 1 }],
        logs: [{ user_id: A, api_calls: 30, comments: 900 }],
        saved: [{ user_id: A, n: 55 }, { user_id: B, n: 5 }],
        projects: [{ user_id: A, n: 2 }],
        failed: [{ id: 'j1', user_id: A, email: 'ann@x.com', post_shortcode: 'abc', status: 'failed', retry_count: 3, max_retries: 3, error_message: 'rate limited' }],
        videos: [{ user_id: A, n: 7 }],
        keywords: [{ user_id: A, n: 2 }],
        tiktok_comments: [{ user_id: B, n: 11 }],
        ...over,
    };
    pool.query.mockImplementation(async (sql) => {
        const s = sql.replace(/\s+/g, ' ');
        let key;
        if (s.includes('FROM tiktok_comments')) key = 'tiktok_comments';
        else if (s.includes('FROM tiktok_videos')) key = 'videos';
        else if (s.includes('FROM search_keywords')) key = 'keywords';
        else if (s.includes('left(j.error_message')) key = 'failed';
        else if (s.includes("j.status = 'running'")) key = 'stuck';
        else if (s.includes('FROM scrape_jobs')) key = 'jobs';
        else if (s.includes('FROM scrape_sessions')) key = 'sessions';
        else if (s.includes('FROM comment_scrape_logs')) key = 'logs';
        else if (s.includes('FROM user_scraped_posts')) key = 'saved';
        else if (s.includes('FROM projects')) key = 'projects';
        else if (s.includes('FROM users')) key = 'users';
        else throw new Error('unexpected query: ' + s);
        return { rows: rows[key] || [] };
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.USAGE_STUCK_MINUTES;
});

describe('GET /api/admin/usage', () => {
    it('requires the admin password', async () => {
        expect((await request(app).get('/api/admin/usage')).status).toBe(401);
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('merges per-user counts, ranks by usage and lists failed jobs', async () => {
        answers();
        const res = await admin(request(app).get('/api/admin/usage'));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, days: 30, stuck_after_minutes: 30, storage_basis: 'row_counts' });
        const ann = res.body.users.find((u) => u.email === 'ann@x.com');
        expect(ann).toMatchObject({
            sessions: 4, jobs_total: 20, jobs_failed: 3, jobs_stuck: 1,
            api_calls: 30, comments_scraped: 900, saved_posts: 55, projects: 2, usage_score: 50,
        });
        const cat = res.body.users.find((u) => u.email === 'cat@x.com');
        expect(cat).toMatchObject({ sessions: 0, jobs_total: 0, api_calls: 0, comments_scraped: 0, saved_posts: 0, projects: 0, usage_score: 0 });
        expect(res.body.users.map((u) => u.email)).toEqual(['ann@x.com', 'bob@x.com', 'cat@x.com']);
        expect(res.body.top_users.map((u) => u.email)).toEqual(['ann@x.com', 'bob@x.com']); // zero-usage users excluded
        expect(res.body.failed_jobs).toEqual([expect.objectContaining({ id: 'j1', retry_count: 3, error_message: 'rate limited' })]);
        expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it('uses ?days (clamped 1..365) as a bound parameter and USAGE_STUCK_MINUTES for stuck jobs', async () => {
        answers();
        process.env.USAGE_STUCK_MINUTES = '90';
        const res = await admin(request(app).get('/api/admin/usage?days=99999'));
        expect(res.body.days).toBe(365);
        expect(res.body.stuck_after_minutes).toBe(90);
        const calls = pool.query.mock.calls.map(([sql, params]) => [sql.replace(/\s+/g, ' '), params]);
        expect(calls.find(([s]) => s.includes('FROM scrape_sessions'))[1]).toEqual([365]);
        expect(calls.find(([s]) => s.includes("j.status = 'running'"))[1]).toEqual([90]);

        pool.query.mockClear();
        answers();
        expect((await admin(request(app).get('/api/admin/usage?days=0'))).body.days).toBe(30);
    });

    it('aggregates in SQL: one query per metric, truncated error text, capped failed-job list', async () => {
        answers();
        await admin(request(app).get('/api/admin/usage'));
        const sqls = pool.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' '));
        expect(sqls.length).toBeLessThanOrEqual(12); // fixed, independent of the number of users
        expect(sqls.find((s) => s.includes('left(j.error_message'))).toMatch(/left\(j\.error_message, 300\)[\s\S]*LIMIT 50/);
        for (const s of sqls.filter((q) => /scrape_jobs|comment_scrape_logs|scrape_sessions/.test(q))) expect(s).toMatch(/GROUP BY|LIMIT/);
    });

    it('returns 500 when a query fails', async () => {
        const err = jest.spyOn(console, 'error').mockImplementation(() => {});
        pool.query.mockRejectedValue(new Error('connection lost'));
        expect((await admin(request(app).get('/api/admin/usage'))).status).toBe(500);
        err.mockRestore();
    });
});

describe('TikTok extras', () => {
    it('adds videos, keywords and tiktok_comments row counts per user, scoped through projects', async () => {
        answers();
        const res = await admin(request(app).get('/api/admin/usage'));
        const byEmail = Object.fromEntries(res.body.users.map((u) => [u.email, u]));
        expect(byEmail['ann@x.com']).toMatchObject({ videos: 7, keywords: 2, tiktok_comments: 0 });
        expect(byEmail['bob@x.com']).toMatchObject({ videos: 0, keywords: 0, tiktok_comments: 11 });
        const sqls = pool.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' '));
        for (const t of ['FROM tiktok_videos', 'FROM tiktok_comments']) expect(sqls.find((q) => q.includes(t))).toContain('JOIN projects p');
    });
});
