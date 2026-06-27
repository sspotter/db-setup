const path = require('path');
const net = require('net');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const HOST = process.env.REMOTE_DB_HOST;
const PORT = Number(process.env.REMOTE_DB_PORT) || 5432;
const DB = process.env.REMOTE_DB_NAME;
const USER = process.env.REMOTE_DB_USER;
const PASS = process.env.REMOTE_DB_PASSWORD;

for (const [k, v] of Object.entries({ REMOTE_DB_HOST: HOST, REMOTE_DB_NAME: DB, REMOTE_DB_USER: USER, REMOTE_DB_PASSWORD: PASS })) {
    if (!v) { console.error(`Missing ${k} in db-setup/.env`); process.exit(1); }
}

function tcpProbe(port) {
    return new Promise((resolve) => {
        const s = net.connect({ host: HOST, port });
        const done = (r) => { s.destroy(); resolve(r); };
        s.setTimeout(5000);
        s.on('connect', () => done('OPEN'));
        s.on('timeout', () => done('timeout'));
        s.on('error', (e) => done(`closed/error: ${e.code || e.message}`));
    });
}

async function tryDb() {
    const c = new Client({ host: HOST, port: PORT, database: DB, user: USER, password: PASS, connectionTimeoutMillis: 6000, ssl: false });
    try {
        await c.connect();
        const v = (await c.query('SELECT version()')).rows[0].version;
        const n = (await c.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n;
        await c.end();
        return `DB OK -> ${v} | public tables: ${n}`;
    } catch (e) {
        try { await c.end(); } catch {}
        return `DB FAIL -> ${e.message}`;
    }
}

(async () => {
    console.log('TCP 5432 (postgres):', await tcpProbe(5432));
    console.log('TCP 22   (ssh):     ', await tcpProbe(22));
    console.log(await tryDb());
})();
