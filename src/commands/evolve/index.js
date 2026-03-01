const { ChatInputCommandBuilder } = require('@discordjs/builders');
const xenoModel = require('../../models/xenomorph');
const db = require('../../db');
const cmd = { name: 'evolve', description: 'Evolve your xenomorphs' };

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: new ChatInputCommandBuilder()
    .setName(cmd.name)
    .setDescription(cmd.description)
    .addSubcommands(sub =>
      sub.setName('start')
        .setDescription('Start an evolution')
        .addIntegerOptions(opt => opt.setName('xeno_id').setDescription('Xenomorph id').setRequired(true))
        .addStringOptions(opt => opt.setName('target').setDescription('Target role').setRequired(true))
    )
    .addSubcommands(sub => sub.setName('list').setDescription('List your xenomorphs'))
    .addSubcommands(sub => sub.setName('info').setDescription('Show evolution info').addIntegerOptions(opt => opt.setName('xeno_id').setDescription('Xenomorph id').setRequired(true)))
    .addSubcommands(sub => sub.setName('cancel').setDescription('Cancel an ongoing evolution').addIntegerOptions(opt => opt.setName('job_id').setDescription('Evolution job id').setRequired(true))),

  async executeInteraction(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });
    try {
      const userId = String(interaction.user.id);
      if (sub === 'list') {
        const list = await xenoModel.listByOwner(userId);
        if (!list.length) return interaction.editReply({ content: 'You have no xenomorphs.' });
        const lines = list.slice(0, 25).map(x => `#${x.id} ${x.role || x.stage} (path: ${x.pathway})`);
        return interaction.editReply({ content: lines.join('\n') });
      }

      if (sub === 'start') {
        const xenoId = interaction.options.getInteger('xeno_id');
        const target = interaction.options.getString('target');
        const xeno = await xenoModel.getById(xenoId);
        if (!xeno) return interaction.editReply({ content: 'Xenomorph not found.' });
        if (String(xeno.owner_id) !== userId) return interaction.editReply({ content: 'You do not own this xenomorph.' });
        const defaults = { cost_jelly: 10, time_ms: 1000 * 60 * 60 };
        const resRow = await db.knex('user_resources').where({ user_id: userId }).first();
        const jelly = resRow ? Number(resRow.royal_jelly || 0) : 0;
        if (jelly < defaults.cost_jelly) return interaction.editReply({ content: `Insufficient royal jelly. Need ${defaults.cost_jelly}.` });
        await db.knex('user_resources').where({ user_id: userId }).update({ royal_jelly: Math.max(0, jelly - defaults.cost_jelly), updated_at: db.knex.fn.now() });
        const now = Date.now();
        const finishes = now + defaults.time_ms;
        const inserted = await db.knex('evolution_queue').insert({ xeno_id: xenoId, user_id: userId, hive_id: xeno.hive_id || null, target_role: target, started_at: now, finishes_at: finishes, cost_jelly: defaults.cost_jelly, stabilizer_used: false, status: 'queued' });
        const id = Array.isArray(inserted) ? inserted[0] : inserted;
        return interaction.editReply({ content: `Evolution started (job #${id}). It will finish in ~${Math.round(defaults.time_ms / 60000)} minutes.` });
      }

      if (sub === 'info') {
        const xenoId = interaction.options.getInteger('xeno_id');
        const xeno = await xenoModel.getById(xenoId);
        if (!xeno) return interaction.editReply({ content: 'Xenomorph not found.' });
        return interaction.editReply({ content: `#${xeno.id} ${xeno.role || xeno.stage} — pathway: ${xeno.pathway}` });
      }

      if (sub === 'cancel') {
        const jobId = interaction.options.getInteger('job_id');
        const job = await db.knex('evolution_queue').where({ id: jobId }).first();
        if (!job) return interaction.editReply({ content: 'Job not found.' });
        if (String(job.user_id) !== userId) return interaction.editReply({ content: 'You do not own this job.' });
        if (job.status !== 'queued') return interaction.editReply({ content: 'Job has already started or completed and cannot be cancelled.' });
        await db.knex('evolution_queue').where({ id: jobId }).del();
        return interaction.editReply({ content: 'Evolution cancelled. Resources are not refunded.' });
      }
    } catch (e) {
      return interaction.editReply({ content: `Error: ${e && (e.message || e)}` });
    }
  }
};
