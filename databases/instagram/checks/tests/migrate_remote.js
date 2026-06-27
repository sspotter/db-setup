const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = "postgresql://postgres:vtNzSwhLcbTOoXCtspvzlrqsnSnVizQf@centerbeam.proxy.rlwy.net:56821/railway";

async function runMigration() {
    const output = { logs: [], error: null, verification: {} };
    const log = (msg) => { output.logs.push(msg); };

    log("Connecting to Railway Database...");
    const client = new Client({ connectionString });

    try {
        await client.connect();
        log("Connected successfully.");

        const sqlPath1 = path.join(__dirname, '..', 'migrate_projects.sql');
        log(`Reading SQL from: ${sqlPath1}`);
        const sql1 = fs.readFileSync(sqlPath1, 'utf8');

        log("Executing migrate_projects.sql...");
        await client.query(sql1);
        log("migrate_projects.sql executed successfully.");

        const sqlPath2 = path.join(__dirname, '..', 'migrate_v3.sql');
        log(`Reading SQL from: ${sqlPath2}`);
        const sql2 = fs.readFileSync(sqlPath2, 'utf8');

        log("Executing migrate_v3.sql...");
        await client.query(sql2);
        log("migrate_v3.sql executed successfully.");

        // Verification query
        const projRes = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'projects' AND column_name = 'updated_at';
        `);
        output.verification.projects_updated_at = projRes.rows;

        const profRes = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'project_profiles' AND column_name = 'pinned';
        `);
        output.verification.project_profiles_pinned = profRes.rows;

    } catch (err) {
        output.error = err.message;
        log(`Migration failed: ${err.message}`);
    } finally {
        await client.end();
        log("Connection closed.");
    }

    fs.writeFileSync('migration_output.json', JSON.stringify(output, null, 2));
}

runMigration();
