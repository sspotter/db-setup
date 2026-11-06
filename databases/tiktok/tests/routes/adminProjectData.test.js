const request = require('supertest');
const express = require('express');
const pool = require('../../db');

jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));

process.env.ADMIN_PASSWORD = 'admin-test';
const adminProjectData = require('../../routes/adminProjectData');

const app = express();
app.use(express.json());
app.use('/api/admin', adminProjectData);

const USER = '11111111-1111-4111-8111-111111111111';
const PROJ = '22222222-2222-4222-8222-222222222222';
const KW = '33333333-3333-4333-8333-333333333333';
const base = `/api/admin/users/${USER}/projects/${PROJ}`;
const KEYWORDS_URL = `${base}/keywords`;
const VIDEOS_URL = `${base}/videos`;
const VIDEO_ACTION_URL = `${base}/videos/action`;
const PROFILES_URL = `${base}/profiles`;
const PROFILE_ACTION_URL = `${base}/profiles/action`;
const admin = (r) => r.set('x-admin-password', 'admin-test');

describe('admin project data (keywords, videos, profiles)', () => {
    let client;
    let videoRows; // rows of the tiktok_videos selection
    let linkRows; // project_posts links mirrored
    let profileRows; // project_profiles selection
    let postLinks; // project_posts selection for a profile action
    let projectFound;

    const clientSql = () => client.query.mock.calls.map((c) => String(c[0]));
    const writes = () => clientSql().filter((s) => /^\s*(UPDATE|DELETE|INSERT)/i.test(s));
    const auditCalls = () => pool.query.mock.calls.filter((c) => /INSERT INTO admin_audit/.test(String(c[0])));
    const callWith = (re) => client.query.mock.calls.find((c) => re.test(String(c[0])));

    beforeEach(() => {
        jest.clearAllMocks();
        videoRows = [
            { id: 'v-row-1', video_id: 'vid1', keyword_id: KW },
            { id: 'v-row-2', video_id: 'vid2', keyword_id: KW },
        ];
        linkRows = [{ post_shortcode: 'vid1' }];
        profileRows = [{ id: 'pf1', username: 'Nadine' }, { id: 'pf2', username: 'bob' }];
        postLinks = [{ post_shortcode: 'p1' }, { post_shortcode: 'p2' }, { post_shortcode: 'p3' }];
        projectFound = true;
        client = { release: jest.fn() };
        client.query = jest.fn(async (sql) => {
            const s = String(sql);
            if (/FROM projects p JOIN users u/.test(s)) {
                return { rows: projectFound ? [{ id: PROJ, name: 'Barbican', email: 'nadine@example.com' }] : [] };
            }
            if (/SELECT v\.id, v\.video_id, v\.keyword_id FROM tiktok_videos v/.test(s)) return { rows: videoRows };
            if (/SELECT v\.id, v\.keyword_id FROM tiktok_videos v/.test(s)) return { rows: videoRows.map(({ id, keyword_id }) => ({ id, keyword_id })) };
            if (/SELECT pp\.post_shortcode FROM project_posts pp\s+JOIN posts p/.test(s)) return { rows: postLinks };
            if (/SELECT pp\.post_shortcode FROM project_posts pp/.test(s)) return { rows: linkRows };
            if (/SELECT pf\.id, pf\.username FROM project_profiles pf/.test(s)) return { rows: profileRows };
            return { rows: [], rowCount: 0 };
        });
        pool.connect.mockResolvedValue(client);
        pool.query.mockImplementation(async (sql) => {
            const s = String(sql);
            if (/SELECT id FROM projects WHERE id = \$1 AND user_id = \$2/.test(s)) return { rows: projectFound ? [{ id: PROJ }] : [] };
            return { rows: [] };
        });
    });

    describe('authentication and ids', () => {
        it('requires the admin password on every route and touches no database', async () => {
            for (const r of [
                request(app).get(KEYWORDS_URL),
                request(app).get(VIDEOS_URL),
                request(app).post(VIDEO_ACTION_URL).send({ action: 'hide', video_ids: ['a'] }),
                request(app).get(PROFILES_URL),
                request(app).post(PROFILE_ACTION_URL).send({ action: 'hide', usernames: ['a'] }),
            ]) {
                expect((await r).status).toBe(401);
            }
            expect(pool.query).not.toHaveBeenCalled();
            expect(pool.connect).not.toHaveBeenCalled();
        });

        it('rejects a malformed user or project id with 400 before any query', async () => {
            const res = await admin(request(app).get('/api/admin/users/nope/projects/also-nope/keywords'));
            expect(res.status).toBe(400);
            const post = await admin(request(app).post('/api/admin/users/nope/projects/x/videos/action')).send({ action: 'hide', video_ids: ['a'] });
            expect(post.status).toBe(400);
            expect(pool.query).not.toHaveBeenCalled();
            expect(pool.connect).not.toHaveBeenCalled();
        });
    });

    describe('GET keywords', () => {
        it('404s when the project is not this user\'s', async () => {
            projectFound = false;
            const res = await admin(request(app).get(KEYWORDS_URL));
            expect(res.status).toBe(404);
            expect(pool.query).toHaveBeenCalledTimes(1);
            expect(pool.query.mock.calls[0][1]).toEqual([PROJ, USER]);
        });

        it('returns one row per keyword with live and stored counts, parameterised', async () => {
            pool.query.mockImplementation(async (sql) => {
                if (/FROM search_keywords sk/.test(String(sql))) {
                    return { rows: [{ id: KW, keyword: 'tea', status: 'active', source_type: 'search', created_at: '2026-01-01T00:00:00Z', stored_videos: 9, videos: '7', hidden_videos: '2', creators: '3', views: '1000', engagement: '55' }] };
                }
                return { rows: [{ id: PROJ }] };
            });
            const res = await admin(request(app).get(KEYWORDS_URL));
            expect(res.status).toBe(200);
            expect(res.body.keywords).toEqual([{
                id: KW, keyword: 'tea', status: 'active', source_type: 'search', videos: 7, stored_videos: 9,
                hidden_videos: 2, creators: 3, views: 1000, engagement: 55, created_at: '2026-01-01T00:00:00.000Z',
            }]);
            const call = pool.query.mock.calls.find((c) => /FROM search_keywords sk/.test(String(c[0])));
            expect(call[1]).toEqual([PROJ]);
            expect(String(call[0])).toMatch(/is_hidden = false OR v\.is_hidden IS NULL/);
        });
    });

    describe('GET videos', () => {
        it('lists videos with a cap note total, filtered by keyword, parameterised', async () => {
            pool.query.mockImplementation(async (sql) => {
                const s = String(sql);
                if (/COUNT\(\*\) AS total FROM tiktok_videos/.test(s)) return { rows: [{ total: '812' }] };
                if (/FROM tiktok_videos v\s+LEFT JOIN tiktok_creators/.test(s)) {
                    return { rows: [{ id: 'r1', video_id: 'vid1', keyword_id: KW, keyword: 'tea', username: 'nadine', caption: 'hi', views_count: '10', likes_count: 2, comments_count: 1, shares_count: 0, posted_at: null, included_in_reach: true, is_hidden: true }] };
                }
                return { rows: [{ id: PROJ }] };
            });
            const res = await admin(request(app).get(`${VIDEOS_URL}?keyword_id=${KW}&limit=9999`));
            expect(res.status).toBe(200);
            expect(res.body.total).toBe(812);
            expect(res.body.videos[0]).toMatchObject({ video_id: 'vid1', username: 'nadine', views: 10, state: 'hidden', included_in_reach: true });
            const list = pool.query.mock.calls.find((c) => /LIMIT \$3/.test(String(c[0])));
            expect(list[1]).toEqual([PROJ, KW, 500]); // limit is capped at 500
        });

        it('rejects a bad keyword_id or limit', async () => {
            expect((await admin(request(app).get(`${VIDEOS_URL}?keyword_id=x`))).status).toBe(400);
            expect((await admin(request(app).get(`${VIDEOS_URL}?limit=0`))).status).toBe(400);
        });

        it('404s for a project that is not the user\'s', async () => {
            projectFound = false;
            expect((await admin(request(app).get(VIDEOS_URL))).status).toBe(404);
        });
    });

    describe('POST videos/action validation', () => {
        const send = (body) => admin(request(app).post(VIDEO_ACTION_URL)).send(body);

        it.each([
            ['unknown action', { action: 'delete', video_ids: ['a'] }],
            ['no selector', { action: 'hide' }],
            ['empty video_ids', { action: 'hide', video_ids: [] }],
            ['non-string id', { action: 'hide', video_ids: [1] }],
            ['too long id', { action: 'hide', video_ids: ['x'.repeat(256)] }],
            ['bad keyword_id', { action: 'hide', keyword_id: 'nope' }],
            ['non-boolean dry_run', { action: 'hide', video_ids: ['a'], dry_run: 'false' }],
            ['real run without expect_count', { action: 'hide', video_ids: ['a'], dry_run: false }],
            ['negative expect_count', { action: 'hide', video_ids: ['a'], dry_run: false, expect_count: -1 }],
        ])('400 for %s without touching the database', async (_name, body) => {
            const res = await send(body);
            expect(res.status).toBe(400);
            expect(pool.connect).not.toHaveBeenCalled();
        });

        it('accepts 5000 ids and refuses 5001', async () => {
            const ids = (n) => Array.from({ length: n }, (_, i) => `v${i}`);
            expect((await send({ action: 'hide', video_ids: ids(5000) })).status).toBe(200);
            const over = await send({ action: 'hide', video_ids: ids(5001) });
            expect(over.status).toBe(400);
            expect(over.body.error).toMatch(/5000/);
        });
    });

    describe('POST videos/action behaviour', () => {
        const send = (body) => admin(request(app).post(VIDEO_ACTION_URL)).send(body);

        it('defaults to a dry run: reports counts and changes nothing', async () => {
            const res = await send({ action: 'hide', video_ids: ['vid1', 'vid2'] });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ success: true, dry_run: true, action: 'hide', affected: 2, posts_affected: 1 });
            expect(res.body.sample).toEqual(['vid1', 'vid2']);
            expect(writes()).toEqual([]);
            expect(clientSql()).toContain('ROLLBACK');
            expect(clientSql()).not.toContain('COMMIT');
            expect(auditCalls()).toHaveLength(0);
        });

        it('409s when the count changed and writes nothing', async () => {
            const res = await send({ action: 'hide', video_ids: ['vid1', 'vid2'], dry_run: false, expect_count: 5 });
            expect(res.status).toBe(409);
            expect(res.body).toMatchObject({ success: false, error: 'count changed', affected: 2 });
            expect(writes()).toEqual([]);
            expect(auditCalls()).toHaveLength(0);
        });

        it('hides this project\'s videos, mirrors the links, refreshes the counters, audits, commits', async () => {
            const res = await send({ action: 'hide', video_ids: ['vid1', 'vid2'], dry_run: false, expect_count: 2 });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, dry_run: false, action: 'hide', affected: 2, posts_affected: 1 });
            const update = callWith(/UPDATE tiktok_videos SET is_hidden/);
            expect(String(update[0])).toMatch(/WHERE project_id = \$1 AND id = ANY/);
            expect(update[1]).toEqual([PROJ, true, ['v-row-1', 'v-row-2']]);
            expect(callWith(/UPDATE project_posts pp SET is_hidden = true/)[1]).toEqual([PROJ, ['vid1']]);
            expect(callWith(/UPDATE search_keywords sk/)[1]).toEqual([PROJ, [KW]]);
            expect(clientSql()).toContain('COMMIT');
            expect(client.release).toHaveBeenCalled();
            const audit = auditCalls();
            expect(audit).toHaveLength(1);
            expect(audit[0][1][0]).toBe('project_videos_hide');
            expect(JSON.parse(audit[0][1][3])).toMatchObject({ project_id: PROJ, affected: 2, posts_affected: 1, video_ids: ['vid1', 'vid2'] });
        });

        it('unhide acts on hidden rows and clears the state', async () => {
            const res = await send({ action: 'unhide', keyword_id: KW, dry_run: false, expect_count: 2 });
            expect(res.status).toBe(200);
            const select = callWith(/SELECT v\.id, v\.video_id, v\.keyword_id FROM tiktok_videos v/);
            expect(String(select[0])).toMatch(/v\.is_hidden = true/);
            expect(select[1]).toEqual([PROJ, null, KW]);
            expect(callWith(/UPDATE tiktok_videos SET is_hidden/)[1][1]).toBe(false);
            expect(auditCalls()[0][1][0]).toBe('project_videos_unhide');
        });

        it('locks the rows only for a real run', async () => {
            await send({ action: 'hide', video_ids: ['vid1'] });
            expect(clientSql().some((s) => /FOR UPDATE/.test(s))).toBe(false);
            client.query.mockClear();
            await send({ action: 'hide', video_ids: ['vid1'], dry_run: false, expect_count: 2 });
            expect(clientSql().some((s) => /FOR UPDATE OF v/.test(s))).toBe(true);
        });

        it('with nothing to change writes nothing but still answers', async () => {
            videoRows = [];
            linkRows = [];
            const res = await send({ action: 'hide', video_ids: ['gone'], dry_run: false, expect_count: 0 });
            expect(res.body).toMatchObject({ affected: 0 });
            expect(writes()).toEqual([]);
        });

        it('404s for a project that is not the user\'s and writes nothing', async () => {
            projectFound = false;
            const res = await send({ action: 'hide', video_ids: ['vid1'], dry_run: false, expect_count: 2 });
            expect(res.status).toBe(404);
            expect(writes()).toEqual([]);
            expect(auditCalls()).toHaveLength(0);
            expect(clientSql()).toContain('ROLLBACK');
        });

        it('keeps SQL parameterised: a hostile id is only ever a bound value', async () => {
            const evil = "x'; DROP TABLE tiktok_videos; --";
            await send({ action: 'hide', video_ids: [evil] });
            for (const s of clientSql()) expect(s).not.toContain('DROP TABLE');
            expect(callWith(/SELECT v\.id, v\.video_id/)[1][1]).toEqual([evil]);
        });

        it('rolls back and answers 500 without leaking the error', async () => {
            const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
            client.query.mockImplementation(async (sql) => {
                if (/FROM projects p JOIN users u/.test(String(sql))) return { rows: [{ id: PROJ, name: 'B', email: 'e@x.com' }] };
                if (/SELECT v\.id/.test(String(sql))) throw new Error('boom: secret detail');
                return { rows: [] };
            });
            const res = await send({ action: 'hide', video_ids: ['a'] });
            spy.mockRestore();
            expect(res.status).toBe(500);
            expect(JSON.stringify(res.body)).not.toMatch(/secret detail/);
            expect(client.release).toHaveBeenCalled();
        });

        it('succeeds even when the audit table is missing', async () => {
            const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            pool.query.mockImplementation(async (sql) => {
                if (/INSERT INTO admin_audit/.test(String(sql))) { const e = new Error('no table'); e.code = '42P01'; throw e; }
                return { rows: [] };
            });
            const res = await send({ action: 'hide', video_ids: ['vid1'], dry_run: false, expect_count: 2 });
            spy.mockRestore();
            expect(res.status).toBe(200);
            expect(res.body.affected).toBe(2);
        });
    });

    describe('GET profiles', () => {
        it('returns profile rows with state and visible post / video counts', async () => {
            pool.query.mockImplementation(async (sql) => {
                const s = String(sql);
                if (/COUNT\(\*\) AS total FROM project_profiles/.test(s)) return { rows: [{ total: '4' }] };
                if (/FROM project_profiles pf/.test(s)) {
                    return { rows: [
                        { username: 'nadine', role: 'brand', pinned: true, is_hidden: false, posts: '3', videos: '2' },
                        { username: 'bob', role: null, pinned: false, is_hidden: true, posts: '0', videos: '0' },
                    ] };
                }
                return { rows: [{ id: PROJ }] };
            });
            const res = await admin(request(app).get(PROFILES_URL));
            expect(res.status).toBe(200);
            expect(res.body.total).toBe(4);
            expect(res.body.profiles).toEqual([
                { username: 'nadine', role: 'brand', pinned: true, state: 'visible', posts: 3, videos: 2 },
                { username: 'bob', role: 'tracked', pinned: false, state: 'hidden', posts: 0, videos: 0 },
            ]);
            const call = pool.query.mock.calls.find((c) => /FROM project_profiles pf/.test(String(c[0])));
            expect(call[1]).toEqual([PROJ]);
            expect(String(call[0])).toMatch(/LIMIT 500/);
        });

        it('says to apply v12 (503) while the hide column is missing', async () => {
            pool.query.mockImplementation(async (sql) => {
                if (/FROM project_profiles pf/.test(String(sql))) { const e = new Error('x'); e.code = '42703'; throw e; }
                return { rows: [{ id: PROJ, total: 0 }] };
            });
            const res = await admin(request(app).get(PROFILES_URL));
            expect(res.status).toBe(503);
            expect(res.body.error).toMatch(/v12_project_profile_hide/);
        });

        it('404s for a project that is not the user\'s', async () => {
            projectFound = false;
            expect((await admin(request(app).get(PROFILES_URL))).status).toBe(404);
        });
    });

    describe('POST profiles/action', () => {
        const send = (body) => admin(request(app).post(PROFILE_ACTION_URL)).send(body);

        it.each([
            ['unknown action', { action: 'remove', usernames: ['a'] }],
            ['no usernames', { action: 'hide' }],
            ['empty usernames', { action: 'hide', usernames: [] }],
            ['non-string username', { action: 'hide', usernames: [3] }],
            ['blank username', { action: 'hide', usernames: ['  '] }],
            ['non-boolean with_posts', { action: 'hide', usernames: ['a'], with_posts: 'yes' }],
            ['non-boolean dry_run', { action: 'hide', usernames: ['a'], dry_run: 0 }],
            ['real run without expect_count', { action: 'hide', usernames: ['a'], dry_run: false }],
            ['bad expect_posts', { action: 'hide', usernames: ['a'], dry_run: false, expect_count: 1, expect_posts: -2 }],
        ])('400 for %s without touching the database', async (_name, body) => {
            const res = await send(body);
            expect(res.status).toBe(400);
            expect(pool.connect).not.toHaveBeenCalled();
        });

        it('accepts 1000 usernames and refuses 1001', async () => {
            const names = (n) => Array.from({ length: n }, (_, i) => `u${i}`);
            expect((await send({ action: 'hide', usernames: names(1000) })).status).toBe(200);
            expect((await send({ action: 'hide', usernames: names(1001) })).status).toBe(400);
        });

        it('dry run reports profile, post and video counts and changes nothing', async () => {
            const res = await send({ action: 'hide', usernames: ['@Nadine', 'bob', 'NADINE'], with_posts: true });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ success: true, dry_run: true, action: 'hide', affected: 2, posts_affected: 3, videos_affected: 2, with_posts: true });
            expect(res.body.sample).toEqual(['Nadine', 'bob']);
            expect(callWith(/SELECT pf\.id/)[1]).toEqual([PROJ, ['nadine', 'bob']]); // lower-cased, de-duplicated
            expect(writes()).toEqual([]);
            expect(auditCalls()).toHaveLength(0);
        });

        it('without with_posts it does not look at posts or videos', async () => {
            const res = await send({ action: 'hide', usernames: ['bob'] });
            expect(res.body).toMatchObject({ affected: 2, posts_affected: 0, videos_affected: 0, with_posts: false });
            expect(clientSql().some((s) => /FROM project_posts|FROM tiktok_videos/.test(s))).toBe(false);
        });

        it('409s when any previewed number changed', async () => {
            const a = await send({ action: 'hide', usernames: ['bob'], with_posts: true, dry_run: false, expect_count: 1 });
            expect(a.status).toBe(409);
            const b = await send({ action: 'hide', usernames: ['bob'], with_posts: true, dry_run: false, expect_count: 2, expect_posts: 9, expect_videos: 2 });
            expect(b.status).toBe(409);
            expect(b.body).toMatchObject({ affected: 2, posts_affected: 3, videos_affected: 2 });
            expect(writes()).toEqual([]);
        });

        it('hides the profile rows, posts and videos in one transaction and audits', async () => {
            const res = await send({ action: 'hide', usernames: ['Nadine', 'bob'], with_posts: true, dry_run: false, expect_count: 2, expect_posts: 3, expect_videos: 2 });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, dry_run: false, action: 'hide', affected: 2, posts_affected: 3, videos_affected: 2 });
            const prof = callWith(/UPDATE project_profiles/);
            expect(String(prof[0])).toMatch(/hidden_at = CASE WHEN \$2::boolean/);
            expect(prof[1]).toEqual([PROJ, true, ['pf1', 'pf2']]);
            expect(callWith(/UPDATE project_posts pp SET is_hidden = true/)[1]).toEqual([PROJ, ['p1', 'p2', 'p3']]);
            expect(callWith(/UPDATE tiktok_videos SET is_hidden/)[1]).toEqual([PROJ, true, ['v-row-1', 'v-row-2']]);
            expect(callWith(/UPDATE search_keywords sk/)[1]).toEqual([PROJ, [KW]]);
            expect(clientSql().filter((s) => s === 'BEGIN' || s === 'COMMIT')).toEqual(['BEGIN', 'COMMIT']);
            const audit = auditCalls();
            expect(audit[0][1][0]).toBe('project_profiles_hide');
            expect(JSON.parse(audit[0][1][3])).toMatchObject({ with_posts: true, affected: 2, posts_affected: 3, videos_affected: 2, usernames: ['Nadine', 'bob'] });
        });

        it('with_posts false changes only the profile rows', async () => {
            const res = await send({ action: 'hide', usernames: ['bob'], with_posts: false, dry_run: false, expect_count: 2 });
            expect(res.status).toBe(200);
            expect(writes().some((s) => /UPDATE project_profiles/.test(s))).toBe(true);
            expect(writes().some((s) => /project_posts|tiktok_videos|search_keywords/.test(s))).toBe(false);
        });

        it('unhide mirrors it: looks at hidden rows, clears hidden_at, unhides posts and videos', async () => {
            const res = await send({ action: 'unhide', usernames: ['bob'], with_posts: true, dry_run: false, expect_count: 2 });
            expect(res.status).toBe(200);
            expect(String(callWith(/SELECT pf\.id/)[0])).toMatch(/pf\.is_hidden = true/);
            expect(callWith(/UPDATE project_profiles/)[1][1]).toBe(false);
            expect(String(callWith(/UPDATE project_posts pp SET/)[0])).toMatch(/is_hidden = false, hidden_at = NULL/);
            expect(callWith(/UPDATE tiktok_videos SET is_hidden/)[1][1]).toBe(false);
            expect(auditCalls()[0][1][0]).toBe('project_profiles_unhide');
        });

        it('404s for a project that is not the user\'s and writes nothing', async () => {
            projectFound = false;
            const res = await send({ action: 'hide', usernames: ['bob'], dry_run: false, expect_count: 2 });
            expect(res.status).toBe(404);
            expect(writes()).toEqual([]);
            expect(auditCalls()).toHaveLength(0);
        });

        it('answers 503 and rolls back while migration v12 is not applied', async () => {
            const base = client.query.getMockImplementation();
            client.query.mockImplementation(async (sql) => {
                if (/FROM project_profiles pf/.test(String(sql))) { const e = new Error('x'); e.code = '42703'; throw e; }
                return base(sql);
            });
            const res = await send({ action: 'hide', usernames: ['bob'], dry_run: false, expect_count: 1 });
            expect(res.status).toBe(503);
            expect(res.body.error).toMatch(/v12_project_profile_hide/);
            expect(clientSql()).toContain('ROLLBACK');
            expect(writes()).toEqual([]);
        });

        it('keeps SQL parameterised for hostile usernames', async () => {
            const evil = "x'; DROP TABLE project_profiles; --";
            await send({ action: 'hide', usernames: [evil], with_posts: true });
            for (const s of clientSql()) expect(s).not.toContain('DROP TABLE');
            expect(callWith(/SELECT pf\.id/)[1][1]).toEqual([evil.toLowerCase()]);
        });
    });
});
