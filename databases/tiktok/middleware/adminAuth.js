// hardening (B7): admin auth is a single shared plaintext password compared on
// every request, with no rate limiting and no per-admin accounts. Acceptable
// for an internal-only tool; before exposing this publicly, move to hashed
// per-admin credentials + rate limiting / lockout on the login route.
const verifyAdmin = (req, res, next) => {
    const adminPassword = req.headers['x-admin-password'];

    if (!adminPassword || adminPassword !== process.env.ADMIN_PASSWORD) {
        // Explains the otherwise anonymous row in the activity log; never the attempted value.
        res.locals.activity = { reason: adminPassword ? 'bad_admin_password' : 'missing_admin_password' };
        return res.status(401).json({ error: 'Unauthorized: Invalid administrative password' });
    }
    next();
};

module.exports = verifyAdmin;
