/**
 * Rejects /api/posts batches that contain posts from another platform.
 *
 * Each extension saves its own backend URL, so a mis-set URL sends TikTok posts
 * to the Instagram backend (or the reverse) and they land in the wrong database.
 * Posts with no postUrl are allowed (older clients). Foreign posts are dropped and
 * the rest are saved, so leftovers in a browser's local copy can't block a save; the
 * route reports the count as skipped_other_platform. A batch with nothing from this
 * platform is refused, because that is what a wrong API URL looks like.
 */
const PLATFORM_NAME = 'Instagram';
const PLATFORM_DOMAIN = 'instagram.com';

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
    const own = posts.filter((p) => !(p && p.postUrl && !isOnPlatform(p.postUrl)));
    if (own.length === posts.length) return next();
    if (own.length === 0) {
        return res.status(400).json({
            success: false,
            error: `This is the ${PLATFORM_NAME} backend, but none of the ${posts.length} post(s) are from ${PLATFORM_DOMAIN}. ` +
                   'Check the API URL in the extension settings.',
            code: 'WRONG_PLATFORM',
        });
    }
    req.body.posts = own;
    res.locals.skippedOtherPlatform = posts.length - own.length;
    // A reason makes the activity log record this otherwise successful save.
    res.locals.activity = { ...res.locals.activity, reason: 'foreign_posts_skipped' };
    return next();
}

module.exports = { platformGuard, isOnPlatform };
