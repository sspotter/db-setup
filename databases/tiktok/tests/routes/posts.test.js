const request = require('supertest');
const express = require('express');
const postsRouter = require('../../routes/posts');
const pool = require('../../db');
const { syncHiddenAcrossTables } = require('../../utils/videoSync');

jest.mock('../../db', () => ({
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn()
}));
jest.mock('../../utils/videoSync', () => ({
    syncHiddenAcrossTables: jest.fn().mockResolvedValue(undefined)
}));

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: 1 }; next(); });
app.use('/api', postsRouter);

describe('posts — hide sync + soft delete', () => {
    let mockClient;

    beforeEach(() => {
        jest.clearAllMocks();
        mockClient = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
        pool.connect.mockResolvedValue(mockClient);
    });

    describe('PATCH /api/posts/:shortcode/hide', () => {
        it('404s when the caller does not own the post', async () => {
            mockClient.query
                .mockResolvedValueOnce(undefined)  // BEGIN
                .mockResolvedValueOnce({ rows: [] }); // ownership check

            const res = await request(app).patch('/api/posts/abc123/hide').send({ is_hidden: true });

            expect(res.status).toBe(404);
        });

        it('hides the post and syncs it to tiktok_videos when owned', async () => {
            mockClient.query
                .mockResolvedValueOnce(undefined)                    // BEGIN
                .mockResolvedValueOnce({ rows: [{ shortcode: 'abc123' }] }) // ownership check
                .mockResolvedValueOnce(undefined)                    // UPDATE posts.is_hidden
                .mockResolvedValueOnce(undefined);                   // COMMIT

            const res = await request(app).patch('/api/posts/abc123/hide').send({ is_hidden: true });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, shortcode: 'abc123', is_hidden: true });
            expect(syncHiddenAcrossTables).toHaveBeenCalledWith(mockClient, 'abc123', 1, true);
        });

        it('clears deleted_at when unhiding, so a soft-deleted post can be recovered via Unhide', async () => {
            mockClient.query
                .mockResolvedValueOnce(undefined)                    // BEGIN
                .mockResolvedValueOnce({ rows: [{ shortcode: 'abc123' }] }) // ownership check
                .mockResolvedValueOnce(undefined)                    // UPDATE posts.is_hidden
                .mockResolvedValueOnce(undefined);                   // COMMIT

            const res = await request(app).patch('/api/posts/abc123/hide').send({ is_hidden: false });

            expect(res.status).toBe(200);
            const updateCall = mockClient.query.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE posts'));
            expect(updateCall[0]).toMatch(/deleted_at = CASE WHEN \$2 THEN deleted_at ELSE NULL END/);
            expect(updateCall[1]).toEqual(['abc123', false]);
        });
    });

    describe('DELETE /api/posts/:shortcode', () => {
        it('404s when the caller does not own the post', async () => {
            mockClient.query
                .mockResolvedValueOnce(undefined)  // BEGIN
                .mockResolvedValueOnce({ rows: [] }); // ownership check

            const res = await request(app).delete('/api/posts/abc123');

            expect(res.status).toBe(404);
        });

        it('soft-deletes and syncs a hide to tiktok_videos when owned', async () => {
            mockClient.query
                .mockResolvedValueOnce(undefined)                          // BEGIN
                .mockResolvedValueOnce({ rows: [{ shortcode: 'abc123' }] }) // ownership check
                .mockResolvedValueOnce(undefined)                          // UPDATE deleted_at
                .mockResolvedValueOnce(undefined);                         // COMMIT

            const res = await request(app).delete('/api/posts/abc123');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, shortcode: 'abc123' });
            expect(syncHiddenAcrossTables).toHaveBeenCalledWith(mockClient, 'abc123', 1, true);
        });
    });
});
