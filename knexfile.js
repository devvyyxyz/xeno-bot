// Knexfile for running migrations
const path = require('path');

module.exports = {
  development: {
    client: 'sqlite3',
    connection: {
      filename: path.join(__dirname, 'data', 'dev.sqlite')
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, 'migrations')
    }
  },
  
  production: {
    client: process.env.DATABASE_URL ? (
      process.env.DATABASE_URL.includes('mysql') || process.env.DATABASE_URL.includes(':3306') 
        ? 'mysql2' 
        : 'pg'
    ) : 'sqlite3',
    connection: process.env.DATABASE_URL || {
      filename: path.join(__dirname, 'data', 'production.sqlite')
    },
    pool: {
      min: 0,
      max: process.env.DB_POOL_MAX ? Number(process.env.DB_POOL_MAX) : 4
    },
    migrations: {
      directory: path.join(__dirname, 'migrations')
    }
  }
  ,
  mysql: {
    client: 'mysql2',
    connection: {
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
      user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
      password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || process.env.DB_DATABASE || 'xeno_bot',
      charset: process.env.MYSQL_CHARSET || 'utf8mb4'
    },
    pool: { min: 0, max: process.env.DB_POOL_MAX ? Number(process.env.DB_POOL_MAX) : 4 },
    migrations: { directory: path.join(__dirname, 'migrations') }
  }
};
