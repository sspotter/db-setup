/**
 * Admin activity log checker.
 * Run from backend-tiksurfer/ (dotenv loads .env relative to cwd), e.g.:
 *
 *   node checks/activity.js [email] [--kind all|logins|errors] [--limit N]
 *   node checks/activity.js --smoke [--url http://localhost:<PORT>]
 */
// Same load order as server.js so this reads the DB the server writes to.
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const pool = require('../db');

function parseArgs(argv) {
    const args = { smoke: false, kind: 'all', limit: 50, email: null, url: null };
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--smoke') {
            args.smoke = true;
        } else if (arg === '--kind') {
            args.kind = argv[++i];
        } else if (arg === '--limit') {
            args.limit = parseInt(argv[++i], 10);
        } else if (arg === '--url') {
            args.url = argv[++i];
        } else {
            rest.push(arg);
        }
    }
    if (rest.length > 0) args.email = rest[0];
    return args;
}

function clampLimit(limit) {
    if (!Number.isFinite(limit)) return 50;
    return Math.max(1, Math.min(1000, limit));
}

async function listEvents({ email, kind, limit }) {
    const where = [];
    const params = [];

    if (email) {
        params.push(email);
        where.push(`email ILIKE '%' || $${params.length} || '%'`);
    }
    if (kind === 'logins') {
        where.push(`path = '/api/auth/login'`);
    } else if (kind === 'errors') {
        where.push(`status >= 400`);
    }

    params.push(clampLimit(limit));
    const limitParam = `$${params.length}`;

    const sql = `
        SELECT created_at, email, method, path, status, reason, error, ip, ext_version
        FROM public.api_events
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY created_at DESC
        LIMIT ${limitParam};
    `;

    const res = await pool.query(sql, params);
    console.log(`Found ${res.rows.length} event(s):`);
    console.table(res.rows);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSmoke(url) {
    const base = url || (process.env.PORT ? `http://localhost:${process.env.PORT}` : null);
    if (!base) {
        console.error('FAIL: pass --url or set PORT in .env');
        process.exitCode = 1;
        return;
    }

    const email = `smoke-${Date.now()}@activity.test`;

    try {
        const res = await fetch(`${base}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: 'x' })
        });
        // Expect 401; anything else (200 HTML, 502) means a tunnel/proxy answered instead.
        console.log(`POST ${base}/api/auth/login -> ${res.status}`);
    } catch (err) {
        console.error(`FAIL: request to ${base}/api/auth/login failed: ${err.message}`);
        process.exitCode = 1;
        return;
    }

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
        try {
            const res = await pool.query(
                'SELECT created_at, email, method, path, status, reason, error, ip, ext_version FROM public.api_events WHERE email = $1 ORDER BY created_at DESC LIMIT 1;',
                [email]
            );
            if (res.rows.length > 0) {
                const row = res.rows[0];
                if (row.reason === 'no_such_user') {
                    console.log('PASS: found expected row');
                    console.table([row]);
                    return;
                }
                console.error(`FAIL: found row for ${email} but reason was "${row.reason}", expected "no_such_user"`);
                console.table([row]);
                process.exitCode = 1;
                return;
            }
        } catch (err) {
            if (/relation "api_events" does not exist/.test(err.message)) {
                console.error('FAIL: table public.api_events does not exist. Run migrations/v3_add_api_events.sql first.');
            } else {
                console.error(`FAIL: query error: ${err.message}`);
            }
            process.exitCode = 1;
            return;
        }
        await sleep(200);
    }

    console.error(`FAIL: no api_events row found for ${email} within 3s`);
    process.exitCode = 1;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    try {
        if (args.smoke) {
            await runSmoke(args.url);
        } else {
            await listEvents(args);
        }
    } catch (err) {
        console.error('Check failed:', err.message);
        process.exitCode = 1;
    } finally {
        // Exit like the other checks/ scripts: pool.end() can hang when the DB is unreachable.
        process.exit(process.exitCode || 0);
    }
}

main();
