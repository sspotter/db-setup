const request = require('supertest');
const express = require('express');
const { platformGuard, isOnPlatform } = require('../../middleware/platformGuard');

const app = express();
app.use(express.json());
app.post('/posts', platformGuard, (req, res) => res.json({ success: true }));

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

    it('rejects the whole batch with WRONG_PLATFORM when any post is foreign', async () => {
        const res = await request(app).post('/posts').send({ posts: [
            { shortcode: 'a', postUrl: 'https://www.instagram.com/p/a/' },
            { shortcode: 'b', postUrl: 'https://www.tiktok.com/v/b' },
        ] });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('WRONG_PLATFORM');
        expect(res.body.error).toContain('1 of 2');
    });
});
