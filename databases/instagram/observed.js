/**
 * "Newest observation wins" helpers.
 *
 * A scraped number has two timestamps: when we *stored* it (captured_at /
 * scraped_at, always NOW()) and when it was actually *seen on Instagram*
 * (observed_at). They diverge whenever a client syncs a local copy late, so
 * merges must compare observed_at — otherwise an old capture uploaded today
 * overwrites fresher data.
 *
 * observed_at is nullable on purpose: old clients don't send it, and rows
 * backfilled from other posts shouldn't claim an observation time. An
 * unstamped value never beats a stamped one; when both are unstamped we fall
 * back to the old sticky rules (keep the larger / keep the truthy one).
 */

/**
 * Normalise a client-supplied observation time into something pg can store in
 * a timestamptz, or null when it's missing or unusable.
 *
 * Accepts epoch milliseconds (what the extension sends), epoch seconds, a
 * Date, or any string Date can parse. Anything else -> null (unstamped),
 * never a throw: one bad field must not fail a whole sync batch.
 */
function toObservedAt(value) {
    if (value === null || value === undefined || value === '') return null;

    let date;
    if (value instanceof Date) {
        date = value;
    } else if (typeof value === 'number' || /^\d+$/.test(String(value).trim())) {
        const n = Number(value);
        if (!n) return null;                       // 0 means "unknown", not 1970
        // Same heuristic as the posted_at parsing in routes/posts.js.
        date = new Date(n > 10000000000 ? n : n * 1000);
    } else {
        date = new Date(String(value));
    }

    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

/**
 * SQL predicate: the incoming row was observed strictly later than the stored
 * one. A stamped incoming row also wins over an unstamped stored row.
 */
function newer(table) {
    return `(EXCLUDED.observed_at IS NOT NULL
             AND (${table}.observed_at IS NULL OR EXCLUDED.observed_at > ${table}.observed_at))`;
}

/** SQL predicate: neither side knows when it was observed. */
function bothUnknown(table) {
    return `(${table}.observed_at IS NULL AND EXCLUDED.observed_at IS NULL)`;
}

/**
 * ON CONFLICT assignment list for ig_users follower counts.
 *
 * Follower counts legitimately go *down*, so we can't just keep the maximum —
 * we keep the newest observation. Two guards:
 *   - 0 means "didn't see it", never an actual count, so it never overwrites.
 *   - an older or unstamped observation never overwrites a newer one.
 * observed_at only advances when the count itself was accepted, so a
 * follower-less sync can't make later real counts look stale.
 *
 * Emits two assignments; splice it into a SET list followed by a comma.
 */
const IG_USERS_FOLLOWERS_SET = `
    follower_count = CASE
        WHEN COALESCE(EXCLUDED.follower_count, 0) = 0 THEN ig_users.follower_count
        WHEN ${newer('ig_users')} THEN EXCLUDED.follower_count
        WHEN ${bothUnknown('ig_users')} THEN GREATEST(ig_users.follower_count, EXCLUDED.follower_count)
        ELSE ig_users.follower_count
    END,
    observed_at = CASE
        WHEN COALESCE(EXCLUDED.follower_count, 0) = 0 THEN ig_users.observed_at
        ELSE GREATEST(ig_users.observed_at, EXCLUDED.observed_at)
    END`;

/**
 * ORDER BY that picks the current metrics out of post_metrics_history.
 * Unstamped rows sort last so they never shadow an observed one; captured_at
 * only breaks ties between equally-stamped rows.
 */
function LATEST_METRICS_ORDER() {
    return 'observed_at DESC NULLS LAST, captured_at DESC';
}

module.exports = { toObservedAt, newer, bothUnknown, IG_USERS_FOLLOWERS_SET, LATEST_METRICS_ORDER };
