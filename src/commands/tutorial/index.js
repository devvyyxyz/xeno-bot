const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize
} = require('discord.js');
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  SecondaryButtonBuilder,
  PrimaryButtonBuilder
} = require('@discordjs/builders');
const { getCommandConfig } = require('../../utils/commandsConfig');
const { addV2TitleWithBotThumbnail } = require('../../utils/componentsV2');
const safeReply = require('../../utils/safeReply');

const cmd = getCommandConfig('tutorial') || {
  name: 'tutorial',
  description: 'Learn how to play and set up the bot.',
  ephemeral: true
};

const CATEGORY_ORDER = ['admins', 'basics', 'hives', 'evolution', 'hunts', 'extra'];

const CATEGORIES = {
  admins: {
    label: 'Server Admin Setup',
    emoji: '🛠️',
    pages: [
      [
        '**Setup Essentials**',
        '- Use `/setup channel` to choose where egg spawns appear.',
        '- Use `/setup spawn-rate` to tune min/max spawn timing.',
        '- Use `/setup egg-limit` to cap eggs per spawn (max 10).',
        '- Use `/setup details` to review current server settings.'
      ],
      [
        '**Admin Utilities**',
        '- Use `/setup hunt-cooldown` to control hunt pacing.',
        '- Use `/setup message-delete` to remove spawn messages after catches.',
        '- Use `/forcespawn` for manual test spawns (admin only).',
        '- Use `/joinnotice` to test your join webhook notice.'
      ]
    ]
  },
  basics: {
    label: 'Basic Gameplay',
    emoji: '🎮',
    pages: [
      [
        '**Getting Started**',
        'You start with one egg and can begin building from there.',
        '- Claim eggs from spawn events in your configured channel.',
        '- Use `/eggs info` to inspect egg details and hatch time.',
        '- Sell extra eggs for Royal Jelly using `/eggs sell`.'
      ],
      [
        '**Core Loop**',
        '- Hatch eggs with `/eggs hatch`.',
        '- Track hatch status and collect ready hatches in `/eggs list`.',
        '- Use `/inventory` and `/stats` to monitor progress.',
        '- Use `/leaderboard` to compare progress with others.'
      ]
    ]
  },
  hives: {
    label: 'Hives',
    emoji: '🏠',
    pages: [
      [
        '**Hive Basics**',
        '- Create your hive with `/hive create` once eligible.',
        '- Check status and progress with `/hive stats`.',
        '- View milestones with `/hive milestones`.',
        '- Track queen output via `/hive queen-status`.'
      ],
      [
        '**Hive Management**',
        '- Improve performance using `/hive modules` and `/hive upgrade-module`.',
        '- Upgrade queen systems using `/hive upgrade-queen`.',
        '- Review activity with `/hive events`.',
        '- Defend when needed using `/hive defend`.'
      ]
    ]
  },
  evolution: {
    label: 'Evolution & Hatching',
    emoji: '🥚',
    pages: [
      [
        '**Hatching Flow**',
        '- Start hatches from `/eggs hatch`.',
        '- Use `/eggs list` to collect eggs after timers complete.',
        '- Different egg types lead to different starting stages.',
        '- Keep enough hosts ready before deeper evolution chains.'
      ],
      [
        '**Evolution Flow**',
        '- Use `/evolve start` to evolve compatible xenomorphs.',
        '- Use `/evolve list` to view candidates and progress.',
        '- Use `/evolve info` for details and requirements.',
        '- Use `/pathway` to understand pathway routes and outcomes.'
      ]
    ]
  },
  hunts: {
    label: 'Hunts',
    emoji: '🎯',
    pages: [
      [
        '**Hunting Hosts**',
        '- Use `/hunt` to search for potential hosts.',
        '- Cooldowns are server-configurable via setup.',
        '- Use `/hunt-list` to view, manage, and review collected hosts.',
        '- Keep diverse hosts for better evolution options.'
      ],
      [
        '**Hunt Tips**',
        '- Hunt regularly so evolution attempts do not stall.',
        '- Use hunt-list stats to understand your host mix.',
        '- Coordinate with egg hatching so resources are ready together.',
        '- Balance hunting with Royal Jelly spending decisions.'
      ]
    ]
  },
  extra: {
    label: 'Extra Tips',
    emoji: '💡',
    pages: [
      [
        '**Efficiency Tips**',
        '- Open `/news` frequently for change logs and updates.',
        '- Use `/help` for grouped command discovery.',
        '- Keep egg inventory healthy so hatching never pauses.',
        '- Sell surplus eggs when you need Royal Jelly quickly.'
      ],
      [
        '**Useful Commands**',
        '- `/encyclopedia` for egg and progression references.',
        '- `/nextspawn` to plan around spawn timings.',
        '- `/wiki` for guides and deeper documentation.',
        '- `/support-server` for assistance and feedback.'
      ]
    ]
  }
};

