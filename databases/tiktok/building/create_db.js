/**
 * Database Initialization Script (Enhanced)
 * 
 * This script:
 * 1. Validates connection strings.
 * 2. Checks if the PostgreSQL server is reachable.
 * 3. Ensures the target database exists.
 * 4. Runs the schema.sql file with advanced error handling and cleanup.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function checkPostgresReachable(baseUrl, ssl) {
    const testPool = new Pool({
        connectionString: baseUrl,
        ssl: ssl,
        connectionTimeoutMillis: 5000 // 5 second timeout
    });

    try {
        await testPool.query('SELECT 1');
        return true;
    } catch (err) {
        console.error('❌ Error: PostgreSQL server is not reachable.');
        console.error(`   Message: ${err.message}`);
        console.log('   Please make sure PostgreSQL is installed and running on your system.');
        return false;
    } finally {
        await testPool.end();
    }
}

async function run() {
    const databaseUrl = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL || process.env.RAILWAY_DATABASE_URL;

    if (!databaseUrl) {
        console.error('❌ Error: No database connection string found in .env or .env.local');
        console.log('   Expected: LOCAL_DATABASE_URL or DATABASE_URL');
        process.exit(1);
    }

    console.log('🚀 Starting Pre-flight Checks...');

    // Parse the URL to get the database name and a base connection string
    let dbName = 'postgres';
    let baseUrl = databaseUrl;
    const isLocal = !!process.env.LOCAL_DATABASE_URL;
    const ssl = process.env.DATABASE_URL && !isLocal ? { rejectUnauthorized: false } : false;

    try {
        const url = new URL(databaseUrl);
        dbName = url.pathname.slice(1) || 'postgres';
        url.pathname = '/postgres'; // Connect to default 'postgres' to check server status
        baseUrl = url.toString();
    } catch (e) {
        console.warn('⚠️  Warning: Could not parse database URL. Using raw string.');
    }

    // Step 0: Check if Postgres is reachable
    const reachable = await checkPostgresReachable(baseUrl, ssl);
    if (!reachable) process.exit(1);
    console.log('✅ PostgreSQL server is reachable.');

    // Step 1: Ensure the database exists
    if (dbName !== 'postgres') {
        console.log(`📡 Checking if database "${dbName}" exists...`);
        const adminPool = new Pool({ connectionString: baseUrl, ssl });

        try {
            const res = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
            if (res.rowCount === 0) {
                console.log(`💎 Database "${dbName}" not found. Creating it now...`);
                await adminPool.query(`CREATE DATABASE "${dbName}"`);
                console.log(`✅ Database "${dbName}" created successfully.`);
            } else {
                console.log(`✅ Database "${dbName}" already exists.`);
            }
        } catch (err) {
            console.error(`⚠️  Database creation check warning: ${err.message}`);
        } finally {
            await adminPool.end();
        }
    }

    // Step 2: Initialize Schema
    console.log('📝 Preparing schema...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
        console.error(`❌ Error: schema.sql not found at ${schemaPath}`);
        process.exit(1);
    }

    let sql = fs.readFileSync(schemaPath, 'utf-8');
    
    // Advanced Cleanup: Strip comments and tool-specific commands
    sql = sql.replace(/^\\.*$/gm, '') // Remove all \ prefixed commands (like \restrict)
             .replace(/^ALTER TABLE .* OWNER TO .*$/gm, '')
             .replace(/^ALTER SCHEMA .* OWNER TO .*$/gm, '')
             .replace(/^SET .*$/gm, ''); // Remove session settings like SET statement_timeout

    const pool = new Pool({ connectionString: databaseUrl, ssl });

    try {
        console.log('⚡ Executing schema.sql...');
        
        // Wrap execution in a transaction for safety
        await pool.query('BEGIN');
        
        // Split SQL by semicolons to execute statements one by one for better error tracking
        // This is a simple split, might need more complexity if there are functions/triggers
        // But for standard dumps, it works well if we handle the complexity.
        // Actually, running the whole block is safer for complex dependencies.
        await pool.query(sql);
        
        await pool.query('COMMIT');
        console.log('🎉 Database initialized successfully!');
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('❌ Error during schema initialization:');
        console.error(`   ${err.message}`);
        if (err.detail) console.error(`   Detail: ${err.detail}`);
        console.log('\n💡 Tip: If you are seeing "already exists" errors, the database might already be populated.');
        process.exit(1);
    } finally {
        await pool.end();
    }
}

run().catch(err => {
    console.error('💥 Fatal application error:');
    console.error(err);
    process.exit(1);
});

