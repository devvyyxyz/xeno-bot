const { getCommandsObject } = require('../../utils/commandsConfig');
const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize
} = require('discord.js');
const {
  ActionRowBuilder,
  SecondaryButtonBuilder,
  PrimaryButtonBuilder,
  DangerButtonBuilder
} = require('@discordjs/builders');
const { addV2TitleWithBotThumbnail } = require('../../utils/componentsV2');
const safeReply = require('../../utils/safeReply');

function resolveOwnerId() {
  try {
    if (process.env.BOT_CONFIG_PATH) {
      try { const bc = require(process.env.BOT_CONFIG_PATH); if (bc && bc.owner) return String(bc.owner); } catch (e) {}
    }
  } catch (e) {}
  return process.env.OWNER || process.env.BOT_OWNER || process.env.OWNER_ID || null;
}

// === ACTION HANDLERS ===

/**
 * Migrate legacy facehugger data to xenomorph format
 */
async function migrateFacehuggers(client) {
  const db = require('../../db');
  const logger = require('../../utils/logger').get('migration');

  logger.info('Starting facehugger→xenomorph migration');

  function parseData(jsonStr) {
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      return null;
    }
  }

  const knex = db.knex;
  const users = await knex('users').select('id', 'discord_id', 'data');

  let migrated = 0;
  let skipped = 0;

  for (const row of users) {
    const data = parseData(row.data);
    if (!data || !data.facehuggers) {
      skipped++;
      continue;
    }

    const fhCount = data.facehuggers || 0;
    if (fhCount === 0) {
      skipped++;
      continue;
    }

    // Migrate facehuggers to xenomorphs
    if (!data.xenomorphs) data.xenomorphs = 0;
    data.xenomorphs += fhCount;
    delete data.facehuggers;

    await knex('users').where({ id: row.id }).update({ data: JSON.stringify(data) });
    migrated++;
    logger.info(`Migrated user ${row.discord_id}: ${fhCount} facehugger(s) → xenomorph(s)`);
  }

  const result = `✅ **Migration complete**\n• Migrated: **${migrated}** users\n• Skipped: **${skipped}** users`;
  logger.info('Migration finished', { migrated, skipped });
  return result;
}

/**
 * Restart hatch manager (reload all pending hatch timers)
 */
async function restartHatchManager(client) {
  const hatchManager = require('../../hatchManager');
  const logger = require('../../utils/logger').get('hatch');

  logger.info('Restarting hatch manager via devmenu');
  await hatchManager.init(client);

  return `✅ **Hatch manager restarted**\nAll pending hatch timers have been restored and scheduled.`;
}

/**
 * Restart spawn manager (reload spawn schedules for all guilds)
 */
async function restartSpawnManager(client) {
  const spawnManager = require('../../spawnManager');
  const logger = require('../../utils/logger').get('spawn');

  logger.info('Restarting spawn manager via devmenu');
  await spawnManager.init(client);

  return `✅ **Spawn manager restarted**\nAll guild spawn schedules have been recalculated and restored.`;
}

/**
 * Clear expired spawn eggs from active tracking
 */
async function clearExpiredSpawns(client) {
  const spawnManager = require('../../spawnManager');
  const logger = require('../../utils/logger').get('spawn');

  logger.info('Clearing expired spawns via devmenu');

  // Access internal activeEggs map if available
  const activeEggs = spawnManager.activeEggs || new Map();
  const now = Date.now();
  let cleared = 0;

  for (const [channelId, eggData] of activeEggs.entries()) {
    const spawnedAt = eggData.spawnedAt || 0;
    const elapsed = now - spawnedAt;
    const timeout = 180000; // 3 minutes default
    if (elapsed > timeout) {
      activeEggs.delete(channelId);
      cleared++;
    }
  }

  logger.info(`Cleared ${cleared} expired spawn(s)`);
  return `✅ **Cleared expired spawns**\n• Removed: **${cleared}** expired egg(s)`;
}

/**
 * Sync guild cache from database
 */
async function syncGuildCache() {
  const cache = require('../../utils/cache');
  const logger = require('../../utils/logger').get('cache');

  logger.info('Syncing guild cache via devmenu');

  if (cache.warmGuildCache) {
    await cache.warmGuildCache();
    return `✅ **Guild cache synchronized**\nGuild settings have been refreshed from the database.`;
  } else {
    return `⚠️ **Cache sync unavailable**\nNo warmGuildCache function found in cache module.`;
  }
}

/**
 * Force database migration (re-run migrate)
 */
async function forceMigration() {
  const db = require('../../db');
  const logger = require('../../utils/logger').get('migration');

  logger.info('Force running database migration via devmenu');
  await db.migrate();

  return `✅ **Database migration complete**\nAll migrations have been applied successfully.`;
}

