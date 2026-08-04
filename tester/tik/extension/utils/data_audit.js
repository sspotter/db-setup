/**
 * DataAudit — local-only integrity checks over the captured post set.
 *
 * Makes no chrome.*, network or DOM calls. Depends on PostIndex for
 * attribution so the audit judges the data by the same rule the UI uses.
 *
 * Report shape:
 * {
 *   totalPosts, issueCount, generatedAt,
 *   checks: [ { id, label, severity, count, fixable, items: [...], note } ]
 * }
 */

const PI = () => globalThis.PostIndex;

/** Wrap a check so one failure cannot blank the whole report. */
function _safe(id, label, severity, fixable, fn) {
    try {
        const out = fn() || {};
        return {
            id, label, severity, fixable,
            count: (out.items || []).length,
            items: out.items || [],
            note: out.note || '',
        };
    } catch (err) {
        return {
            id, label, severity: 'error', fixable: false,
            count: 0, items: [], note: `Check failed: ${err && err.message}`,
        };
    }
}

/** Comparable signature of one alias list, so the audit and the fixer share one rule. */
function _aliasNames(list) {
    if (!Array.isArray(list)) return '[]';
    return JSON.stringify(list.map(c => (typeof c === 'string' ? c : c && c.username)));
}

function _followersFor(username, posts, profiles) {
    const prof = (profiles || []).find(p => p && p.username === username);
    if (prof && prof.follower_count > 0) return prof.follower_count;

    for (const p of posts || []) {
        if (!p) continue;
        if (PI().getOwner(p) === username) {
            const f = (p.owner && p.owner.follower_count) || p.followers || 0;
            if (f > 0) return f;
        }
        const list = p.coauthors || p.coauthor_producers || [];
        for (const c of Array.isArray(list) ? list : []) {
            if (c && c.username === username && c.follower_count > 0) return c.follower_count;
        }
    }
    return 0;
}

/**
 * @param {object[]} posts
 * @param {object[]} profiles      globalProfilesDataset — for follower lookup
 * @param {object[]} [partnersList] currentPartnersList from calculateCollectiveReach.
 *                                  Required for the `invariant` check to mean anything.
 * @param {object[]} [partnersPosts] the post set partnersList was computed over.
 *                                  options.js calls calculateCollectiveReach(filteredPosts),
 *                                  so this is the FILTERED set while `posts` is everything.
 *                                  Defaults to `posts`.
 */
function runAudit(posts, profiles, partnersList, partnersPosts) {
    const P = (posts || []).filter(Boolean);
    const checks = [];

    checks.push(_safe('attribution', 'Posts filed under the wrong profile', 'warn', false, () => ({
        items: P.filter(p => {
            if (!p.scrapedFromProfile) return false;
            return !PI().postProfiles(p).has(p.scrapedFromProfile);
        }).map(p => ({
            shortcode: p.shortcode,
            capturedUnder: p.scrapedFromProfile,
            actualProfiles: [...PI().postProfiles(p)],
        })),
        note: 'Captured while browsing one profile but owned by / collaborating with another. '
            + 'These are re-filed automatically by the owner-or-coauthor rule; listed for visibility.',
    })));

    checks.push(_safe('missing_followers', 'Partners contributing 0 impressions', 'warn', false, () => {
        const everyone = new Set();
        P.forEach(p => PI().postProfiles(p).forEach(u => everyone.add(u)));
        return {
            items: [...everyone]
                .filter(u => _followersFor(u, P, profiles) === 0)
                .map(u => ({ username: u, followers: 0 })),
            note: 'No follower count is known for these profiles, so they multiply out to zero '
                + 'in Potential Impressions. Nothing local can fix this — visit each profile on '
                + 'Instagram with capture running.',
        };
    }));

    checks.push(_safe('collab_untyped', 'Has collaborators but is not typed as a collab', 'warn', false, () => ({
        items: P.filter(p => PI().getCoauthors(p).length > 0
            && p.type !== 'collab' && p.type !== 'paid_collab')
            .map(p => ({ shortcode: p.shortcode, type: p.type, coauthors: PI().getCoauthors(p) })),
        note: 'These are invisible to the Collab filter chip.',
    })));

    checks.push(_safe('collab_empty', 'Typed as a collab but has no collaborators', 'warn', false, () => ({
        items: P.filter(p => (p.type === 'collab' || p.type === 'paid_collab')
            && PI().getCoauthors(p).length === 0)
            .map(p => ({ shortcode: p.shortcode, type: p.type })),
    })));

    checks.push(_safe('alias_drift', 'Coauthor alias pair not normalised', 'warn', true, () => ({
        items: P.filter(p => _aliasNames(p.coauthors) !== _aliasNames(p.coauthor_producers))
            .map(p => ({ shortcode: p.shortcode })),
        note: 'coauthors and coauthor_producers disagree, or one of them is missing. The partnership '
            + 'breakdown reads the second alias, so a post can be a collab in the grid but absent '
            + 'from reach. Fixable locally.',
    })));

    checks.push(_safe('multi_collab', 'Posts with 2+ collaborators', 'info', false, () => ({
        items: P.filter(p => PI().getCoauthors(p).length >= 2)
            .map(p => ({ shortcode: p.shortcode, coauthors: PI().getCoauthors(p) })),
        note: 'Informational. Each collaborator is credited separately in Potential Impressions.',
    })));

    checks.push(_safe('duplicates', 'Duplicate shortcodes', 'warn', false, () => {
        const seen = {};
        P.forEach(p => { if (p.shortcode) seen[p.shortcode] = (seen[p.shortcode] || 0) + 1; });
        return {
            items: Object.entries(seen).filter(([, n]) => n > 1)
                .map(([shortcode, n]) => ({ shortcode, occurrences: n })),
        };
    }));

    checks.push(_safe('missing_fields', 'Posts missing shortcode, timestamp or owner', 'warn', false, () => ({
        items: P.filter(p => !p.shortcode || !p.timestamp || !PI().getOwner(p))
            .map(p => ({
                shortcode: p.shortcode || '(none)',
                missing: [!p.shortcode && 'shortcode', !p.timestamp && 'timestamp',
                    !PI().getOwner(p) && 'owner'].filter(Boolean),
            })),
    })));

    checks.push(_safe('invariant', 'Chip count disagrees with impressions post count', 'error', false, () => {
        // Compares the chip side (countByProfile) against the REACH side
        // (partnersList[].postCount, produced by calculateCollectiveReach).
        // Without partnersList there is nothing independent to compare to, so
        // the check reports itself as skipped rather than trivially passing.
        if (!Array.isArray(partnersList)) {
            return { items: [], note: 'Skipped — no partners list supplied.' };
        }
        // Count over the same posts the partners list was built from, otherwise
        // an active chip/date filter makes the two sides disagree by definition.
        const B = Array.isArray(partnersPosts) ? partnersPosts.filter(Boolean) : P;
        const roster = PI().buildProfileRoster(B);
        const counts = PI().countByProfile(B, roster);
        return {
            items: roster.filter(u => {
                const partner = partnersList.find(x => x && x.username === u);
                const reachCount = partner ? (partner.postCount || 0) : 0;
                return counts[u] !== reachCount;
            }).map(u => {
                const partner = partnersList.find(x => x && x.username === u);
                return { username: u, chipCount: counts[u], reachPostCount: partner ? partner.postCount : null };
            }),
            note: 'Must always be empty. A non-empty result means the chip bar and Potential '
                + 'Impressions counted posts by different rules.',
        };
    }));

    const issueCount = checks
        .filter(c => c.severity === 'warn' || c.severity === 'error')
        .reduce((n, c) => n + c.count, 0);

    return { totalPosts: P.length, issueCount, generatedAt: Date.now(), checks };
}

