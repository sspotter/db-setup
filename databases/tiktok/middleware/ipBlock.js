/**
 * IP blocks, enforced on the login routes only. Identical in the TikTok and Instagram backends.
 *
 * Other routes are deliberately not covered: an office shares one address, and blocking the
 * whole API would cut off people who are already signed in.
 *
 * Fails open: a missing table (migrations/v10_blocked_ips.sql not applied) or a database error
 * never stops anyone from logging in.
 */
const net = require('net');
const pool = require('../db');
const { clientIp } = require('../utils/adminAudit');

const CACHE_MS = 30 * 1000;

let cachedBlocks = null; // Map of ip -> expiry in ms
let cachedAt = 0;
let inFlight = null;
let generation = 0;
let warnedMissing = false;

// One spelling per address, so "2001:DB8::1" and "2001:db8:0::1" are the same block and an
// IPv4-mapped IPv6 address counts as its IPv4 address. Returns null when it is not an IP.
function normalizeIp(value) {
    const text = String(value === undefined || value === null ? '' : value).trim();
    if (!net.isIP(text)) return null;
    if (net.isIPv4(text)) return text;
    let canonical;
    try {
        canonical = new URL(`http://[${text}]`).hostname.slice(1, -1);
    } catch {
        return null; // for example a zone id: fe80::1%eth0
    }
    const mapped = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (!mapped) return canonical;
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

// Includes the unspecified address, which is never a real client.
function isLoopback(ip) {
    return ip === '::1' || ip === '::' || ip === '0.0.0.0' || /^127\./.test(ip);
}

// Call after any change, so it takes effect at once in this process.
function forgetBlocks() {
    generation += 1;
    cachedBlocks = null;
    inFlight = null;
}

async function loadBlocks() {
    const startedIn = generation;
    let blocks;
    try {
        const result = await pool.query('SELECT ip, expires_at FROM blocked_ips WHERE expires_at > now()');
        blocks = new Map(result.rows.map((r) => [r.ip, new Date(r.expires_at).getTime()]));
    } catch (err) {
        if (!err || err.code !== '42P01') {
            console.error('[IP BLOCK] Could not read blocks, allowing the login:', err && err.message);
            return new Map();
        }
        if (!warnedMissing) {
            warnedMissing = true;
            console.warn('[IP BLOCK] blocked_ips table missing; apply migrations/v10_blocked_ips.sql. No blocks are enforced.');
        }
        blocks = new Map();
    }
    if (startedIn === generation) {
        cachedBlocks = blocks;
        cachedAt = Date.now();
    }
    return blocks;
}

async function isBlocked(ip) {
    let blocks = cachedBlocks;
    if (!blocks || Date.now() - cachedAt >= CACHE_MS) {
        if (!inFlight) {
            const load = loadBlocks().finally(() => { if (inFlight === load) inFlight = null; });
            inFlight = load;
        }
        blocks = await inFlight;
    }
    return (blocks.get(ip) || 0) > Date.now();
}

async function ipBlockGuard(req, res, next) {
    let blocked = false;
    try {
        const ip = normalizeIp(clientIp(req));
        blocked = !!ip && await isBlocked(ip);
    } catch (err) {
        console.error('[IP BLOCK] Check failed, allowing the login:', err && err.message);
    }
    if (!blocked) return next();
    const email = req.body && typeof req.body.email === 'string' ? req.body.email : undefined;
    res.locals.activity = { reason: 'ip_blocked', email };
    return res.status(403).json({ success: false, error: 'Sign-in from this address is blocked. Contact an administrator.' });
}

module.exports = { ipBlockGuard, normalizeIp, isLoopback, forgetBlocks };
