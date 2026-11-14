const mysql = require('mysql2/promise');

let pool;

function databaseConfig() {
  const required = ['DB_USER', 'DB_NAME'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Database is not configured: missing ${missing.join(', ')}`);

  const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 5),
    enableKeepAlive: true,
  };

  if (process.env.INSTANCE_UNIX_SOCKET) config.socketPath = process.env.INSTANCE_UNIX_SOCKET;
  else {
    config.host = process.env.DB_HOST || '127.0.0.1';
    config.port = Number(process.env.DB_PORT || 3306);
  }
  return config;
}

function getPool() {
  if (!pool) pool = mysql.createPool(databaseConfig());
  return pool;
}

async function query(sql, values = []) {
  const [rows] = await getPool().execute(sql, values);
  return rows;
}

async function transaction(work) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = { query, transaction, close };
