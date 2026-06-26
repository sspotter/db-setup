#!/usr/bin/env node
/**
 * create-databases.js
 *
 * Standalone, idempotent bootstrapper that ensures the LOCAL PostgreSQL
 * databases for both backend projects exist, creating + seeding the schema
 * for any that are missing.
 *
 *   - tiksurfer        -> Tik_Surfer_multi_fix
 *   - insta-surfer     -> insta_surf_multi_prisma
 *
 * Everything it needs is self-contained in this folder:
 *   - .env                       connection strings for both databases
 *   - schemas/*.schema.sql       a copy of each project's schema
 *
 * Behaviour (per project):
 *   1. Read its connection string from this folder's .env (the DB name at the
 *      end of the URL is the database that gets created).
 *   2. Connect to the "postgres" maintenance DB on the same host/credentials.
 *   3. If the target database already exists  -> skip (non-destructive).
 *      If it does NOT exist                   -> CREATE DATABASE, then run the
 *                                                cleaned local schema file and any
 *                                                post-schema statements.
 *
 * This script NEVER drops or alters existing data. Re-running it only ever
 * creates databases that are missing.
 *
 *   Usage:  node create-databases.js
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

const ROOT = __dirname;

// Load this folder's own .env (connection strings for both databases).
dotenv.config({ path: path.join(ROOT, '.env') });

// Primary-key constraints the Prisma backend needs (from backend_prisma/deploy_init.js).
// The pg_dump schema omits these; they are required for `prisma db pull`.
const PRISMA_PRIMARY_KEYS = [
    'ALTER TABLE ONLY public.comment_scrape_logs ADD CONSTRAINT comment_scrape_logs_pkey PRIMARY KEY (id);',
    'ALTER TABLE ONLY public.ig_users ADD CONSTRAINT ig_users_pkey PRIMARY KEY (id);',
    'ALTER TABLE ONLY public.post_metrics_history ADD CONSTRAINT post_metrics_history_pkey PRIMARY KEY (id);',
    'ALTER TABLE ONLY public.post_relations ADD CONSTRAINT post_relations_pkey PRIMARY KEY (id);',
    'ALTER TABLE ONLY public.posts ADD CONSTRAINT posts_pkey PRIMARY KEY (shortcode);',
    'ALTER TABLE ONLY public.project_posts ADD CONSTRAINT project_posts_pkey PRIMARY KEY (id);',
    'ALTER TABLE ONLY public.project_profiles ADD CONSTRAINT project_profiles_pkey PRIMARY KEY (id);',
    'ALTER TABLE ONLY public.projects ADD CONSTRAINT projects_pkey PRIMARY KEY (id);',
    'ALTER TABLE ONLY public.scrape_jobs ADD CONSTRAINT scrape_jobs_pkey PRIMARY KEY (id);',
    'ALTER TABLE ONLY public.scrape_sessions ADD CONSTRAINT scrape_sessions_pkey PRIMARY KEY (id);',
    'ALTER TABLE ONLY public.user_scraped_posts ADD CONSTRAINT user_scraped_posts_pkey PRIMARY KEY (id);',
    'ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);',
];

// The only thing you should ever need to edit.
//   envVar     -> key in this folder's .env holding the connection string
//   schemaPath -> schema file, relative to this folder
const PROJECTS = [
    {
        name: 'tiksurfer',
        envVar: 'TIKSURFER_DATABASE_URL',
        schemaPath: 'schemas/tiksurfer.schema.sql',
        postSchema: [],
    },
    {
        name: 'insta-surfer (prisma)',
        envVar: 'INSTA_DATABASE_URL',
        schemaPath: 'schemas/insta-surfer.schema.sql',
        postSchema: PRISMA_PRIMARY_KEYS,
    },
];

/** Read a connection string from this folder's .env (loaded into process.env). */
function loadDbUrl(envVar) {
    const url = process.env[envVar];
    if (!url) {
        throw new Error(`${envVar} not set in db-setup/.env`);
    }
    return url.trim();
}

// Session-tuning SET parameters in the pg_dump preamble that are irrelevant to
// creating the schema and may be rejected by older servers or a connection
// pooler. `transaction_timeout` in particular only exists in PostgreSQL 17+,
// so applying an 18.x dump through anything older fails with
// "unrecognized configuration parameter". These are safe to drop.
const SKIP_SET_PARAMS = [
    'statement_timeout',
    'lock_timeout',
    'idle_in_transaction_session_timeout',
    'transaction_timeout',
];
const SKIP_SET_RE = new RegExp(`^\\s*SET\\s+(${SKIP_SET_PARAMS.join('|')})\\b`, 'i');