module.exports = {
  name: 'devmenu',
  description: 'Developer-only: interactive menu for admin tools and diagnostics (owner only)',
  developerOnly: true,
  // Message-mode handler only
  async executeMessage(message, args) {
    const ownerId = resolveOwnerId();
    if (!ownerId || String(message.author.id) !== String(ownerId)) {
      try { await message.reply({ content: 'This command is owner-only.', allowedMentions: { repliedUser: false } }); } catch (e) {}
      return;
    }

    const container = new ContainerBuilder();
    addV2TitleWithBotThumbnail({ container, title: '🛠️ Developer Menu', client: message.client });

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Interactive Administration Tools**\nSelect an action below to manage server data, debug issues, or run migrations.')
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    // Action buttons
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new PrimaryButtonBuilder()
          .setCustomId('devmenu-migrate-facehuggers')
          .setLabel('Migrate Legacy Facehuggers'),
        new SecondaryButtonBuilder()
          .setCustomId('devmenu-restart-hatch')
          .setLabel('Restart Hatch Timers'),
        new SecondaryButtonBuilder()
          .setCustomId('devmenu-restart-spawn')
          .setLabel('Restart Spawn Timers')
      )
    );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new SecondaryButtonBuilder()
          .setCustomId('devmenu-clear-spawns')
          .setLabel('Clear Expired Spawns'),
        new SecondaryButtonBuilder()
          .setCustomId('devmenu-sync-cache')
          .setLabel('Sync Guild Cache'),
        new DangerButtonBuilder()
          .setCustomId('devmenu-force-migrate')
          .setLabel('Force DB Migration')
      )
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('_Menu expires after 5 minutes of inactivity_')
    );

    let sentMessage;
    try {
      sentMessage = await message.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { repliedUser: false }
      });
    } catch (e) {
      try { await message.reply({ content: 'Failed to display developer menu.', allowedMentions: { repliedUser: false } }); } catch (ignored) {}
      return;
    }

    const logger = require('../../utils/logger').get('devmenu');

    // Button interaction collector (created directly from message)
    const collector = sentMessage.createMessageComponentCollector({
      filter: (i) => {
        // Only allow the owner to click buttons
        if (String(i.user.id) !== String(ownerId)) {
          try {
            i.reply({ content: 'Only the bot owner can use this menu.', ephemeral: true }).catch(() => {});
          } catch (e) {}
          return false;
        }
        return i.customId.startsWith('devmenu-');
      },
      idle: 300000 // 5 minutes
    });

    collector.on('collect', async (i) => {
        const action = i.customId.replace('devmenu-', '');

        try {
          await i.deferUpdate();

          let resultMessage = '';
          let error = false;

          switch (action) {
            case 'migrate-facehuggers':
              try {
                resultMessage = await migrateFacehuggers(message.client);
              } catch (e) {
                resultMessage = `❌ Migration failed: ${e.message}`;
                error = true;
                logger.error('Facehugger migration failed', { error: e.stack || e });
              }
              break;

            case 'restart-hatch':
              try {
                resultMessage = await restartHatchManager(message.client);
              } catch (e) {
                resultMessage = `❌ Hatch restart failed: ${e.message}`;
                error = true;
                logger.error('Hatch manager restart failed', { error: e.stack || e });
              }
              break;

            case 'restart-spawn':
              try {
                resultMessage = await restartSpawnManager(message.client);
              } catch (e) {
                resultMessage = `❌ Spawn restart failed: ${e.message}`;
                error = true;
                logger.error('Spawn manager restart failed', { error: e.stack || e });
              }
              break;

            case 'clear-spawns':
              try {
                resultMessage = await clearExpiredSpawns(message.client);
              } catch (e) {
                resultMessage = `❌ Clear spawns failed: ${e.message}`;
                error = true;
                logger.error('Clear spawns failed', { error: e.stack || e });
              }
              break;

            case 'sync-cache':
              try {
                resultMessage = await syncGuildCache();
              } catch (e) {
                resultMessage = `❌ Cache sync failed: ${e.message}`;
                error = true;
                logger.error('Guild cache sync failed', { error: e.stack || e });
              }
              break;

            case 'force-migrate':
              try {
                resultMessage = await forceMigration();
              } catch (e) {
                resultMessage = `❌ Migration failed: ${e.message}`;
                error = true;
                logger.error('Force migration failed', { error: e.stack || e });
              }
              break;

            default:
              resultMessage = '❓ Unknown action';
              error = true;
          }

          // Send result as follow-up
          try {
            await i.followUp({
              content: resultMessage,
              ephemeral: false
            });
          } catch (e) {
            logger.error('Failed to send follow-up', { error: e.stack || e });
          }

        } catch (e) {
          logger.error('Error processing devmenu action', { action, error: e.stack || e });
          try {
            await i.followUp({
              content: `❌ Error processing action: ${e.message}`,
              ephemeral: false
            });
          } catch (ignored) {}
        }
    });

    collector.on('end', async (collected, reason) => {
        try {
          const expiredContainer = new ContainerBuilder();
          addV2TitleWithBotThumbnail({ container: expiredContainer, title: '🛠️ Developer Menu', client: message.client });
          expiredContainer.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('**Interactive Administration Tools**\nSelect an action below to manage server data, debug issues, or run migrations.')
          );
          expiredContainer.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
          );
          expiredContainer.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('_Menu expired — run `xen!devmenu` again to reopen_')
          );

          await sentMessage.edit({
            components: [expiredContainer],
            flags: MessageFlags.IsComponentsV2
          });
        } catch (e) {
          logger.error('Failed to update expired menu', { error: e.stack || e });
        }
    });
  }
};
