require('dotenv').config();
const pool = require('../db');

async function checkUsers() {
    try {
        console.log('Checking users in Railway PostgreSQL...');
        const res = await pool.query('SELECT id, email, status FROM users;');
        console.log(`Found ${res.rows.length} users:`);
        res.rows.forEach(user => {
            console.log(`- ID: ${user.id}, Email: ${user.email}, Status: ${user.status}`);
        });
        process.exit(0);
    } catch (err) {
        console.error('Check failed:', err.message);
        process.exit(1);
    }
}

checkUsers();
