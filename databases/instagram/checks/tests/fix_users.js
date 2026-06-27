require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function fix() {
  try {
    const client = await pool.connect();
    console.log("Adding PK to users...");
    await client.query(`ALTER TABLE users ADD PRIMARY KEY (id);`);
    console.log("Adding UNIQUE to users email...");
    await client.query(`ALTER TABLE users ADD UNIQUE (email);`);
    console.log("Pks added.");
    client.release();
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
fix();
