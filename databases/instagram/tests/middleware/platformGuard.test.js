const request = require('supertest');
const express = require('express');
const { platformGuard, isOnPlatform } = require('../../middleware/platformGuard');

const app = express();
app.use(express.json());
app.post('/posts', platformGuard, (req, res) => res.json({
    success: true,
    saved: (req.body.posts || []).map((p) => p.shortcode),
    skipped: res.locals.skippedOtherPlatform,
    reason: res.locals.activity && res.locals.activity.reason,
}));

describe('platformGuard (Instagram backend)', () => {
    it('accepts instagram.com urls, including subdomains', () => {
        expect(isOnPlatform('https://www.instagram.com/p/abc/')).toBe(true);
        expect(isOnPlatform('https://instagram.com/x')).toBe(true);
    });

    it('rejects other platforms and look-alike hosts', () => {
        expect(isOnPlatform('https://www.tiktok.com/x')).toBe(false);
        expect(isOnPlatform('https://notinstagram.com/x')).toBe(false);
        expect(isOnPlatform('https://instagram.com.evil.com/x')).toBe(false);
    });

    it('lets a batch of own-platform posts through', async () => {
        const res = await request(app).post('/posts').send({ posts: [{ shortcode: 'a', postUrl: 'https://www.instagram.com/p/a/' }] });
        expect(res.status).toBe(200);
    });

    it('lets posts without a postUrl through (old clients)', async () => {
        const res = await request(app).post('/posts').send({ shortcode: 'a' });
        expect(res.status).toBe(200);
    });

    it('saves the own-platform posts and reports how many foreign ones it skipped', async () => {
        const res = await request(app).post('/posts').send({ posts: [
            { shortcode: 'a', postUrl: 'https://www.instagram.com/p/a/' },
            { shortcode: 'b', postUrl: 'https://www.tiktok.com/@b/video/1' },
            { shortcode: 'c' },
        ] });
        expect(res.status).toBe(200);
        expect(res.body.saved).toEqual(['a', 'c']);
        expect(res.body.skipped).toBe(1);
        expect(res.body.reason).toBe('foreign_posts_skipped');
    });

    it('still refuses a batch with nothing from this platform: that means a wrong API URL', async () => {
        const res = await request(app).post('/posts').send({ posts: [
            { shortcode: 'b', postUrl: 'https://www.tiktok.com/@b/video/1' },
            { shortcode: 'd', postUrl: 'https://www.tiktok.com/@b/video/1' },
        ] });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('WRONG_PLATFORM');
        expect(res.body.error).toContain('none of the 2');
    });

    it('refuses a single foreign post sent without a posts array', async () => {
        const res = await request(app).post('/posts').send({ shortcode: 'b', postUrl: 'https://www.tiktok.com/@b/video/1' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('WRONG_PLATFORM');
    });
});
