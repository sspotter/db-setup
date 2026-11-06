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
const ROW_IDS = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003'];
const base = `/api/admin/users/${USER}/projects/${PROJ}`;
const admin = (r) => r.set('x-admin-password', 'admin-test');
const post = (path, body) => admin(request(app).post(`${base}/${path}`).send(body));

let client;
const sqlOf = (call) => String(call[0]);
const clientSql = () => client.query.mock.calls.map(sqlOf);

function mockClient({ found = [{ id: PROJ, name: 'Barbican', email: 'nadine@x.com' }], sample = ['a', 'b', 'c'], ids = ROW_IDS, profiles = [{ id: 'pf1' }] } = {}) {
    client.query.mockImplementation(async (sql, params) => {
        const s = String(sql);
        if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(s)) return { rows: [] };
        if (/FROM projects p JOIN users u/.test(s)) return { rows: found };
        if (/array_agg/.test(s)) return { rows: [{ n: ids.length, sample }] };
        if (/FOR UPDATE OF pp/.test(s)) return { rows: ids.map((id) => ({ id })) };
        if (/FROM project_profiles WHERE .* FOR UPDATE/.test(s)) return { rows: profiles };
        if (/^\s*UPDATE project_posts/.test(s)) return { rows: [], rowCount: params[0].length };
        if (/^\s*DELETE FROM project_profiles/.test(s)) return { rows: [], rowCount: profiles.length };
        throw new Error('unexpected SQL: ' + s.slice(0, 80));
    });
}

