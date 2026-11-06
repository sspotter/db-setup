const request = require('supertest');
const express = require('express');
const pool = require('../../db');

jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));

process.env.ADMIN_PASSWORD = 'admin-test';
const adminProjectPosts = require('../../routes/adminProjectPosts');

const app = express();
app.use(express.json());
app.use('/api/admin', adminProjectPosts);

const USER = '11111111-1111-4111-8111-111111111111';
const PROJ = '22222222-2222-4222-8222-222222222222';
const base = `/api/admin/users/${USER}/projects/${PROJ}`;
const ACTION_URL = `${base}/posts/action`;
const REMOVE_URL = `${base}/profiles/remove`;
const CREATORS_URL = `${base}/creators`;
const admin = (r) => r.set('x-admin-password', 'admin-test');
const codes = (n) => Array.from({ length: n }, (_, i) => `c${String(i + 1).padStart(3, '0')}`);

describe('admin project posts', () => {
    let client;
    let matched; // shortcodes the "SELECT pp.post_shortcode" query returns
    let profileRows;
    let projectFound;

    const clientSql = () => client.query.mock.calls.map((c) => String(c[0]));
    const writes = () => clientSql().filter((s) => /^\s*(UPDATE|DELETE|INSERT)/i.test(s));
    const auditCalls = () => pool.query.mock.calls.filter((c) => /INSERT INTO admin_audit/.test(String(c[0])));

    beforeEach(() => {
        jest.clearAllMocks();
        matched = codes(3);
        profileRows = 1;
        projectFound = true;
        client = { release: jest.fn() };
        client.query = jest.fn(async (sql) => {
            const s = String(sql);
            if (/FROM projects p JOIN users u/.test(s)) {
                return { rows: projectFound ? [{ id: PROJ, name: 'Barbican', email: 'nadine@example.com' }] : [] };
            }
            if (/SELECT pp\.post_shortcode/.test(s)) return { rows: matched.map((post_shortcode) => ({ post_shortcode })) };
            if (/SELECT id FROM project_profiles/.test(s)) return { rows: Array.from({ length: profileRows }, (_, i) => ({ id: `r${i}` })) };
            return { rows: [], rowCount: 0 };
        });
        pool.connect.mockResolvedValue(client);
        pool.query.mockResolvedValue({ rows: [] });
    });

    describe('authentication', () => {
        it('requires the admin password on all three routes and touches no database', async () => {
            for (const r of [
                request(app).get(CREATORS_URL),
                request(app).post(ACTION_URL).send({ action: 'hide', creator: 'a' }),
                request(app).post(REMOVE_URL).send({ username: 'a' }),
            ]) {
                expect((await r).status).toBe(401);
            }
            expect(pool.connect).not.toHaveBeenCalled();
            expect(pool.query).not.toHaveBeenCalled();
        });
    });

    describe('POST posts/action validation', () => {
        const rejected = async (body, url = ACTION_URL) => {
            const res = await admin(request(app).post(url)).send(body);
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(pool.connect).not.toHaveBeenCalled();
            return res;
        };

        it('rejects malformed ids', async () => {
            const res = await admin(request(app).post(`/api/admin/users/nope/projects/${PROJ}/posts/action`)).send({ action: 'hide', creator: 'a' });
            expect(res.status).toBe(400);
            const res2 = await admin(request(app).post(`/api/admin/users/${USER}/projects/nope/posts/action`)).send({ action: 'hide', creator: 'a' });
            expect(res2.status).toBe(400);
            expect(pool.connect).not.toHaveBeenCalled();
        });

        it('rejects an unknown or missing action', async () => {
            await rejected({ action: 'purge', creator: 'a' });
            await rejected({ action: 'constructor', creator: 'a' });
            await rejected({ creator: 'a' });
        });

        it('needs exactly one of creator or shortcodes', async () => {
            await rejected({ action: 'hide' });
            await rejected({ action: 'hide', creator: 'a', shortcodes: ['x'] });
        });

        it('validates shortcodes: non-empty array, cap of 5000, strings of sane length', async () => {
            await rejected({ action: 'hide', shortcodes: [] });
            await rejected({ action: 'hide', shortcodes: 'abc' });
            await rejected({ action: 'hide', shortcodes: codes(5001) });
            await rejected({ action: 'hide', shortcodes: ['ok', 7] });
            await rejected({ action: 'hide', shortcodes: [''] });
            await rejected({ action: 'hide', shortcodes: ['x'.repeat(256)] });
        });

        it('accepts exactly 5000 shortcodes', async () => {
            matched = [];
            const res = await admin(request(app).post(ACTION_URL)).send({ action: 'hide', shortcodes: codes(5000) });
            expect(res.status).toBe(200);
        });

        it('validates creator, dry_run and expect_count', async () => {
            await rejected({ action: 'hide', creator: '   ' });
            await rejected({ action: 'hide', creator: 5 });
            await rejected({ action: 'hide', creator: 'a', dry_run: 'false' });
            await rejected({ action: 'hide', creator: 'a', dry_run: false });
            await rejected({ action: 'hide', creator: 'a', dry_run: false, expect_count: '3' });
            await rejected({ action: 'hide', creator: 'a', dry_run: false, expect_count: -1 });
        });
    });

    describe('POST posts/action', () => {
        it('404s when the project is not this user\'s and changes nothing', async () => {
            projectFound = false;
            const res = await admin(request(app).post(ACTION_URL)).send({ action: 'hide', creator: 'a', dry_run: false, expect_count: 1 });
            expect(res.status).toBe(404);
            expect(writes()).toEqual([]);
            expect(clientSql()).toContain('ROLLBACK');
            expect(auditCalls()).toHaveLength(0);
            expect(client.release).toHaveBeenCalled();
        });

        it('is a dry run by default: reports the count and a sample, writes and audits nothing', async () => {
            matched = codes(25);
            const res = await admin(request(app).post(ACTION_URL)).send({ action: 'hide', creator: '@Nadine' });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, dry_run: true, action: 'hide', affected: 25, creator: 'Nadine', sample: codes(10) });
            expect(writes()).toEqual([]);
            expect(clientSql().some((s) => /FOR UPDATE/.test(s))).toBe(false);
            expect(clientSql()).toContain('ROLLBACK');
            expect(clientSql()).not.toContain('COMMIT');
            expect(auditCalls()).toHaveLength(0);
        });

        it('reports creator null for a shortcode selection', async () => {
            const res = await admin(request(app).post(ACTION_URL)).send({ action: 'hide', shortcodes: ['c001', 'c001', 'c002'], dry_run: true });
            expect(res.body.creator).toBeNull();
            const select = client.query.mock.calls.find((c) => /SELECT pp\.post_shortcode/.test(String(c[0])));
            expect(select[1]).toEqual([PROJ, ['c001', 'c002']]); // duplicates removed
        });

        it('answers 409 with the current count when expect_count is stale, and changes nothing', async () => {
            matched = codes(4);
            const res = await admin(request(app).post(ACTION_URL)).send({ action: 'delete', creator: 'a', dry_run: false, expect_count: 3 });
            expect(res.status).toBe(409);
            expect(res.body).toEqual({ success: false, error: 'count changed', affected: 4 });
            expect(writes()).toEqual([]);
            expect(clientSql()).toContain('ROLLBACK');
            expect(auditCalls()).toHaveLength(0);
        });

        it('applies the action in one transaction, with locked rows, and writes an audit entry', async () => {
            matched = codes(3);
            const res = await admin(request(app).post(ACTION_URL)).send({ action: 'hide', creator: 'Nadine', dry_run: false, expect_count: 3 });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, dry_run: false, action: 'hide', affected: 3 });

            const sql = clientSql();
            expect(sql[0]).toBe('BEGIN');
            expect(sql[sql.length - 1]).toBe('COMMIT');
            expect(sql.filter((s) => s === 'BEGIN')).toHaveLength(1);
            expect(sql.some((s) => /FOR UPDATE OF pp/.test(s))).toBe(true);

            const upd = client.query.mock.calls.find((c) => /UPDATE project_posts/.test(String(c[0])));
            expect(String(upd[0])).toMatch(/SET is_hidden = true, hidden_at = CURRENT_TIMESTAMP/);
            expect(upd[1]).toEqual([PROJ, codes(3)]);
            expect(client.release).toHaveBeenCalled();

            expect(auditCalls()).toHaveLength(1);
            const [auditSql, params] = auditCalls()[0];
            expect(String(auditSql)).toMatch(/INSERT INTO admin_audit/);
            expect(params[0]).toBe('project_posts_hide');
            expect(params[1]).toBe(USER);
            expect(params[2]).toBe('nadine@example.com');
            expect(JSON.parse(params[3])).toMatchObject({ project_id: PROJ, project_name: 'Barbican', creator: 'Nadine', affected: 3 });
            expect(params[5]).toBe('shared-password'); // the admin identity
        });

        it('does nothing but still succeeds when no link matches', async () => {
            matched = [];
            const res = await admin(request(app).post(ACTION_URL)).send({ action: 'restore', shortcodes: ['x'], dry_run: false, expect_count: 0 });
            expect(res.status).toBe(200);
            expect(res.body.affected).toBe(0);
            expect(writes()).toEqual([]);
        });

        it('acts on the right links for each action and delete is a soft delete', async () => {
            const where = {};
            for (const action of ['hide', 'unhide', 'delete', 'restore']) {
                client.query.mockClear();
                await admin(request(app).post(ACTION_URL)).send({ action, shortcodes: ['c001'], dry_run: true });
                where[action] = String(client.query.mock.calls.find((c) => /SELECT pp\.post_shortcode/.test(String(c[0])))[0]);
            }
            expect(where.hide).toMatch(/pp\.is_hidden = false AND pp\.deleted_at IS NULL/);
            expect(where.unhide).toMatch(/pp\.is_hidden = true AND pp\.deleted_at IS NULL/);
            expect(where.delete).toMatch(/pp\.deleted_at IS NULL/);
            expect(where.restore).toMatch(/pp\.deleted_at IS NOT NULL/);

            client.query.mockClear();
            matched = ['c001'];
            await admin(request(app).post(ACTION_URL)).send({ action: 'delete', shortcodes: ['c001'], dry_run: false, expect_count: 1 });
            const upd = String(client.query.mock.calls.find((c) => /UPDATE project_posts/.test(String(c[0])))[0]);
            expect(upd).toMatch(/deleted_at = CURRENT_TIMESTAMP/);
            expect(upd).toMatch(/is_hidden = true/);

            client.query.mockClear();
            await admin(request(app).post(ACTION_URL)).send({ action: 'restore', shortcodes: ['c001'], dry_run: false, expect_count: 1 });
            const res = String(client.query.mock.calls.find((c) => /UPDATE project_posts/.test(String(c[0])))[0]);
            expect(res).toMatch(/deleted_at = NULL/);
            expect(res).toMatch(/is_hidden = false/);
        });

        it('only ever updates project_posts and the same project\'s tiktok_videos: never posts, history or link rows', async () => {
            matched = ['c001'];
            for (const action of ['hide', 'unhide', 'delete', 'restore']) {
                client.query.mockClear();
                await admin(request(app).post(ACTION_URL)).send({ action, creator: 'a', dry_run: false, expect_count: 1 });
                const w = writes();
                expect(w).toHaveLength(2);
                expect(w[0]).toMatch(/^\s*UPDATE project_posts pp SET/);
                expect(w[1]).toMatch(/^\s*UPDATE tiktok_videos SET is_hidden = \$3::boolean/);
                expect(w[1]).toMatch(/WHERE project_id = \$1 AND video_id = ANY/);
                expect(clientSql().join('\n')).not.toMatch(/DELETE\s+FROM|UPDATE\s+posts\b|post_metrics_history|INSERT/i);
            }
        });

        it('mirrors hide/delete as hidden and unhide/restore as visible on tiktok_videos', async () => {
            matched = ['c001'];
            const flag = {};
            for (const action of ['hide', 'unhide', 'delete', 'restore']) {
                client.query.mockClear();
                await admin(request(app).post(ACTION_URL)).send({ action, creator: 'a', dry_run: false, expect_count: 1 });
                flag[action] = client.query.mock.calls.find((c) => /UPDATE tiktok_videos/.test(String(c[0])))[1][2];
            }
            expect(flag).toEqual({ hide: true, unhide: false, delete: true, restore: false });
        });

        it('keeps user input out of the SQL text (parameterised)', async () => {
            const evil = "x'; DROP TABLE posts; --";
            matched = ['c001'];
            await admin(request(app).post(ACTION_URL)).send({ action: 'hide', creator: evil, dry_run: false, expect_count: 1 });
            await admin(request(app).post(ACTION_URL)).send({ action: 'hide', shortcodes: [evil], dry_run: false, expect_count: 1 });
            for (const sql of clientSql()) expect(sql).not.toMatch(/DROP TABLE|x';/);
            expect(client.query.mock.calls.some((c) => Array.isArray(c[1]) && c[1].includes(evil))).toBe(true);
        });

        it('matches the creator case-insensitively', async () => {
            await admin(request(app).post(ACTION_URL)).send({ action: 'hide', creator: 'Nadine', dry_run: true });
            const select = String(client.query.mock.calls.find((c) => /SELECT pp\.post_shortcode/.test(String(c[0])))[0]);
            expect(select).toMatch(/lower\(p\.owner_username\) = lower\(\$2\)/);
        });

        it('still succeeds when the audit table is missing', async () => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const err = new Error('relation "admin_audit" does not exist');
            err.code = '42P01';
            pool.query.mockRejectedValue(err);
            const res = await admin(request(app).post(ACTION_URL)).send({ action: 'hide', creator: 'a', dry_run: false, expect_count: 3 });
            warn.mockRestore();
            expect(res.status).toBe(200);
            expect(res.body.affected).toBe(3);
        });

        it('rolls back and answers 500 without leaking the error text on a database failure', async () => {
            const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
            client.query.mockImplementation(async (sql) => {
                if (/SELECT pp\.post_shortcode/.test(String(sql))) throw new Error('boom: secret detail');
                if (/FROM projects p JOIN users u/.test(String(sql))) return { rows: [{ id: PROJ, name: 'B', email: 'e' }] };
                return { rows: [] };
            });
            const res = await admin(request(app).post(ACTION_URL)).send({ action: 'hide', creator: 'a' });
            spy.mockRestore();
            expect(res.status).toBe(500);
            expect(JSON.stringify(res.body)).not.toMatch(/secret detail/);
            expect(client.query).toHaveBeenCalledWith('ROLLBACK');
            expect(client.release).toHaveBeenCalled();
        });
    });

    describe('POST profiles/remove', () => {
        it('validates its input', async () => {
            for (const body of [{}, { username: '' }, { username: 4 }, { username: 'a', with_posts: 'yes' }, { username: 'a', dry_run: 0 }, { username: 'a', dry_run: false }]) {
                const res = await admin(request(app).post(REMOVE_URL)).send(body);
                expect(res.status).toBe(400);
            }
            expect(pool.connect).not.toHaveBeenCalled();
        });

        it('404s when the project is not this user\'s', async () => {
            projectFound = false;
            const res = await admin(request(app).post(REMOVE_URL)).send({ username: 'a' });
            expect(res.status).toBe(404);
            expect(writes()).toEqual([]);
        });

        it('dry run reports posts and profile rows and changes nothing', async () => {
            matched = codes(7);
            profileRows = 1;
            const res = await admin(request(app).post(REMOVE_URL)).send({ username: 'Nadine', with_posts: true });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ success: true, dry_run: true, affected: 7, profile_rows: 1 });
            expect(writes()).toEqual([]);
            expect(auditCalls()).toHaveLength(0);
        });

        it('without with_posts the posts are left alone and affected is 0', async () => {
            const res = await admin(request(app).post(REMOVE_URL)).send({ username: 'Nadine' });
            expect(res.body.affected).toBe(0);
            expect(clientSql().some((s) => /SELECT pp\.post_shortcode/.test(s))).toBe(false);
        });

        it('409s on a stale expect_count without changing anything', async () => {
            matched = codes(7);
            const res = await admin(request(app).post(REMOVE_URL)).send({ username: 'Nadine', with_posts: true, dry_run: false, expect_count: 6 });
            expect(res.status).toBe(409);
            expect(res.body).toMatchObject({ success: false, error: 'count changed', affected: 7 });
            expect(writes()).toEqual([]);
        });

        it('removes the profile and soft-deletes the posts, then audits', async () => {
            matched = codes(7);
            const res = await admin(request(app).post(REMOVE_URL)).send({ username: 'Nadine', with_posts: true, dry_run: false, expect_count: 7 });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, dry_run: false, action: 'remove', affected: 7, profile_rows: 1 });
            const w = writes();
            expect(w[0]).toMatch(/UPDATE project_posts pp SET is_hidden = true.*deleted_at = CURRENT_TIMESTAMP/s);
            expect(w.some((s) => /DELETE FROM project_profiles WHERE project_id = \$1 AND lower\(username\) = lower\(\$2\)/.test(s))).toBe(true);
            expect(clientSql().join('\n')).not.toMatch(/DELETE\s+FROM\s+(posts|project_posts|post_metrics_history)\b/i);
            expect(clientSql()[clientSql().length - 1]).toBe('COMMIT');
            const [, params] = auditCalls()[0];
            expect(params[0]).toBe('project_creator_remove');
            expect(JSON.parse(params[3])).toMatchObject({ creator: 'Nadine', with_posts: true, affected: 7, profile_rows: 1 });
        });

        it('with with_posts false removes only the profile row and needs expect_count 0', async () => {
            const res = await admin(request(app).post(REMOVE_URL)).send({ username: 'Nadine', dry_run: false, expect_count: 0 });
            expect(res.status).toBe(200);
            const w = writes();
            expect(w).toHaveLength(1);
            expect(w[0]).toMatch(/DELETE FROM project_profiles/);
        });
    });

    describe('POST profiles/remove with usernames[] (bulk)', () => {
        it('rejects an empty, oversized or non-string list', async () => {
            for (const usernames of [[], 'a', [1], Array.from({ length: 201 }, (_, i) => `u${i}`)]) {
                const res = await admin(request(app).post(REMOVE_URL)).send({ usernames });
                expect(res.status).toBe(400);
            }
            expect(pool.connect).not.toHaveBeenCalled();
        });

        it('previews posts (de-duplicated) and profile rows over all names', async () => {
            matched = codes(3);
            profileRows = 1;
            const res = await admin(request(app).post(REMOVE_URL)).send({ usernames: ['A', 'a', 'b'], with_posts: true });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ dry_run: true, affected: 3, profile_rows: 2 });
            expect(writes()).toEqual([]);
        });

        it('removes every named profile, soft-deletes the posts once and audits', async () => {
            matched = codes(3);
            const res = await admin(request(app).post(REMOVE_URL)).send({ usernames: ['a', 'b'], with_posts: true, dry_run: false, expect_count: 3 });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ affected: 3, profile_rows: 2 });
            expect(writes().filter((s) => /DELETE FROM project_profiles/.test(s))).toHaveLength(2);
            expect(writes().filter((s) => /UPDATE project_posts pp SET/.test(s))).toHaveLength(1);
            const [, params] = auditCalls()[0];
            expect(params[0]).toBe('project_creator_remove');
            expect(JSON.parse(params[3])).toMatchObject({ usernames: ['a', 'b'] });
        });
    });

    describe('GET creators', () => {
        it('rejects malformed ids', async () => {
            const res = await admin(request(app).get(`/api/admin/users/${USER}/projects/nope/creators`));
            expect(res.status).toBe(400);
        });

        it('404s when the project is not this user\'s', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });
            const res = await admin(request(app).get(CREATORS_URL));
            expect(res.status).toBe(404);
            expect(pool.query.mock.calls[0][1]).toEqual([PROJ, USER]);
        });

        it('returns the per-creator counts of this project', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ id: PROJ }] });
            const rows = [{ username: 'Nadine', role: 'brand', visible: 3, hidden: 1, deleted: 2 }];
            pool.query.mockResolvedValueOnce({ rows });
            const res = await admin(request(app).get(CREATORS_URL));
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, creators: rows });
            const [sql, params] = pool.query.mock.calls[1];
            expect(params).toEqual([PROJ]);
            expect(String(sql)).toMatch(/pp\.is_hidden = true AND pp\.deleted_at IS NULL/);
            expect(String(sql)).toMatch(/pp\.deleted_at IS NOT NULL/);
            expect(String(sql)).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
        });
    });
});
