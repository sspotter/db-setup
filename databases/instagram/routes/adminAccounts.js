/**
 * Admin: per-admin accounts. Identical in the TikTok and Instagram backends, each with its own list.
 * GET/POST /api/admin/accounts, PATCH/DELETE /api/admin/accounts/:id
 * Works with the shared password too, which is how the first account gets created.
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../db');
const verifyAdmin = require('../middleware/adminAuth');
const { logServerError } = require('../middleware/activityLog');
const { recordAdminAction, adminActor } = require('../utils/adminAudit');

const MIN_PASSWORD = 12;
const MAX_PASSWORD_BYTES = 72; // bcrypt ignores anything past this
const MAX_NAME = 100;
const MAX_EMAIL = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE_MISSING = 'Admin accounts are not set up yet: apply migrations/v9_admin_accounts.sql';
const COLUMNS = 'id, email, name, disabled_at, last_login, created_at, created_by'; // never password_hash

const passwordProblem = (p) => {
    if (typeof p !== 'string' || p.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
    if (Buffer.byteLength(p) > MAX_PASSWORD_BYTES) return `Password must be at most ${MAX_PASSWORD_BYTES} bytes`;
    return null;
};

// undefined = not sent, null = clear it, false = invalid.
const parseName = (v) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== 'string') return false;
    return v.trim().slice(0, MAX_NAME) || null;
};

function failed(res, err, label) {
    if (err.code === '42P01') return res.status(503).json({ success: false, error: TABLE_MISSING });
    console.error(`[ADMIN ACCOUNTS] ${label}:`, err.message);
    logServerError(res, err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
}

router.get('/accounts', verifyAdmin, async (req, res) => {
    const me = req.admin.id || null;
    try {
        const result = await pool.query(`SELECT ${COLUMNS} FROM admin_accounts ORDER BY created_at DESC`);
        res.json({ success: true, accounts: result.rows, table_missing: false, me });
    } catch (err) {
        if (err.code === '42P01') return res.json({ success: true, accounts: [], table_missing: true, me });
        failed(res, err, 'List failed');
    }
});

router.post('/accounts', verifyAdmin, async (req, res) => {
    const { email, password, name } = req.body || {};
    const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(address) || address.length > MAX_EMAIL) return res.status(400).json({ success: false, error: 'A valid email is required' });
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ success: false, error: problem });
    const cleanName = parseName(name);
    if (cleanName === false) return res.status(400).json({ success: false, error: 'name must be text' });
    try {
        const hash = await bcrypt.hash(password, verifyAdmin.ADMIN_BCRYPT_ROUNDS);
        const result = await pool.query(
            `INSERT INTO admin_accounts (email, password_hash, name, created_by)
             VALUES ($1, $2, $3, $4)
             RETURNING ${COLUMNS}`,
            [address, hash, cleanName === undefined ? null : cleanName, adminActor(req)]
        );
        const account = result.rows[0];
        await recordAdminAction(req, { action: 'admin_account_create', target_email: account.email, detail: { account_id: account.id } });
        res.status(201).json({ success: true, account });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ success: false, error: 'An admin with that email already exists' });
        failed(res, err, 'Create failed');
    }
});

router.patch('/accounts/:id', verifyAdmin, async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ success: false, error: 'Invalid account id' });
    const { name, disabled, password } = req.body || {};
    const cleanName = parseName(name);
    if (cleanName === false) return res.status(400).json({ success: false, error: 'name must be text' });
    if (disabled !== undefined && typeof disabled !== 'boolean') return res.status(400).json({ success: false, error: 'disabled must be true or false' });
    if (password !== undefined) {
        const problem = passwordProblem(password);
        if (problem) return res.status(400).json({ success: false, error: problem });
    }
    if (disabled === true && req.admin.id === id) return res.status(400).json({ success: false, error: 'You cannot disable your own account' });

    const sets = [];
    const values = [];
    const changed = [];
    const add = (field, sql, value) => { values.push(value); sets.push(sql.replace('?', `$${values.length}`)); changed.push(field); };
    if (cleanName !== undefined) add('name', 'name = ?', cleanName);
    if (disabled !== undefined) add('disabled', 'disabled_at = CASE WHEN ?::boolean THEN coalesce(disabled_at, now()) ELSE NULL END', disabled);
    try {
        if (password !== undefined) add('password', 'password_hash = ?', await bcrypt.hash(password, verifyAdmin.ADMIN_BCRYPT_ROUNDS));
        if (!sets.length) return res.status(400).json({ success: false, error: 'Nothing to change' });
        values.push(id);
        const result = await pool.query(`UPDATE admin_accounts SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${COLUMNS}`, values);
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Admin account not found' });
        verifyAdmin.forgetAccount(id);
        const account = result.rows[0];
        await recordAdminAction(req, { action: 'admin_account_update', target_email: account.email, detail: { account_id: id, changed } });
        res.json({ success: true, account });
    } catch (err) {
        failed(res, err, 'Update failed');
    }
});

router.delete('/accounts/:id', verifyAdmin, async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ success: false, error: 'Invalid account id' });
    if (req.admin.id === id) return res.status(400).json({ success: false, error: 'You cannot delete your own account' });
    try {
        const result = await pool.query('DELETE FROM admin_accounts WHERE id = $1 RETURNING email', [id]);
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Admin account not found' });
        verifyAdmin.forgetAccount(id);
        await recordAdminAction(req, { action: 'admin_account_delete', target_email: result.rows[0].email, detail: { account_id: id } });
        res.json({ success: true });
    } catch (err) {
        failed(res, err, 'Delete failed');
    }
});

module.exports = router;
