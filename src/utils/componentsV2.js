const {
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  MessageFlags
} = require('discord.js');

function buildStatsV2Payload({ title, rows = [], footer = null }) {
  const container = new ContainerBuilder();
  const safeTitle = String(title || 'Stats').trim();
  const safeRows = Array.isArray(rows) ? rows : [];

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${safeTitle}`)
  );

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
  footer = null
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

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${safeTitle}`)
  );
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
  classifyNoticeTone
};
