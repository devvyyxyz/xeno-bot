module.exports = async () => {
  try {
    const { knex } = require('../src/db');
    if (knex && typeof knex.destroy === 'function') await knex.destroy();
  } catch (e) {
    // ignore
  }
};
