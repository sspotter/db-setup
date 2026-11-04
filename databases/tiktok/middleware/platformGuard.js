/**
 * Rejects /api/posts batches that contain posts from another platform.
 *
 * Each extension saves its own backend URL, so a mis-set URL sends TikTok posts
 * to the Instagram backend (or the reverse) and they land in the wrong database.
 * Posts with no postUrl are allowed (older clients); a postUrl that is not on
 * tiktok.com is refused for the whole batch, so nothing is half-saved.
 */
const PLATFORM_NAME = 'TikTok';
const PLATFORM_DOMAIN = 'tiktok.com';

function isOnPlatform(postUrl) {
    try {
        const host = new URL(postUrl).hostname.toLowerCase();
        return host === PLATFORM_DOMAIN || host.endsWith('.' + PLATFORM_DOMAIN);
    } catch {
        return false;
    }
}

function platformGuard(req, res, next) {
    let posts = req.body && req.body.posts || [req.body];
    if (!Array.isArray(posts)) posts = [posts];
    const wrong = posts.filter((p) => p && p.postUrl && !isOnPlatform(p.postUrl));
    if (wrong.length === 0) return next();
    return res.status(400).json({
        success: false,
        error: `This is the ${PLATFORM_NAME} backend, but ${wrong.length} of ${posts.length} post(s) are not from ${PLATFORM_DOMAIN}. ` +
               'Check the API URL in the extension settings.',
        code: 'WRONG_PLATFORM',
    });
}

module.exports = { platformGuard, isOnPlatform };
