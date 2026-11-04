const request = require('supertest');
const express = require('express');
const pool = require('../../db');

jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));

process.env.ADMIN_PASSWORD = 'admin-test';
const adminProjects = require('../../routes/adminProjects');

const app = express();
app.use(express.json());
app.use('/api/admin', adminProjects);

const USER = '11111111-1111-4111-8111-111111111111';
const PROJ = '22222222-2222-4222-8222-222222222222';
const url = `/api/admin/users/${USER}/projects/${PROJ}`;
const admin = (r) => r.set('x-admin-password', 'admin-test');

describe('admin projects', () => {
    let client;
    beforeEach(() => {
        jest.clearAllMocks();
        client = { query: jest.fn(), release: jest.fn() };
        pool.connect.mockResolvedValue(client);
    });

    describe('GET /users/:userId/projects', () => {
        it('requires the admin password', async () => {
            const res = await request(app).get(`/api/admin/users/${USER}/projects`);
            expect(res.status).toBe(401);
            expect(pool.query).not.toHaveBeenCalled();
        });

        it('lists only the given user\'s projects', async () => {
            pool.query.mockResolvedValue({ rows: [{ id: PROJ, name: 'Barbican', post_count: 64, profile_count: 1 }] });
            const res = await admin(request(app).get(`/api/admin/users/${USER}/projects`));
            expect(res.status).toBe(200);
            expect(res.body.projects).toHaveLength(1);
            expect(pool.query.mock.calls[0][1]).toEqual([USER]);
        });

        it('rejects a malformed user id without querying', async () => {
            const res = await admin(request(app).get('/api/admin/users/nope/projects'));
            expect(res.status).toBe(400);
            expect(pool.query).not.toHaveBeenCalled();
        });
    });

    describe('DELETE /users/:userId/projects/:projectId', () => {
        it('requires the admin password and touches no database', async () => {
            const res = await request(app).delete(url).send({ confirm_name: 'Barbican' });
            expect(res.status).toBe(401);
            expect(pool.connect).not.toHaveBeenCalled();
        });

        it('404s and deletes nothing when the project is not this user\'s', async () => {
            client.query.mockResolvedValueOnce(undefined)          // BEGIN
                        .mockResolvedValueOnce({ rows: [] })       // lookup
                        .mockResolvedValueOnce(undefined);         // ROLLBACK
            const res = await admin(request(app).delete(url)).send({ confirm_name: 'Barbican' });
            expect(res.status).toBe(404);
            expect(client.query.mock.calls.map((c) => c[0])).not.toContainEqual(expect.stringContaining('DELETE'));
            expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
            expect(client.release).toHaveBeenCalled();
        });

        it('refuses when confirm_name does not match, and deletes nothing', async () => {
            client.query.mockResolvedValueOnce(undefined)
                        .mockResolvedValueOnce({ rows: [{ id: PROJ, name: 'Barbican' }] })
                        .mockResolvedValueOnce(undefined);
            const res = await admin(request(app).delete(url)).send({ confirm_name: 'barbican' });
            expect(res.status).toBe(400);
            expect(client.query.mock.calls.map((c) => String(c[0]))).not.toContain('DELETE FROM projects WHERE id = $1');
            expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
        });

        it('deletes the project, then only the posts nobody else uses, in one transaction', async () => {
            client.query.mockResolvedValueOnce(undefined)                                         // BEGIN
                        .mockResolvedValueOnce({ rows: [{ id: PROJ, name: 'Barbican' }] })        // lookup
                        .mockResolvedValueOnce({ rows: [{ post_shortcode: 'a' }, { post_shortcode: 'b' }, { post_shortcode: 'c' }] })
                        .mockResolvedValueOnce({ rows: [] })                                      // DELETE project
                        .mockResolvedValueOnce({ rows: [{ shortcode: 'c' }] })                    // orphaned posts
                        .mockResolvedValueOnce(undefined);                                        // COMMIT

            const res = await admin(request(app).delete(url)).send({ confirm_name: 'Barbican' });

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ success: true, links_removed: 3, posts_deleted: 1, posts_kept: 2 });
            const sqls = client.query.mock.calls.map((c) => String(c[0]));
            const orphanSql = sqls.find((s) => s.includes('DELETE FROM posts'));
            expect(orphanSql).toContain('NOT EXISTS (SELECT 1 FROM project_posts');
            expect(orphanSql).toContain('NOT EXISTS (SELECT 1 FROM user_scraped_posts');
            expect(client.query.mock.calls.find((c) => String(c[0]).includes('DELETE FROM posts'))[1]).toEqual([['a', 'b', 'c']]);
            expect(client.query).toHaveBeenLastCalledWith('COMMIT');
            expect(client.release).toHaveBeenCalled();
        });

        it('rolls back and returns 500 when a statement fails', async () => {
            client.query.mockResolvedValueOnce(undefined)
                        .mockResolvedValueOnce({ rows: [{ id: PROJ, name: 'Barbican' }] })
                        .mockRejectedValueOnce(new Error('boom'))
                        .mockResolvedValueOnce(undefined);                                        // ROLLBACK
            const res = await admin(request(app).delete(url)).send({ confirm_name: 'Barbican' });
            expect(res.status).toBe(500);
            expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
            expect(client.release).toHaveBeenCalled();
        });

        it('rejects malformed ids before opening a connection', async () => {
            const res = await admin(request(app).delete(`/api/admin/users/${USER}/projects/xyz`)).send({ confirm_name: 'x' });
            expect(res.status).toBe(400);
            expect(pool.connect).not.toHaveBeenCalled();
        });
    });
});
