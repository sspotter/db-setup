// Admin auth: either the shared password (x-admin-password, which needs no database and is what
// the central dashboard uses) or a short-lived token from an account login (x-admin-token).
// Sets req.admin to { id, email } for an account and { shared: true } for the shared password.
// Wrong shared passwords here count against the same per-IP lockout as POST /api/admin/login.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const lockout = require('../utils/adminLockout');
const { clientIp } = require('../utils/adminAudit');

const TOKEN_AUDIENCE = 'surfer-admin';
const TOKEN_TTL_S = 12 * 60 * 60;
const ACCOUNT_CACHE_MS = 30 * 1000;
const ADMIN_BCRYPT_ROUNDS = 12;

// Constant-time comparison (hashing first makes the two buffers the same length).
const safeEqual = (a, b) => {
    const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
    return crypto.timingSafeEqual(digest(a), digest(b));
};

const tokenSecret = () => (process.env.ADMIN_JWT_SECRET || '').trim();

// Part of the token, so changing an account's password ends its existing sessions.
const passwordVersion = (passwordHash) => crypto.createHash('sha256').update(String(passwordHash)).digest('hex').slice(0, 16);

const signAdminToken = (account) => jwt.sign(
    { sub: account.id, email: account.email, pv: passwordVersion(account.password_hash) },
    tokenSecret(),
    { algorithm: 'HS256', audience: TOKEN_AUDIENCE, expiresIn: TOKEN_TTL_S }
);

// Active accounts only. Changes made through this process call forgetAccount, so they apply at once.
const accountCache = new Map(); // id -> { email, pv, at }
let cacheGeneration = 0; // stops a lookup already in flight from re-caching what forgetAccount removed
const forgetAccount = (id) => {
    cacheGeneration += 1;
    accountCache.delete(id);
};

// Resolves null when the account is missing or disabled; rejects on a database error.
async function activeAccount(id) {
    const hit = accountCache.get(id);
    if (hit && Date.now() - hit.at < ACCOUNT_CACHE_MS) return hit;
    accountCache.delete(id);
    const generation = cacheGeneration;
    let result;
    try {
        result = await pool.query('SELECT email, password_hash FROM admin_accounts WHERE id = $1 AND disabled_at IS NULL', [id]);
    } catch (err) {
        if (err && err.code === '42P01') return null; // migrations/v9_admin_accounts.sql not applied
        throw err;
    }
    if (!result.rows.length) return null;
    const entry = { email: result.rows[0].email, pv: passwordVersion(result.rows[0].password_hash), at: Date.now() };
    if (generation === cacheGeneration) accountCache.set(id, entry);
    return entry;
}

async function verifyToken(token, req, res, next) {
    const reject = () => {
        res.locals.activity = { reason: 'bad_admin_token' };
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired admin session' });
    };
    const secret = tokenSecret();
    if (!secret) return reject();
    let claims;
    try {
        claims = jwt.verify(String(token), secret, { algorithms: ['HS256'], audience: TOKEN_AUDIENCE });
    } catch {
        return reject();
    }
    let account;
    try {
        account = await activeAccount(claims.sub);
    } catch (err) {
        // Fail closed: without the database a disabled account can't be told from an active one.
        console.error('[ADMIN AUTH] Could not check the admin account:', err && err.message);
        res.locals.activity = { reason: 'admin_token_db_error', serverError: String(err && err.message) };
        return res.status(503).json({ error: 'Could not verify the admin session. Try again shortly.' });
    }
    if (!account || account.pv !== claims.pv) return reject();
    req.admin = { id: claims.sub, email: account.email };
    return next();
}

const verifyAdmin = (req, res, next) => {
    const token = req.headers['x-admin-token'];
    if (token) return verifyToken(token, req, res, next);

    const adminPassword = req.headers['x-admin-password'];
    const ip = clientIp(req) || 'unknown';
    if (adminPassword && lockout.isLocked(ip)) {
        const retryAfter = lockout.retryAfterSeconds(ip);
        res.locals.activity = { reason: 'admin_password_locked' };
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({ error: 'Too many failed attempts. Try again later.', retry_after_s: retryAfter });
    }
    if (!adminPassword || !process.env.ADMIN_PASSWORD || !safeEqual(adminPassword, process.env.ADMIN_PASSWORD)) {
        if (adminPassword) lockout.addFail(ip, adminPassword);
        // Explains the otherwise anonymous row in the activity log; never the attempted value.
        res.locals.activity = { reason: adminPassword ? 'bad_admin_password' : 'missing_admin_password' };
        return res.status(401).json({ error: 'Unauthorized: Invalid administrative password' });
    }
    req.admin = { shared: true };
    return next();
};

verifyAdmin.safeEqual = safeEqual;
verifyAdmin.tokenSecret = tokenSecret;
verifyAdmin.signAdminToken = signAdminToken;
verifyAdmin.forgetAccount = forgetAccount;
verifyAdmin.TOKEN_TTL_S = TOKEN_TTL_S;
verifyAdmin.ADMIN_BCRYPT_ROUNDS = ADMIN_BCRYPT_ROUNDS;
module.exports = verifyAdmin;
