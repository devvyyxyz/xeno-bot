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
      max: 7
    },
    migrations: {
      directory: path.join(__dirname, 'migrations')
    }
  }
};
