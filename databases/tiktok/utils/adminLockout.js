// Failed-password counter shared by POST /api/admin/login and the x-admin-password header check,
// so guessing through one is counted against the other. In memory: it resets on restart, which is
// enough to stop guessing from one machine. Every read and write here is synchronous, so parallel
// requests can't overwrite each other's counts.
const crypto = require('crypto');

const MAX_FAILS = parseInt(process.env.ADMIN_LOGIN_MAX_FAILS, 10) || 5;
const WINDOW_MS = (parseInt(process.env.ADMIN_LOGIN_WINDOW_MIN, 10) || 15) * 60 * 1000;
const MAX_KEYS = 5000;

const fails = new Map(); // ip, or "email:<address>" -> [{ at, fp }]; oldest-written key first
const fingerprintKey = crypto.randomBytes(32); // per process; the attempted value itself is never kept
const fingerprint = (value) => crypto.createHmac('sha256', fingerprintKey).update(String(value)).digest('hex').slice(0, 16);

function recent(key, now = Date.now()) {
    const list = (fails.get(key) || []).filter((e) => now - e.at < WINDOW_MS);
    if (list.length) fails.set(key, list); else fails.delete(key);
    return list;
}

const count = (key) => recent(key).length;
const isLocked = (key) => count(key) >= MAX_FAILS;

// Seconds until enough failures age out for the key to drop below the limit.
function retryAfterSeconds(key, now = Date.now()) {
    const list = recent(key, now);
    if (list.length < MAX_FAILS) return 0;
    return Math.ceil((list[list.length - MAX_FAILS].at + WINDOW_MS - now) / 1000);
}

// With a value, repeats of that same value count once: a page resending one stale password on
// several parallel calls must not lock its owner out, and repeating a guess gains an attacker nothing.
function addFail(key, value) {
    const now = Date.now();
    const list = recent(key, now);
    const fp = value === undefined ? null : fingerprint(value);
    if (fp && list.some((e) => e.fp === fp)) return list.length;
    list.push({ at: now, fp });
    fails.delete(key);
    fails.set(key, list);
    while (fails.size > MAX_KEYS) fails.delete(fails.keys().next().value);
    return list.length;
}

const clear = (key) => fails.delete(key);
const size = () => fails.size;
const reset = () => fails.clear();

module.exports = { count, isLocked, retryAfterSeconds, addFail, clear, size, reset, MAX_KEYS };