/**
 * Repairs what can be repaired from data already on this machine.
 * Mutates `posts` in place and returns a summary.
 *
 * Never fabricates a follower count. A profile with no known followers stays
 * at zero and keeps showing up under the missing_followers check.
 */
function applyFixes(posts, profiles) {
    const P = (posts || []).filter(Boolean);
    const summary = {
        aliasesSynced: 0, followersBackfilled: 0, reachRecomputed: 0,
        // Shortcodes whose STORED fields changed and therefore need persisting.
        // collectiveReach / reachBreakdown are derived — calculateCollectiveReach
        // rewrites them on every render — so they are not counted here.
        changed: [],
    };

    const followerCache = {};
    const lookup = (username) => {
        if (!username) return 0;
        if (!(username in followerCache)) {
            followerCache[username] = _followersFor(username, P, profiles);
        }
        return followerCache[username];
    };

    P.forEach(post => {
        let dirty = false;

        // 1. Re-sync the coauthor alias pair from whichever side is populated.
        const canonical = post.coauthors && post.coauthors.length
            ? post.coauthors
            : (post.coauthor_producers || []);
        if (_aliasNames(post.coauthors) !== _aliasNames(post.coauthor_producers)) {
            // Two arrays, shared entry objects: a follower backfill below is seen
            // through both aliases, but a later push to one cannot corrupt the other.
            post.coauthors = canonical;
            post.coauthor_producers = canonical.slice();
            summary.aliasesSynced++;
            dirty = true;
        }

        // 2. Backfill known follower counts onto coauthor entries.
        (post.coauthors || []).forEach(c => {
            if (!c || typeof c === 'string' || c.follower_count > 0) return;
            const f = lookup(c.username);
            if (f > 0) { c.follower_count = f; summary.followersBackfilled++; dirty = true; }
        });

        if (dirty && post.shortcode) summary.changed.push(post.shortcode);

        // 3. Recompute per-post reach from the (now enriched) membership set.
        const breakdown = [];
        let total = 0;
        PI().postProfiles(post).forEach(u => {
            const f = lookup(u);
            breakdown.push(`@${u} (${f})`);
            total += f;
        });
        post.reachBreakdown = breakdown;
        post.collectiveReach = total;
        summary.reachRecomputed++;
    });

    return summary;
}

const DataAudit = { runAudit, applyFixes, _followersFor };

if (typeof globalThis !== 'undefined') {
    globalThis.DataAudit = DataAudit;
}
