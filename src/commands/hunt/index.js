const { EmbedBuilder } = require('discord.js');
const hostModel = require('../../models/host');
const { getCommandConfig } = require('../../utils/commandsConfig');
const hostsCfg = require('../../../config/hosts.json');
const createInteractionCollector = require('../../utils/collectorHelper');

const cmd = getCommandConfig('hunt') || { name: 'hunt', description: 'Hunt for hosts to use in evolutions' };

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: {
    name: cmd.name,
    description: cmd.description,
    options: [
      { type: 1, name: 'go', description: 'Go hunt for a host (chance to find one)', options: [] },
      { type: 1, name: 'list', description: 'List your hunted hosts' }
    ]
  },

  async executeInteraction(interaction) {
    const safeReply = require('../../utils/safeReply');
    const sub = (() => { try { return interaction.options.getSubcommand(); } catch (e) { return null; } })();
    const userId = interaction.user.id;

    // Build weighted host pool from config
    const cfgHosts = (hostsCfg && hostsCfg.hosts) || {};
    const hostKeys = Object.keys(cfgHosts || {});

    if (sub === 'go') {
      try {
        // Randomly determine if user finds a host (configurable chance)
        const findChance = Number((hostsCfg && hostsCfg.findChance) || 0.75);
        const found = Math.random() < findChance;
        if (!found) return safeReply(interaction, { content: 'You searched but found no suitable hosts this time.', ephemeral: true });

        // Weighted random selection using config weights
        const weights = hostKeys.map(k => Number(cfgHosts[k].weight || 1));
        const total = weights.reduce((s, v) => s + v, 0);
        let pick = Math.floor(Math.random() * total);
        let chosenKey = hostKeys[0] || 'human';
        for (let i = 0; i < hostKeys.length; i++) {
          if (pick < weights[i]) { chosenKey = hostKeys[i]; break; }
          pick -= weights[i];
        }
        const hostType = cfgHosts[chosenKey].display || chosenKey;
        const host = await hostModel.addHostForUser(userId, chosenKey);
        const embed = new EmbedBuilder().setTitle('Hunt Success').setDescription(`You found a host: **${hostType}** (ID: ${host.id}).`).setTimestamp();
        return safeReply(interaction, { embeds: [embed], ephemeral: true });
      } catch (e) {
        return safeReply(interaction, { content: `Hunt failed: ${e && (e.message || e)}`, ephemeral: true });
      }
    }

    if (sub === 'list') {
      try {
        const rows = await hostModel.listHostsByOwner(userId);
        if (!rows || rows.length === 0) return safeReply(interaction, { content: 'You have no hunted hosts. Use `/hunt go` to search.', ephemeral: true });

        // Build select menu options (max 25)
        const options = rows.slice(0, 25).map(r => ({ label: `${cfgHosts[r.host_type] ? cfgHosts[r.host_type].display : r.host_type} [${r.id}]`, value: String(r.id), description: `Found ${new Date(r.created_at).toLocaleString()}` }));
        const row = { type: 1, components: [ { type: 3, custom_id: 'hunt-select-host', placeholder: 'Select a host to view details', min_values: 1, max_values: 1, options } ] };

        const embed = new EmbedBuilder().setTitle(`${interaction.user.username}'s Hosts`).setDescription('Select a host from the dropdown to view details.').setTimestamp();

        // Use collector helper to attach a select menu collector
        let msg = null;
        const { collector, message: _msg } = await createInteractionCollector(interaction, { embeds: [embed], components: [row], time: 60_000, ephemeral: true, edit: true, collectorOptions: { componentType: 3 } });
        if (!msg && _msg) msg = _msg;
        if (!collector) return safeReply(interaction, { content: 'Failed creating inventory view.', ephemeral: true });

        let handled = false;
        collector.on('collect', async i => {
          try {
            if (i.user.id !== interaction.user.id) { await i.reply({ content: 'Only the command invoker can interact with this menu.', ephemeral: true }); return; }
            const selected = (i.values && i.values[0]) || null;
            if (!selected) return;
            const host = rows.find(r => String(r.id) === String(selected));
            if (!host) { await i.reply({ content: 'Selected host not found.', ephemeral: true }); return; }
            const info = cfgHosts[host.host_type] || {};
            const detail = new EmbedBuilder()
              .setTitle(`${info.display || host.host_type} [${host.id}]`)
              .setDescription(info.description || '')
              .addFields(
                { name: 'Host Type', value: String(host.host_type), inline: true },
                { name: 'Found At', value: String(new Date(Number(host.found_at || host.created_at)).toLocaleString()), inline: true }
              )
              .setTimestamp();

            // Add action buttons: use for evolve
            const buttonsRow = { type: 1, components: [
              { type: 2, style: 1, custom_id: `hunt-use-evolve:${host.id}`, label: 'Use for /evolve', disabled: false },
              { type: 2, style: 2, custom_id: 'hunt-inventory-close', label: 'Close', disabled: false }
            ] };

            handled = true;
            await i.update({ embeds: [detail], components: [buttonsRow] });
            // Attach a short-lived collector for the buttons
            try {
              const msg = await interaction.fetchReply();
              const btnCollector = msg.createMessageComponentCollector({ filter: b => b.user.id === interaction.user.id, time: 60_000 });
              btnCollector.on('collect', async bi => {
                try {
                  if (bi.customId === `hunt-use-evolve:${host.id}`) {
                    await bi.reply({ content: `To evolve a xenomorph using this host, run: /evolve start (provide xenomorph id) and include host id ${host.id} as the host parameter.`, ephemeral: true });
                    btnCollector.stop('used');
                    return;
                  }
                  if (bi.customId === 'hunt-inventory-close') {
                    await bi.update({ embeds: [new EmbedBuilder().setTitle('Closed').setDescription('Host details closed.').setTimestamp()], components: [] });
                    btnCollector.stop('closed');
                    return;
                  }
                } catch (err) { try { await bi.reply({ content: 'Error handling button.', ephemeral: true }); } catch (_) {} }
              });
            } catch (_) {}
            collector.stop('selected');
          } catch (err) {
            try { await i.reply({ content: `Error handling selection: ${err && err.message}`, ephemeral: true }); } catch (_) {}
          }
        });

        collector.on('end', async (_collected, reason) => {
          if (!handled && reason === 'time') {
            try { await msg.edit({ embeds: [new EmbedBuilder().setTitle('Timed Out').setDescription('Inventory selection timed out.' ).setTimestamp()], components: [] }); } catch (_) {}
          }
        });

        return;
      } catch (e) {
        return safeReply(interaction, { content: `Failed listing hosts: ${e && (e.message || e)}`, ephemeral: true });
      }
    }

    return safeReply(interaction, { content: 'Unknown hunt subcommand.', ephemeral: true });
  }
};
