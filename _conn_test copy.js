const net = require('net');
const { Client } = require('pg');

const HOST = '100.115.149.3';
const PORT = 5432;
const DB = 'Tik_Surfer_multi_fix';
const USER = 'devuser';
const PASS = '7)xSPf&ev7MtBjT)';

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
