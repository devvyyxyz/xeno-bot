exports.up = async function(knex) {
  const hasRole = await knex.schema.hasColumn('xenomorphs', 'role');
  const hasStage = await knex.schema.hasColumn('xenomorphs', 'stage');
  const hasData = await knex.schema.hasColumn('xenomorphs', 'data');

  if (!hasRole && !hasStage) return;

  // Update rows that have the literal 'standard_facehugger' value
  if (hasRole || hasStage) {
    const rows = await knex('xenomorphs')
      .select('id', 'role', 'stage', 'pathway', 'data')
      .where(function() {
        if (hasRole) this.orWhere('role', 'standard_facehugger');
        if (hasStage) this.orWhere('stage', 'standard_facehugger');
      });

    for (const r of rows) {
      const updates = {};
      if (hasRole && r.role === 'standard_facehugger') updates.role = 'facehugger';
      if (hasStage && r.stage === 'standard_facehugger') updates.stage = 'facehugger';
      if (!r.pathway) updates.pathway = 'standard';

      // Mark the row so the migration can be reverted safely
      if (hasData) {
        try {
          const parsed = r.data ? JSON.parse(r.data) : {};
          parsed._migrations = parsed._migrations || {};
          parsed._migrations.standard_facehugger_fix = true;
          updates.data = JSON.stringify(parsed);
        } catch (e) {
          // If parsing fails, attach a small marker object instead
          updates.data = JSON.stringify({ _migrations: { standard_facehugger_fix: true } });
        }
      }

      if (Object.keys(updates).length) {
        updates.updated_at = knex.fn.now();
        await knex('xenomorphs').where({ id: r.id }).update(updates);
      }
    }
  }
};

exports.down = async function(knex) {
  // Revert only rows that were tagged by the up migration
  const hasRole = await knex.schema.hasColumn('xenomorphs', 'role');
  const hasStage = await knex.schema.hasColumn('xenomorphs', 'stage');
  const hasData = await knex.schema.hasColumn('xenomorphs', 'data');

  if (!hasData) return;

  const rows = await knex('xenomorphs').select('id', 'role', 'stage', 'data').whereNotNull('data');

  for (const r of rows) {
    let parsed;
    try {
      parsed = r.data ? JSON.parse(r.data) : null;
    } catch (e) {
      parsed = null;
    }
    if (!parsed || !parsed._migrations || !parsed._migrations.standard_facehugger_fix) continue;

    const updates = {};
    if (hasRole && r.role === 'facehugger') updates.role = 'standard_facehugger';
    if (hasStage && r.stage === 'facehugger') updates.stage = 'standard_facehugger';

    // remove the migration tag
    try {
      delete parsed._migrations.standard_facehugger_fix;
      if (Object.keys(parsed._migrations).length === 0) delete parsed._migrations;
      updates.data = JSON.stringify(parsed);
    } catch (e) {
      // ignore
    }

    if (Object.keys(updates).length) {
      updates.updated_at = knex.fn.now();
      await knex('xenomorphs').where({ id: r.id }).update(updates);
    }
  }
};
