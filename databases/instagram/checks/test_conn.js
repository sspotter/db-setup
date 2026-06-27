require('dotenv').config();
const pool = require('../db');

async function testConnection() {
    try {
        console.log('Testing connection to Railway PostgreSQL from backend folder...');
        const res = await pool.query('SELECT current_database(), current_user, version();');
        console.log('Successfully connected!');
        console.log('Database:', res.rows[0].current_database);
        console.log('User:', res.rows[0].current_user);
        console.log('PostgreSQL Version:', res.rows[0].version);
        process.exit(0);
    } catch (err) {
        console.error('Connection failed:', err.message);
        process.exit(1);
    }
}

testConnection();
