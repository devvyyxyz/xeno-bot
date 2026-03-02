const {
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  MessageFlags
} = require('discord.js');

function addV2TitleWithBotThumbnail({ container, title, client }) {
  const safeTitle = String(title || 'Title').trim();
  const text = safeTitle.startsWith('##') ? safeTitle : `## ${safeTitle}`;
  const avatarUrl = client && client.user && typeof client.user.displayAvatarURL === 'function'
    ? client.user.displayAvatarURL({ size: 256 })
    : null;

  if (!avatarUrl) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    return;
  }

  try {
    const section = new SectionBuilder();
    if (typeof section.setThumbnailAccessory !== 'function') {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
      return;
    }

    section
      .setThumbnailAccessory((thumbnail) => {
        if (thumbnail && typeof thumbnail.setURL === 'function') thumbnail.setURL(avatarUrl);
        return thumbnail;
      })
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    container.addSectionComponents(section);
  } catch (_) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  }
}

function buildStatsV2Payload({ title, rows = [], footer = null, client = null }) {
  const container = new ContainerBuilder();
  const safeTitle = String(title || 'Stats').trim();
  const safeRows = Array.isArray(rows) ? rows : [];

  addV2TitleWithBotThumbnail({ container, title: safeTitle, client });

  if (safeRows.length > 0) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );
    const body = safeRows
      .map((row) => `**${String(row.label || 'Value')}**: ${String(row.value ?? 'None')}`)
      .join('\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  }

  if (footer) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`_${String(footer)}_`)
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

function classifyNoticeTone(content) {
  const text = String(content || '').trim();
  if (!text) return null;

  if (/\b(permission|admin|owner-only|not allowed)\b/i.test(text) || /^only\b/i.test(text)) return 'permission';
  if (/^you\s+(do not|don't|need|must)\b/i.test(text) || /\bcreate one with\b/i.test(text)) return 'requirement';
  if (/\b(failed|error|invalid|unknown|cannot|can't|not enough|timed out|missing)\b/i.test(text)) return 'error';
  if (/^there was an error\b/i.test(text)) return 'error';

  return null;
}

function buildNoticeV2Payload({
  title = null,
  message,
  tone = 'error',
  footer = null,
  client = null
}) {
  const safeTone = ['error', 'permission', 'requirement', 'info'].includes(tone) ? tone : 'error';
  const toneMeta = {
    error: { icon: '❌', title: 'Error' },
    permission: { icon: '⛔', title: 'Permission Required' },
    requirement: { icon: '⚠️', title: 'Action Required' },
    info: { icon: 'ℹ️', title: 'Notice' }
  }[safeTone];

  const container = new ContainerBuilder();
  const safeTitle = String(title || `${toneMeta.icon} ${toneMeta.title}`).trim();
  const safeMessage = String(message || '').trim() || 'Something went wrong.';

  addV2TitleWithBotThumbnail({ container, title: safeTitle, client });
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeMessage)
  );

  if (footer) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`_${String(footer)}_`)
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

module.exports = {
  buildStatsV2Payload,
  buildNoticeV2Payload,
  classifyNoticeTone,
  addV2TitleWithBotThumbnail
};
