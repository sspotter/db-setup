const request = require('supertest');
const express = require('express');
const projectsRouter = require('../../routes/projects');
const pool = require('../../db');

jest.mock('../../db', () => ({
    query: jest.fn(),
    end: jest.fn()
}));

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 1 }; next(); });
app.use('/api', projectsRouter);

// Hiding or soft-deleting a post (project_posts.is_hidden / deleted_at) must change every number the
// user sees, not only the posts listing: each query that reads project_posts has to filter them.
const VISIBLE = (alias) => new RegExp(`${alias}\\.is_hidden = false AND ${alias}\\.deleted_at IS NULL`);

// Every statement that touches the project_posts table (not the CTE of the same name).
const touchingLinks = () => pool.query.mock.calls
    .map((c) => String(c[0]))
    .filter((sql) => /(JOIN|FROM) project_posts\b/.test(sql));

describe('project numbers exclude hidden and deleted post links', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pool.query.mockResolvedValue({
            rows: [{
                id: 1, name: 'P', username: 'a', profile_count: '0', post_count: '0', comment_count: '0', collab_post_count: '0',
                collab_count: '0', paid_count: '0', total_keywords: '0', active_keywords: '0', total_videos: '0',
                total_creators: '0', total_views: '0', total_engagement: '0', potential_reach: '0',
            }],
        });
    });

    const everyLinkQueryFilters = () => {
        const sqls = touchingLinks();
        expect(sqls.length).toBeGreaterThan(0);
        for (const sql of sqls) {
            // One visibility condition for every reference to the table in the statement.
            const refs = sql.match(/(JOIN|FROM) project_posts\b/g).length;
            expect(sql.match(/is_hidden = false AND (ppo2?\.)?deleted_at IS NULL/g) || []).toHaveLength(refs);
        }
        return sqls;
    };

    it('GET /projects/:id/stats (post count, comments, collaborations, paid posts, reach)', async () => {
        const res = await request(app).get('/api/projects/p1/stats');
        expect(res.status).toBe(200);
        const sqls = everyLinkQueryFilters();
        expect(sqls).toHaveLength(4);
        expect(sqls.find((s) => /COUNT\(\*\) FROM project_posts WHERE project_id/.test(s))).toMatch(/is_hidden = false AND deleted_at IS NULL/);
    });

    it('GET /projects/:id/compare (metrics and reach)', async () => {
        const res = await request(app).get('/api/projects/p1/compare?brand=a&competitors=b');
        expect(res.status).toBe(200);
        expect(everyLinkQueryFilters().length).toBeGreaterThanOrEqual(2);
    });

    it('GET /projects/:id/top-posts', async () => {
        const res = await request(app).get('/api/projects/p1/top-posts?usernames=a');
        expect(res.status).toBe(200);
        expect(everyLinkQueryFilters()).toHaveLength(1);
    });

    it('GET /projects/:id/collaborations', async () => {
        const res = await request(app).get('/api/projects/p1/collaborations');
        expect(res.status).toBe(200);
        expect(everyLinkQueryFilters()).toHaveLength(1);
    });

    it('GET /projects/:id/timeseries', async () => {
        const res = await request(app).get('/api/projects/p1/timeseries?brand=a');
        expect(res.status).toBe(200);
        expect(everyLinkQueryFilters()).toHaveLength(1);
    });

    it('GET /projects and GET /projects/:id (post_count, collab_post_count)', async () => {
        await request(app).get('/api/projects');
        const list = touchingLinks().join('\n');
        expect(list).toMatch(VISIBLE('ppo'));
        expect(list).toMatch(VISIBLE('ppo2'));
        pool.query.mockClear();
        await request(app).get('/api/projects/p1');
        everyLinkQueryFilters();
    });

    it('GET /projects/:id/profiles counts only visible posts per creator', async () => {
        await request(app).get('/api/projects/p1/profiles');
        everyLinkQueryFilters();
    });

    // A profile an admin hid for the project (project_profiles.is_hidden) disappears from the user's app.
    const profileSqls = () => pool.query.mock.calls.map((c) => String(c[0])).filter((s) => /project_profiles/.test(s));

    it('GET /projects/:id/profiles lists no hidden profile', async () => {
        await request(app).get('/api/projects/p1/profiles');
        expect(profileSqls().find((s) => /FROM project_profiles pp/.test(s))).toMatch(/pp\.project_id = \$1 AND pp\.is_hidden = false/);
    });

    it('profile counts (project list and project stats) skip hidden profiles', async () => {
        await request(app).get('/api/projects');
        expect(profileSqls().join(' ')).toMatch(/pp\.project_id = p\.id AND pp\.is_hidden = false/);
        pool.query.mockClear();
        await request(app).get('/api/projects/p1/stats');
        expect(profileSqls().join(' ')).toMatch(/COUNT\(\*\) FROM project_profiles WHERE project_id = \$1 AND is_hidden = false/);
    });

    it('stats partners / reach by role leave a hidden profile out', async () => {
        await request(app).get('/api/projects/p1/stats');
        const partners = profileSqls().find((s) => /partner_stats AS/.test(s));
        expect(partners).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM project_profiles hp\s+WHERE hp\.project_id = \$1 AND hp\.username = ap\.username AND hp\.is_hidden = true\)/);
    });

    it('keyword potential reach skips hidden keyword videos', async () => {
        await request(app).get('/api/projects/p1');
        const kw = pool.query.mock.calls.map((c) => String(c[0])).find((s) => /AS potential_reach/.test(s));
        expect(kw).toMatch(/included_in_reach = true\s+AND \(is_hidden = false OR is_hidden IS NULL\)/);
    });

    it('GET /projects/:id/posts still lists only visible links, with no duplicated condition', async () => {
        await request(app).get('/api/projects/p1/posts');
        for (const sql of touchingLinks()) {
            expect(sql.match(/is_hidden = false/g)).toHaveLength(1);
        }
    });
});
