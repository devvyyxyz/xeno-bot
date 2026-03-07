exports.up = async function(knex) {
  // Rename existing xenomorph rows that have generic 'facehugger' role
  // to pathway-specific names (e.g., 'dog_facehugger') for non-standard pathways.
  const hasRole = await knex.schema.hasColumn('xenomorphs', 'role');
  const hasStage = await knex.schema.hasColumn('xenomorphs', 'stage');

  if (hasRole) {
    const rows = await knex('xenomorphs').select('id', 'pathway').where({ role: 'facehugger' }).andWhereNot('pathway', 'standard');
    for (const r of rows) {
      if (!r.pathway) continue;
      const newRole = `${r.pathway}_facehugger`;
      await knex('xenomorphs').where({ id: r.id }).update({ role: newRole });
    }
  }

  if (hasStage) {
    const rows = await knex('xenomorphs').select('id', 'pathway').where({ stage: 'facehugger' }).andWhereNot('pathway', 'standard');
    for (const r of rows) {
      if (!r.pathway) continue;
      const newStage = `${r.pathway}_facehugger`;
      await knex('xenomorphs').where({ id: r.id }).update({ stage: newStage });
    }
  }
};

exports.down = async function(knex) {
  // Revert pathway-specific facehugger names back to generic 'facehugger'
  const hasRole = await knex.schema.hasColumn('xenomorphs', 'role');
  const hasStage = await knex.schema.hasColumn('xenomorphs', 'stage');

  if (hasRole) {
    const rows = await knex('xenomorphs').select('id', 'role', 'pathway').whereNot('pathway', 'standard');
    for (const r of rows) {
      if (!r.role) continue;
      if (r.role.endsWith('_facehugger')) {
        await knex('xenomorphs').where({ id: r.id }).update({ role: 'facehugger' });
      }
    }
  }

  if (hasStage) {
    const rows = await knex('xenomorphs').select('id', 'stage', 'pathway').whereNot('pathway', 'standard');
    for (const r of rows) {
      if (!r.stage) continue;
      if (r.stage.endsWith('_facehugger')) {
        await knex('xenomorphs').where({ id: r.id }).update({ stage: 'facehugger' });
      }
    }
  }
};