describe('admin project posts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        client = { query: jest.fn(), release: jest.fn() };
        pool.connect.mockResolvedValue(client);
        pool.query.mockResolvedValue({ rows: [] });
        mockClient();
    });

    describe('auth', () => {
        it.each([
            ['post', `${base}/posts/action`],
            ['post', `${base}/profiles/remove`],
            ['get', `${base}/creators`],
        ])('%s %s requires the admin password and touches no database', async (method, url) => {
            const res = await request(app)[method](url).send({ action: 'hide', creator: 'x' });
            expect(res.status).toBe(401);
            expect(pool.connect).not.toHaveBeenCalled();
            expect(pool.query).not.toHaveBeenCalled();
        });
    });

    describe('POST posts/action validation', () => {
        const rejected = async (body, path = 'posts/action') => {
            const res = await post(path, body);
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(pool.connect).not.toHaveBeenCalled();
            return res;
        };

        it('rejects an unknown or missing action', async () => {
            await rejected({ action: 'purge', creator: 'x' });
            await rejected({ creator: 'x' });
            await rejected({ action: '__proto__', creator: 'x' });
        });

        it('needs exactly one of creator and shortcodes', async () => {
            await rejected({ action: 'hide' });
            await rejected({ action: 'hide', creator: 'x', shortcodes: ['a'] });
            await rejected({ action: 'hide', creator: '   ' });
        });

        it('validates the shortcodes list (type, length, 5000 cap)', async () => {
            await rejected({ action: 'hide', shortcodes: [] });
            await rejected({ action: 'hide', shortcodes: 'abc' });
            await rejected({ action: 'hide', shortcodes: ['ok', 5] });
            await rejected({ action: 'hide', shortcodes: [''] });
            await rejected({ action: 'hide', shortcodes: ['x'.repeat(101)] });
            const tooMany = await rejected({ action: 'hide', shortcodes: Array.from({ length: 5001 }, (_, i) => 's' + i) });
            expect(tooMany.body.error).toMatch(/5000/);
        });

        it('accepts exactly 5000 shortcodes', async () => {
            const res = await post('posts/action', { action: 'hide', shortcodes: Array.from({ length: 5000 }, (_, i) => 's' + i) });
            expect(res.status).toBe(200);
        });

        it('validates dry_run and expect_count', async () => {
            await rejected({ action: 'hide', creator: 'x', dry_run: 'false' });
            await rejected({ action: 'hide', creator: 'x', dry_run: false });
            await rejected({ action: 'hide', creator: 'x', dry_run: false, expect_count: '6' });
            await rejected({ action: 'hide', creator: 'x', dry_run: false, expect_count: -1 });
        });

        it('rejects malformed ids', async () => {
            const res = await admin(request(app).post(`/api/admin/users/nope/projects/${PROJ}/posts/action`).send({ action: 'hide', creator: 'x' }));
            expect(res.status).toBe(400);
            const res2 = await admin(request(app).post(`/api/admin/users/${USER}/projects/nope/posts/action`).send({ action: 'hide', creator: 'x' }));
            expect(res2.status).toBe(400);
            expect(pool.connect).not.toHaveBeenCalled();
        });
    });

    describe('POST posts/action ownership', () => {
        it('404s when the project does not belong to the user and writes nothing', async () => {
            mockClient({ found: [] });
            const res = await post('posts/action', { action: 'delete', creator: 'x', dry_run: false, expect_count: 3 });
            expect(res.status).toBe(404);
            expect(clientSql().some((s) => /UPDATE|DELETE/.test(s))).toBe(false);
            expect(clientSql()).toContain('ROLLBACK');
            expect(client.release).toHaveBeenCalledTimes(1);
            expect(pool.query).not.toHaveBeenCalled();
        });

        it('looks the project up by project AND user id', async () => {
            await post('posts/action', { action: 'hide', creator: 'x' });
            const lookup = client.query.mock.calls.find((c) => /FROM projects p JOIN users u/.test(sqlOf(c)));
            expect(lookup[1]).toEqual([PROJ, USER]);
        });
    });

    describe('POST posts/action dry run', () => {
        it('defaults to a dry run: previews, changes nothing, commits nothing', async () => {
            const res = await post('posts/action', { action: 'hide', creator: '@Jysk.ma' });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, dry_run: true, action: 'hide', affected: 3, creator: 'Jysk.ma', sample: ['a', 'b', 'c'] });
            const sqls = clientSql();
            expect(sqls.some((s) => /^\s*(UPDATE|DELETE|INSERT)/.test(s))).toBe(false);
            expect(sqls).toContain('ROLLBACK');
            expect(sqls).not.toContain('COMMIT');
            expect(pool.query).not.toHaveBeenCalled(); // no audit entry for a preview
            expect(client.release).toHaveBeenCalledTimes(1);
        });

        it('previews shortcodes with creator null', async () => {
            const res = await post('posts/action', { action: 'delete', shortcodes: ['a', 'b', 'a'], dry_run: true });
            expect(res.body.creator).toBeNull();
            const preview = client.query.mock.calls.find((c) => /array_agg/.test(sqlOf(c)));
            expect(preview[1]).toEqual([PROJ, ['a', 'b']]); // de-duplicated
        });

        it('selects links by the state each action works on', async () => {
            const wanted = {
                hide: /pp\.is_hidden = false AND pp\.deleted_at IS NULL/,
                unhide: /pp\.is_hidden = true AND pp\.deleted_at IS NULL/,
                delete: /\$1 AND pp\.deleted_at IS NULL AND (lower|pp\.post_shortcode)/,
                restore: /pp\.deleted_at IS NOT NULL/,
            };
            for (const [action, re] of Object.entries(wanted)) {
                client.query.mockClear();
                await post('posts/action', { action, creator: 'x' });
                const preview = client.query.mock.calls.find((c) => /array_agg/.test(sqlOf(c)));
                expect(sqlOf(preview)).toMatch(re);
            }
        });
    });

    describe('POST posts/action real run', () => {
        it('409s when expect_count no longer matches and changes nothing', async () => {
            const res = await post('posts/action', { action: 'hide', creator: 'x', dry_run: false, expect_count: 5 });
            expect(res.status).toBe(409);
            expect(res.body).toEqual({ success: false, error: 'count changed', affected: 3 });
            expect(clientSql().some((s) => /^\s*UPDATE/.test(s))).toBe(false);
            expect(clientSql()).toContain('ROLLBACK');
            expect(clientSql()).not.toContain('COMMIT');
            expect(pool.query).not.toHaveBeenCalled();
        });

        it.each([
            ['hide', /SET is_hidden = true, hidden_at = now\(\)/],
            ['unhide', /SET is_hidden = false, hidden_at = NULL/],
            ['delete', /SET deleted_at = now\(\)/],
            ['restore', /SET deleted_at = NULL/],
        ])('%s updates only project_posts link rows, in one transaction', async (action, setRe) => {
            const res = await post('posts/action', { action, creator: 'jysk.ma', dry_run: false, expect_count: 3 });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, dry_run: false, action, affected: 3 });
            const sqls = clientSql();
            const writes = client.query.mock.calls.filter((c) => /^\s*(UPDATE|DELETE|INSERT)/.test(sqlOf(c)));
            expect(writes).toHaveLength(1);
            expect(sqlOf(writes[0])).toMatch(/^\s*UPDATE project_posts pp/);
            expect(sqlOf(writes[0])).toMatch(setRe);
            expect(writes[0][1]).toEqual([ROW_IDS]);
            // nothing ever touches the shared posts / metrics tables
            expect(sqls.join('\n')).not.toMatch(/(UPDATE|DELETE FROM|INSERT INTO)\s+(public\.)?(posts|post_metrics_history|post_relations|comments)\b/i);
            expect(sqls[0]).toBe('BEGIN');
            expect(sqls[sqls.length - 1]).toBe('COMMIT');
            expect(client.release).toHaveBeenCalledTimes(1);
        });

        it('locks the rows it is about to change', async () => {
            await post('posts/action', { action: 'hide', creator: 'x', dry_run: false, expect_count: 3 });
            expect(clientSql().some((s) => /FOR UPDATE OF pp/.test(s))).toBe(true);
        });

        it('allows a real run with expect_count 0 and writes nothing', async () => {
            mockClient({ ids: [] });
            const res = await post('posts/action', { action: 'hide', creator: 'x', dry_run: false, expect_count: 0 });
            expect(res.status).toBe(200);
            expect(res.body.affected).toBe(0);
            expect(clientSql().some((s) => /^\s*UPDATE/.test(s))).toBe(false);
        });

        it('writes an audit entry with admin, user, project, action, creator and count', async () => {
            await post('posts/action', { action: 'delete', creator: 'jysk.ma', dry_run: false, expect_count: 3 });
            const audit = pool.query.mock.calls.find((c) => /INSERT INTO admin_audit/.test(sqlOf(c)));
            expect(audit).toBeDefined();
            const [action, userId, email, detail, , actor] = audit[1];
            expect(action).toBe('project_posts_delete');
            expect(userId).toBe(USER);
            expect(email).toBe('nadine@x.com');
            expect(actor).toBe('shared-password');
            expect(JSON.parse(detail)).toMatchObject({ project_id: PROJ, project_name: 'Barbican', post_action: 'delete', creator: 'jysk.ma', affected: 3 });
        });

        it('still succeeds when the audit table is missing', async () => {
            pool.query.mockRejectedValue(Object.assign(new Error('relation "admin_audit" does not exist'), { code: '42P01' }));
            const res = await post('posts/action', { action: 'hide', creator: 'x', dry_run: false, expect_count: 3 });
            expect(res.status).toBe(200);
            expect(res.body.affected).toBe(3);
        });

        it('rolls back and answers 500 on a database error, releasing the client', async () => {
            client.query.mockImplementation(async (sql) => {
                const s = String(sql);
                if (/^\s*(BEGIN|ROLLBACK)/.test(s)) return { rows: [] };
                if (/FROM projects p JOIN users u/.test(s)) return { rows: [{ id: PROJ, name: 'Barbican', email: 'n@x.com' }] };
                throw new Error('boom');
            });
            const res = await post('posts/action', { action: 'hide', creator: 'x', dry_run: false, expect_count: 3 });
            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Internal server error');
            expect(clientSql()).toContain('ROLLBACK');
            expect(client.release).toHaveBeenCalledTimes(1);
        });

        it('answers 503 with a hint when migration v11 has not been applied', async () => {
            client.query.mockImplementation(async (sql) => {
                const s = String(sql);
                if (/^\s*(BEGIN|ROLLBACK)/.test(s)) return { rows: [] };
                if (/FROM projects p JOIN users u/.test(s)) return { rows: [{ id: PROJ, name: 'Barbican', email: 'n@x.com' }] };
                throw Object.assign(new Error('column pp.is_hidden does not exist'), { code: '42703' });
            });
            const res = await post('posts/action', { action: 'hide', creator: 'x' });
            expect(res.status).toBe(503);
            expect(res.body.error).toMatch(/v11_project_post_hide/);
        });
    });

    describe('SQL is parameterised', () => {
        const EVIL = "x'); DROP TABLE posts; --";

        it('never puts the creator or a shortcode into SQL text', async () => {
            await post('posts/action', { action: 'hide', creator: EVIL, dry_run: false, expect_count: 3 });
            await post('posts/action', { action: 'delete', shortcodes: [EVIL], dry_run: false, expect_count: 3 });
            await post('profiles/remove', { username: EVIL, with_posts: true, dry_run: false, expect_count: 3 });
            const calls = [...client.query.mock.calls, ...pool.query.mock.calls];
            for (const c of calls) expect(sqlOf(c)).not.toContain('DROP TABLE');
            const bound = client.query.mock.calls.filter((c) => JSON.stringify(c[1] || []).includes('DROP TABLE'));
            expect(bound.length).toBeGreaterThan(0);
        });
    });

    describe('POST profiles/remove', () => {
        it('validates its body', async () => {
            for (const body of [{}, { username: '' }, { username: 'x', with_posts: 'yes' }, { username: 'x', dry_run: false }]) {
                const res = await post('profiles/remove', body);
                expect(res.status).toBe(400);
            }
            expect(pool.connect).not.toHaveBeenCalled();
        });

        it('previews the post count and profile rows without changing anything', async () => {
            const res = await post('profiles/remove', { username: '@jysk.ma', with_posts: true });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ success: true, dry_run: true, affected: 3, profile_rows: 1, creator: 'jysk.ma', with_posts: true });
            expect(clientSql().some((s) => /^\s*(UPDATE|DELETE|INSERT)/.test(s))).toBe(false);
            expect(clientSql()).toContain('ROLLBACK');
        });

        it('409s when expect_count changed', async () => {
            const res = await post('profiles/remove', { username: 'jysk.ma', with_posts: true, dry_run: false, expect_count: 2 });
            expect(res.status).toBe(409);
            expect(res.body.affected).toBe(3);
            expect(clientSql().some((s) => /^\s*(UPDATE|DELETE)/.test(s))).toBe(false);
        });

        it('soft-deletes the creator\'s links and removes the profile row, nothing else', async () => {
            const res = await post('profiles/remove', { username: 'jysk.ma', with_posts: true, dry_run: false, expect_count: 3 });
            expect(res.body).toEqual({ success: true, dry_run: false, action: 'remove_creator', affected: 3, profile_rows: 1 });
            const writes = client.query.mock.calls.filter((c) => /^\s*(UPDATE|DELETE|INSERT)/.test(sqlOf(c)));
            expect(writes.map((c) => sqlOf(c).trim().split(/\s+/).slice(0, 3).join(' '))).toEqual(['UPDATE project_posts pp', 'DELETE FROM project_profiles']);
            expect(sqlOf(writes[0])).toMatch(/SET deleted_at = now\(\)/);
            expect(clientSql().join('\n')).not.toMatch(/(UPDATE|DELETE FROM)\s+(public\.)?(posts|post_metrics_history)\b/i);
            expect(clientSql()).toContain('COMMIT');
            const audit = pool.query.mock.calls.find((c) => /INSERT INTO admin_audit/.test(sqlOf(c)));
            expect(audit[1][0]).toBe('project_profile_remove');
            expect(JSON.parse(audit[1][3])).toMatchObject({ creator: 'jysk.ma', with_posts: true, affected: 3, profile_rows: 1 });
        });

        it('without with_posts only the profile row is removed (affected 0)', async () => {
            const res = await post('profiles/remove', { username: 'jysk.ma', dry_run: false, expect_count: 0 });
            expect(res.body).toMatchObject({ success: true, affected: 0, profile_rows: 1 });
            expect(clientSql().some((s) => /^\s*UPDATE project_posts/.test(s))).toBe(false);
        });

        it('404s when the creator is not in the project', async () => {
            mockClient({ profiles: [], ids: [] });
            const res = await post('profiles/remove', { username: 'ghost', with_posts: true });
            expect(res.status).toBe(404);
        });

        it('404s for a project of another user', async () => {
            mockClient({ found: [] });
            const res = await post('profiles/remove', { username: 'jysk.ma', with_posts: true });
            expect(res.status).toBe(404);
        });
    });

    describe('GET creators', () => {
        it('checks ownership then returns per-creator counts', async () => {
            pool.query
                .mockResolvedValueOnce({ rows: [{ id: PROJ }] })
                .mockResolvedValueOnce({ rows: [{ username: 'jysk.ma', role: 'tracked', visible: 2, hidden: 3, deleted: 1 }] });
            const res = await admin(request(app).get(`${base}/creators`));
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, creators: [{ username: 'jysk.ma', role: 'tracked', visible: 2, hidden: 3, deleted: 1 }] });
            expect(pool.query.mock.calls[0][1]).toEqual([PROJ, USER]);
            expect(sqlOf(pool.query.mock.calls[1])).toMatch(/pp\.deleted_at IS NOT NULL/);
        });

        it('404s for a project of another user', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] });
            const res = await admin(request(app).get(`${base}/creators`));
            expect(res.status).toBe(404);
            expect(pool.query).toHaveBeenCalledTimes(1);
        });
    });
});
