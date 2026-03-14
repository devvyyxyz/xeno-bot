/*
 Placeholder migration: file was referenced in migration history but missing from disk.
 This no-op ensures the migration directory matches the DB migration records so
 `knex migrate:latest` can proceed. If you prefer a different behavior, replace
 this file with the intended migration logic.
*/

exports.up = async function(knex) {
  // No-op placeholder
  return Promise.resolve();
};

exports.down = async function(knex) {
  // No-op placeholder
  return Promise.resolve();
};
