require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

async function fix() {
  try {
    const client = await pool.connect();
    console.log("Adding PK to posts...");
    await client.query(`ALTER TABLE posts ADD PRIMARY KEY (shortcode);`);
    console.log("Adding UNIQUE to ig_users username...");
    await client.query(`ALTER TABLE ig_users ADD UNIQUE (username);`).catch(e => console.log(e.message));
    console.log("Pks added.");
    client.release();
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
fix();