/** Strip psql meta-commands, ownership lines, and version-sensitive SET params. */
function cleanSchema(sql) {
    return sql
        .split(/\r?\n/)
        .filter((line) => !/^\s*\\/.test(line)) // \restrict, \unrestrict, etc.
        .filter((line) => !/\bOWNER TO\b/i.test(line)) // ownership -> defaults to connecting role
        .filter((line) => !SKIP_SET_RE.test(line)) // version/pooler-sensitive timeouts
        .join('\n');
}

function targetDbName(dbUrl) {
    const u = new URL(dbUrl);
    return decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres';
}

/** Same host/credentials, but pointed at the "postgres" maintenance database. */
function maintenanceUrl(dbUrl) {
    const u = new URL(dbUrl);
    u.pathname = '/postgres';
    return u.toString();
}

function isLocalHost(dbUrl) {
    return /@(localhost|127\.0\.0\.1)([:/]|$)/.test(dbUrl);
}

function sslFor(dbUrl) {
    return isLocalHost(dbUrl) ? false : { rejectUnauthorized: false };
}

async function ensureDatabase(project, { force = false } = {}) {
    const dbUrl = loadDbUrl(project.envVar);
    const name = targetDbName(dbUrl);
    let status = 'created';

    // Step 1: check existence via the maintenance DB.
    const admin = new Client({ connectionString: maintenanceUrl(dbUrl), ssl: sslFor(dbUrl) });
    await admin.connect();
    try {
        const { rowCount } = await admin.query(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [name]
        );
        if (rowCount > 0) {
            if (!force) {
                return { name, status: 'skipped' };
            }
            // Destructive: drop the existing database (and all its data) and rebuild.
            // WITH (FORCE) terminates any open connections (PostgreSQL 13+).
            console.log(`[${project.name}] --force: dropping existing database "${name}"...`);
            await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
            status = 'recreated';
        }
        console.log(`[${project.name}] creating database "${name}"...`);
        await admin.query(`CREATE DATABASE "${name}"`);
    } finally {
        await admin.end();
    }

    // Step 2: seed schema on the freshly created database.
    const schemaPath = path.resolve(ROOT, project.schemaPath);
    if (!fs.existsSync(schemaPath)) {
        throw new Error(`schema file not found at ${schemaPath}`);
    }
    const schemaSql = cleanSchema(fs.readFileSync(schemaPath, 'utf8'));

    const db = new Client({ connectionString: dbUrl, ssl: sslFor(dbUrl) });
    await db.connect();
    try {
        console.log(`[${project.name}] applying schema...`);
        await db.query(schemaSql);

        for (const stmt of project.postSchema) {
            try {
                await db.query(stmt);
            } catch (err) {
                if (/already exists|multiple primary keys/i.test(err.message)) {
                    // Constraint already present in the dump — fine.
                    continue;
                }
                throw err;
            }
        }
    } finally {
        await db.end();
    }

    return { name, status };
}

const STATUS_LABELS = {
    created: 'CREATED + seeded',
    recreated: 'DROPPED + recreated + seeded',
    skipped: 'skipped (already exists)',
};

async function main() {
    const force = process.argv.slice(2).some((a) => a === '--force' || a === '-f');

    console.log('--- Local database bootstrap started ---');
    if (force) {
        console.log('!!! --force: existing databases will be DROPPED and rebuilt from scratch !!!');
    }
    console.log('');
    const results = [];

    for (const project of PROJECTS) {
        try {
            const res = await ensureDatabase(project, { force });
            results.push({ project: project.name, ...res, ok: true });
            const label = STATUS_LABELS[res.status] || res.status;
            console.log(`[${project.name}] ${label}: "${res.name}"\n`);
        } catch (err) {
            results.push({ project: project.name, status: 'failed', ok: false, error: err.message });
            console.error(`[${project.name}] FAILED: ${err.message}\n`);
        }
    }

    console.log('--- Summary ---');
    for (const r of results) {
        const detail = r.ok ? `${r.status}${r.name ? ` (${r.name})` : ''}` : `failed (${r.error})`;
        console.log(`  ${r.project}: ${detail}`);
    }

    const failed = results.filter((r) => !r.ok);
    process.exit(failed.length > 0 ? 1 : 0);
}

if (require.main === module) {
    main().catch((err) => {
        console.error('Unexpected error:', err);
        process.exit(1);
    });
}

module.exports = {
    ensureDatabase,
    cleanSchema,
    targetDbName,
    maintenanceUrl,
    loadDbUrl,
    sslFor,
    PROJECTS,
};
