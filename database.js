const { Pool } = require('pg');

// Prefer pooled URLs for the serverless runtime. In particular, Vercel's
// Neon integration exposes both DATABASE_URL and POSTGRES_URL; POSTGRES_URL
// is the pooled endpoint intended for application connections.
const connectionString = process.env.POSTGRES_URL
  || process.env.Dynamic_Storage_POSTGRES_URL
  || process.env.DATABASE_URL
  || process.env.Dynamic_Storage_DATABASE_URL
  || process.env.POSTGRES_URL_NON_POOLING
  || process.env.Dynamic_Storage_POSTGRES_URL_NON_POOLING;
if (!connectionString) {
  throw new Error('Set DATABASE_URL (provided by Vercel’s Neon integration) or POSTGRES_URL to your PostgreSQL connection URL.');
}

// Vercel functions are short lived. Keep one connection per warm instance and
// use the pooled Neon URL injected by the Vercel integration when available.
const pool = new Pool({
  connectionString,
  max: 1,
  idleTimeoutMillis: 10000,
  // Neon can take several seconds to wake a serverless compute after idle time.
  // Leave enough of Vercel's 60-second function window for that cold connection.
  connectionTimeoutMillis: 30000,
  ssl: { rejectUnauthorized: false },
});
pool.on('error', (err) => console.error('Idle PostgreSQL connection error:', err.message));

const toPostgres = (sql) => {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
};

async function all(sql, params = []) {
  const result = await pool.query(toPostgres(sql), params);
  return result.rows;
}

async function get(sql, params = []) {
  return (await all(sql, params))[0];
}

async function run(sql, params = []) {
  const result = await pool.query(toPostgres(sql), params);
  return {
    lastID: result.rows[0] && result.rows[0].id,
    changes: result.rowCount || 0,
  };
}

module.exports = { pool, all, get, run };
