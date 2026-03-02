const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder
} = require('discord.js');
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  SecondaryButtonBuilder,
  PrimaryButtonBuilder
} = require('@discordjs/builders');
const { getCommandConfig, getCommandsObject } = require('../../utils/commandsConfig');
const { addV2TitleWithBotThumbnail } = require('../../utils/componentsV2');
const fallbackLogger = require('../../utils/fallbackLogger');
const safeReply = require('../../utils/safeReply');
const cmd = getCommandConfig('help') || { name: 'help', description: 'Show help for available commands' };

function getCategories() {
  const commandsConfig = getCommandsObject();
  const keys = Object.keys(commandsConfig || {}).filter(k => k !== 'colour' && typeof commandsConfig[k] === 'object');
  const visible = keys.filter(k => {
    try {
      const cat = commandsConfig[k] || {};
      return Object.values(cat).some(c => c && c.name && c.developerOnly !== true && c.hidden !== true);
    } catch (e) { return false; }
  });
  return visible.length ? visible : keys;
}

function getCommandsByCategory(category) {
  const commandsConfig = getCommandsObject();
  if (!commandsConfig) return [];
  if (category === 'All') {
    const out = [];
    for (const k of Object.keys(commandsConfig).filter(k => k !== 'colour' && typeof commandsConfig[k] === 'object')) {
      const cat = commandsConfig[k] || {};
      for (const cmdKey of Object.keys(cat)) {
        const entry = cat[cmdKey];
        // hide developer-only or explicitly hidden commands from help
        if (entry && (entry.developerOnly === true || entry.hidden === true)) continue;
        // if entry defines subcommands, expand them
        if (entry && entry.subcommands && typeof entry.subcommands === 'object') {
          for (const [subKey, subVal] of Object.entries(entry.subcommands)) {
            const pub = Object.assign({}, subVal);
            pub.base = entry.name || cmdKey;
            pub.sub = subKey;
            out.push(pub);
          }
        } else {
          out.push(entry);
        }
      }
    }
    // dedupe by name
    const seen = new Set();
    return out.filter(c => {
      const n = c && c.name ? c.name : JSON.stringify(c);
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
  }
  const cat = (commandsConfig && commandsConfig[category]) || {};
  const out = [];
  for (const key of Object.keys(cat)) {
    const c = cat[key];
    if (!c || c.developerOnly === true || c.hidden === true) continue;
    if (c.subcommands && typeof c.subcommands === 'object') {
      for (const [subKey, subVal] of Object.entries(c.subcommands)) {
        const pub = Object.assign({}, subVal);
        pub.base = c.name || key;
        pub.sub = subKey;
        out.push(pub);
      }
    } else {
      out.push(c);
    }
  }
  return out;
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  data: { name: cmd.name, description: cmd.description },
  async executeInteraction(interaction) {
    const logger = require('../../utils/logger').get('command:help');
    const categories = getCategories();
    // include "All" category at the front
    if (!categories.includes('All')) categories.unshift('All');
    // Default: show first category
    const initialCategory = categories[0];
    // try to fetch guild commands first, fallback to application commands
    let appCommands = null;
    try {
      if (interaction.guild) {
        appCommands = await interaction.guild.commands.fetch();
      }
    } catch (e) {
      try { logger && logger.warn && logger.warn('Failed fetching guild commands in help command', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed to fetch guild commands for help', le && (le.stack || le)); }
    }
    if (!appCommands) {
      try {
        appCommands = await interaction.client.application.commands.fetch();
      } catch (e) {
        try { logger && logger.warn && logger.warn('Failed fetching app commands for help command', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging app command fetch failure in help', le && (le.stack || le)); }
      }
    }

    function toMention(cmdEntry) {
      let id = null;
      try {
        if (appCommands) {
          const baseName = cmdEntry.base || cmdEntry.name;
          const found = appCommands.find(ac => ac.name === baseName);
          if (found) id = found.id;
        }
      } catch (e) {
        try { logger && logger.warn && logger.warn('Failed resolving command mention in help', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging mention resolve failure in help', le && (le.stack || le)); }
      }

      if (cmdEntry.base && cmdEntry.sub) {
        if (id) return `</${cmdEntry.base} ${cmdEntry.sub}:${id}>`;
        return `/${cmdEntry.base} ${cmdEntry.sub}`;
      }

      const baseName = cmdEntry.name || cmdEntry.base;
      if (id) return `</${baseName}:${id}>`;
      return `/${baseName}`;
    }

    function buildPagesForCategory(cat) {
      const cmds = getCommandsByCategory(cat);
      const commandsCfg = getCommandsObject();
      
      // Group commands by their 'group' field
      const grouped = {};
      cmds.forEach(c => {
        let group = 'Other';
        
        // Try to get group from command itself first
        if (c.group) {
          group = c.group;
        } else if (commandsCfg && commandsCfg[cat]) {
          // For subcommands: look up base command's group or subcommand's group
          const baseName = c.base || c.name;
          const baseEntry = commandsCfg[cat][baseName];
          
          if (baseEntry) {
            if (c.sub && baseEntry.subcommands && baseEntry.subcommands[c.sub]) {
              // Try subcommand's own group first
              group = baseEntry.subcommands[c.sub].group || baseEntry.group || 'Other';
            } else {
              // Use base command's group
              group = baseEntry.group || 'Other';
            }
          }
        }
        
        if (!grouped[group]) grouped[group] = [];
        grouped[group].push(c);
      });
      
      // Create pages where each page contains multiple groups
      const pages = [];
      const groupEntries = Object.entries(grouped);
      let currentPage = [];
      let currentSize = 0;
      
      for (const [groupName, cmds] of groupEntries) {
        const groupData = { groupName, commands: cmds };
        currentSize += cmds.length + 1; // +1 for group header
        
        // Start new page if current would exceed size
        if (currentSize > 10 && currentPage.length > 0) {
          pages.push(currentPage);
          currentPage = [];
          currentSize = cmds.length + 1;
        }
        
        currentPage.push(groupData);
      }
      
      if (currentPage.length > 0) pages.push(currentPage);
      return pages.length ? pages : [[]];
    }

    function setupIntroText() {
      let setupIntro = 'Configure the bot with `/setup` — subcommands: `/setup channel`, `/setup spawn-rate`, `/setup egg-limit`, `/setup avatar`, `/setup details`. Use `/setup reset` to reset a user or server (admin/owner only).';
      try {
        if (appCommands) {
          const setupCmd = appCommands.find(ac => ac.name === 'setup');
          if (setupCmd && setupCmd.id) {
            const id = setupCmd.id;
            const sub = ['channel', 'spawn-rate', 'egg-limit', 'avatar', 'details', 'reset'];
            const mentions = sub.map(s => `</setup ${s}:${id}>`);
            const root = `</setup:${id}>`;
            setupIntro = `Configure the bot with ${root} — subcommands: ${mentions.slice(0, 5).join(', ')}. Use ${mentions[5]} to reset a user or server (admin/owner only).`;
          }
        }
      } catch (_) {}
      return setupIntro;
    }

    const commandsCfg = getCommandsObject();
    const catEmojis = (commandsCfg && commandsCfg.categoryEmojis) || {};

    function buildHelpComponents(cat, pages, pageIndex, expired = false, client = null) {
      const pageGroups = pages[pageIndex] || [];
      const container = new ContainerBuilder();

      addV2TitleWithBotThumbnail({ container, title: 'Commands Help', client });

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('Xeno Bot manages egg spawns, collections, and in-server economies. Use commands below to interact with bot features.'),
        new TextDisplayBuilder().setContent(`**Setup (Server Admins)**\n${setupIntroText()}`)
      );

      if (!pageGroups.length) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent('_No visible commands in this category._')
        );
      } else {
        // Render each group with its commands
        for (const groupData of pageGroups) {
          if (!groupData || !groupData.commands) continue;
          
          const { groupName, commands } = groupData;
          const lines = commands
            .map(c => {
              if (!c) return null;
              try {
                const mention = toMention(c);
                const desc = (c.description || '').substring(0, 100); // Limit description length
                return desc ? `**${mention}**\n${desc}` : `**${mention}**`;
              } catch (e) {
                return null;
              }
            })
            .filter(l => l !== null)
            .join('\n\n');
          
          if (lines) {
            container.addTextDisplayComponents(
              new TextDisplayBuilder().setContent(`**${groupName}**\n\n${lines}`)
            );
          }
        }
      }

      if (!expired) {
        const options = categories.slice(0, 25).map(category => {
          const opt = {
            label: category,
            value: category,
            default: category === cat
          };
          const raw = catEmojis[category];
          if (raw && typeof raw === 'string') {
            const m = raw.match(/^<:([^:>]+):([0-9]+)>$/);
            if (m) opt.emoji = { name: m[1], id: m[2] };
            else opt.emoji = raw;
          }
          return opt;
        });

        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('help-category')
              .setPlaceholder('Select a command category')
              .addOptions(...options)
          )
        );

        // Separator before pagination
        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
        );

        const pageText = pages.length > 1 ? `Page ${pageIndex + 1} of ${pages.length}` : '';
        const navRow = new ActionRowBuilder().addComponents(
          new SecondaryButtonBuilder().setCustomId('help-prev').setLabel('Previous').setDisabled(pageIndex === 0),
          new SecondaryButtonBuilder().setCustomId('help-page-info').setLabel(pageText || 'Navigation').setDisabled(true),
          new SecondaryButtonBuilder().setCustomId('help-next').setLabel('Next').setDisabled(pageIndex >= pages.length - 1)
        );
        container.addActionRowComponents(navRow);
      }

      const footer = expired
        ? `_Category: ${cat} • Page ${pageIndex + 1} of ${Math.max(1, pages.length)} • Help view expired_`
        : `_Category: ${cat} • Page ${pageIndex + 1} of ${Math.max(1, pages.length)}_`;
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));

      return [container];
    }

    let currentCategory = initialCategory;
    let pages = buildPagesForCategory(initialCategory);
    let page = 0;

    try {
      await safeReply(interaction, {
        components: buildHelpComponents(currentCategory, pages, page, false, interaction.client),
        flags: MessageFlags.IsComponentsV2,
        ephemeral: cmd.ephemeral === true
      }, { loggerName: 'command:help' });
    } catch (e) {
      try {
        logger.warn('Help V2 payload failed, using plain text fallback', { error: e && (e.stack || e) });
      } catch (_) {}
      await safeReply(interaction, {
        content: 'Help UI failed to render with components. Please try again.'
      }, { loggerName: 'command:help' });
      return;
    }

    let msg = null;
    try { msg = await interaction.fetchReply(); } catch (_) {}
    if (!msg || typeof msg.createMessageComponentCollector !== 'function') {
      try { logger.warn('Failed to attach help collector (no message)'); } catch (le) { try { fallbackLogger.warn('Failed to attach help collector', le && (le.stack || le)); } catch (ignored) {} }
      return;
    }

    const collector = msg.createMessageComponentCollector({
      filter: i => ['help-category', 'help-prev', 'help-next'].includes(i.customId),
      time: 120_000
    });

    collector.on('collect', async i => {
      try {
        if (i.user.id !== interaction.user.id) {
          await safeReply(i, { content: 'Only the command user can interact with this view.', ephemeral: true }, { loggerName: 'command:help' });
          return;
        }

        if (i.customId === 'help-category') {
          const cat = i.values[0];
          currentCategory = cat;
          pages = buildPagesForCategory(cat);
          page = 0;
          await i.update({ components: buildHelpComponents(currentCategory, pages, page, false, interaction.client) });
          return;
        }

        if (i.customId === 'help-prev' || i.customId === 'help-next') {
          if (i.customId === 'help-next' && page < pages.length - 1) page++;
          if (i.customId === 'help-prev' && page > 0) page--;
          await i.update({ components: buildHelpComponents(currentCategory, pages, page, false, interaction.client) });
          return;
        }
      } catch (err) {
        try { await safeReply(i, { content: 'Failed to update help view.', ephemeral: true }, { loggerName: 'command:help' }); } catch (e) { try { logger && logger.warn && logger.warn('Failed to send failure safeReply in help command', { error: e && (e.stack || e) }); } catch (le) { fallbackLogger.warn('Failed logging safeReply failure in help', le && (le.stack || le)); } }
      }
    });

    collector.on('end', async () => {
      try {
        if (msg) {
          await msg.edit({ components: buildHelpComponents(currentCategory, pages, page, true, interaction.client) });
        }
      } catch (e) { try { logger && logger.warn && logger.warn('Failed finalizing help view after collector end', { error: e && (e.stack || e) }); } catch (le) { try { fallbackLogger.warn('Failed logging help finalization failure', le && (le.stack || le)); } catch (ignored) {} } }
    });
  },
  // text-mode handler removed; use slash command
};
