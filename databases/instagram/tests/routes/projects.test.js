const request = require('supertest');
const express = require('express');
const projectsRouter = require('../../routes/projects');
const pool = require('../../db');

// Mock the database pool
jest.mock('../../db', () => ({
    query: jest.fn(),
    end: jest.fn()
}));

const app = express();
app.use(express.json());

// Mock Auth Middleware
app.use((req, res, next) => {
    req.user = { id: 1 }; // Mocked user ID
    next();
});

// Mount the router
app.use('/api', projectsRouter);

describe('Projects API Endpoints', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/projects', () => {
        it('should create a new project and return 201', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 123, user_id: 1, name: 'Test Campaign', description: 'Test desc' }]
            });

            const res = await request(app)
                .post('/api/projects')
                .send({ name: 'Test Campaign', description: 'Test desc' });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.project.id).toBe(123);
            expect(pool.query).toHaveBeenCalledTimes(1);
        });

        it('should return 400 if project name is missing', async () => {
            const res = await request(app)
                .post('/api/projects')
                .send({ description: 'Test desc' });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(pool.query).not.toHaveBeenCalled();
        });
    });

    describe('GET /api/projects', () => {
        it('should return all projects for the user', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [
                    { id: 1, name: 'Proj 1', profile_count: 5, post_count: 10, collab_post_count: 2 },
                    { id: 2, name: 'Proj 2', profile_count: 0, post_count: 0, collab_post_count: 0 }
                ]
            });

            const res = await request(app).get('/api/projects');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.projects.length).toBe(2);
            expect(pool.query).toHaveBeenCalledTimes(1);
        });
    });

    describe('GET /api/projects/:id', () => {
        it('should return a specific project with details', async () => {
            // Mock ownership check
            pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Proj 1' }] });
            // Mock full project row
            pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Proj 1', description: 'desc' }] });
            // Mock getProjectReachAndStats calls 
            // 1. basic stats
            pool.query.mockResolvedValueOnce({ rows: [{ profile_count: '5', post_count: '10', comment_count: '50', collab_post_count: '2' }] });
            // 2. partners stats
            pool.query.mockResolvedValueOnce({ rows: [{ username: 'partner1', follower_count: '1000', posts_involved: '1', potential_impressions: '1000', role: 'influencer' }] });

            const res = await request(app).get('/api/projects/1');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.project.id).toBe(1);
            expect(res.body.project.stats).toBeDefined();
            expect(res.body.project.stats.reach).toBe(1000);
        });

        it('should return 404 if project is not owned by user', async () => {
            pool.query.mockResolvedValueOnce({ rows: [] }); // Ownership check fails

            const res = await request(app).get('/api/projects/999');

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });

    describe('DELETE /api/projects/:id', () => {
        it('should delete a project successfully', async () => {
            pool.query.mockResolvedValueOnce({
                rows: [{ id: 1, name: 'Proj 1' }]
            });

            const res = await request(app).delete('/api/projects/1');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.id).toBe(1);
        });
    });
    
    describe('GET /api/projects/:id/profiles', () => {
        it('should return profiles inside a project', async () => {
            // Ownership check
            pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Proj 1' }] });
            // Profiles select
            pool.query.mockResolvedValueOnce({ 
                rows: [
                    { username: 'target1', follower_count: '5000', project_role: 'tracked', pinned: false, post_count: '10' }
                ] 
            });

            const res = await request(app).get('/api/projects/1/profiles');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.profiles.length).toBe(1);
            expect(res.body.profiles[0].username).toBe('target1');
        });
    });
});
