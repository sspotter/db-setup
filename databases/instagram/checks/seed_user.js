require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../db');

async function seedUser() {
  const email = '123@123.com';
  const plainPassword = '123';
  const saltRounds = 10;
  try {
    const passwordHash = await bcrypt.hash(plainPassword, saltRounds);

    // UPSERT basically or check if exists
    const res = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (res.rows.length === 0) {
      await pool.query('INSERT INTO users (email, password_hash, status, plan) VALUES ($1, $2, $3, $4)', [email, passwordHash, 'active', 'pro']);
      console.log('User created: 123@123.com / 123');
    } else {
      await pool.query('UPDATE users SET password_hash = $2 WHERE email = $1', [email, passwordHash]);
      console.log('User password updated: 123@123.com / 123');
    }
  } catch (err) {
    console.error('Seed error:', err.message);
  } finally {
    pool.end();
  }
}

seedUser();