function buildTutorialComponents({ categoryKey, pageIdx, expired = false, client = null }) {
  const key = CATEGORIES[categoryKey] ? categoryKey : CATEGORY_ORDER[0];
  const category = CATEGORIES[key];
  const totalPages = Math.max(1, category.pages.length);
  const safePageIdx = Math.max(0, Math.min(Number(pageIdx) || 0, totalPages - 1));
  const lines = category.pages[safePageIdx] || [];

  const container = new ContainerBuilder();
  addV2TitleWithBotThumbnail({ container, title: 'Tutorial', client });
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**${category.emoji} ${category.label}**`),
    new TextDisplayBuilder().setContent(lines.join('\n'))
  );

  if (!expired) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    const options = CATEGORY_ORDER.map((catKey) => {
      const cat = CATEGORIES[catKey];
      return {
        label: cat.label,
        value: catKey,
        default: catKey === key,
        emoji: { name: cat.emoji }
      };
    });

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('tutorial-category')
          .setPlaceholder('Choose a tutorial category')
          .addOptions(...options)
      )
    );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new SecondaryButtonBuilder()
          .setCustomId('tutorial-prev')
          .setLabel('Previous')
          .setDisabled(safePageIdx === 0),
        new PrimaryButtonBuilder()
          .setCustomId('tutorial-page')
          .setLabel(`${safePageIdx + 1} / ${totalPages}`)
          .setDisabled(true),
        new SecondaryButtonBuilder()
          .setCustomId('tutorial-next')
          .setLabel('Next')
          .setDisabled(safePageIdx >= totalPages - 1)
      )
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('_Tutorial view expired_')
    );
  }

  return [container];
}

module.exports = {
  name: cmd.name,
  description: cmd.description,
  requiredPermissions: cmd.requiredPermissions,
  hidden: cmd.hidden === true,
  ephemeral: cmd.ephemeral === true,
  data: { name: cmd.name, description: cmd.description },

  async executeInteraction(interaction) {
    const logger = require('../../utils/logger').get('command:tutorial');

    let currentCategory = CATEGORY_ORDER[0];
    let currentPage = 0;

    try {
      await interaction.deferReply({ ephemeral: cmd.ephemeral !== false });
      await safeReply(
        interaction,
        {
          components: buildTutorialComponents({ categoryKey: currentCategory, pageIdx: currentPage, client: interaction.client }),
          flags: MessageFlags.IsComponentsV2
        },
        { loggerName: 'command:tutorial' }
      );

      let msg = null;
      try { msg = await interaction.fetchReply(); } catch (_) { /* ignore */ }
      if (!msg || typeof msg.createMessageComponentCollector !== 'function') return;

      const collector = msg.createMessageComponentCollector({ filter: () => true, time: 300_000 });

      collector.on('collect', async i => {
        try {
          if (i.user.id !== interaction.user.id) {
            try { await safeReply(i, { content: 'These controls are reserved for the user who opened this view.', ephemeral: true }, { loggerName: 'command:tutorial' }); } catch (_) { /* ignore */ }
            return;
          }

          if (i.customId === 'tutorial-category') {
            currentCategory = i.values[0] || CATEGORY_ORDER[0];
            currentPage = 0;
          } else if (i.customId === 'tutorial-prev') {
            currentPage = Math.max(0, currentPage - 1);
          } else if (i.customId === 'tutorial-next') {
            const total = Math.max(1, (CATEGORIES[currentCategory]?.pages || []).length);
            currentPage = Math.min(total - 1, currentPage + 1);
          }

          await i.update({
            components: buildTutorialComponents({ categoryKey: currentCategory, pageIdx: currentPage, client: interaction.client }),
            flags: MessageFlags.IsComponentsV2
          });
        } catch (err) {
          try { await safeReply(i, { content: `Error: ${err && (err.message || err)}`, ephemeral: true }, { loggerName: 'command:tutorial' }); } catch (_) { /* ignore */ }
        }
      });

      collector.on('end', async () => {
        try {
          if (msg) {
            await msg.edit({
              components: buildTutorialComponents({ categoryKey: currentCategory, pageIdx: currentPage, expired: true, client: interaction.client }),
              flags: MessageFlags.IsComponentsV2
            });
          }
        } catch (_) { /* ignore */ }
      });
    } catch (e) {
      logger.error('Unhandled error in tutorial command', { error: e && (e.stack || e) });
      try { await safeReply(interaction, { content: 'Failed to open tutorial.', ephemeral: true }, { loggerName: 'command:tutorial' }); } catch (_) { /* ignore */ }
    }
  },

  async autocomplete() {
    return;
  }
};
