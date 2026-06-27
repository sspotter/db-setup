require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

pool.query(`SELECT conname, contype FROM pg_constraint WHERE conrelid = 'users'::regclass`)
  .then(res => {
    console.log(res.rows);
    pool.end();
  })
  .catch(console.error);
