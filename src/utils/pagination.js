const { ActionRowBuilder, SecondaryButtonBuilder } = require('@discordjs/builders');

function getPaginationState({ items = [], pageIdx = 0, pageSize = 10 }) {
  const safeItems = Array.isArray(items) ? items : [];
  const safePageSize = Math.max(1, Number(pageSize) || 10);
  const totalItems = safeItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePageIdx = Math.max(0, Math.min(Number(pageIdx) || 0, totalPages - 1));
  const start = safePageIdx * safePageSize;
  const end = start + safePageSize;
  const pageItems = safeItems.slice(start, end);

  return {
    totalItems,
    totalPages,
    safePageIdx,
    start,
    end,
    pageItems,
    hasPrev: safePageIdx > 0,
    hasNext: safePageIdx < totalPages - 1
  };
}

function buildPaginationRow({
  prefix,
  pageIdx = 0,
  totalPages = 1,
  totalItems = 0,
  prevLabel = 'Prev',
  nextLabel = 'Next',
  totalLabel = 'Total',
  showPageInfo = true
}) {
  const row = new ActionRowBuilder();
  const safeTotalPages = Math.max(1, Number(totalPages) || 1);
  const safePageIdx = Math.max(0, Math.min(Number(pageIdx) || 0, safeTotalPages - 1));

  if (safePageIdx > 0) {
    row.addComponents(
      new SecondaryButtonBuilder().setCustomId(`${prefix}-prev-page`).setLabel(prevLabel)
    );
  }

  const pageInfo = showPageInfo && safeTotalPages > 1 ? ` (${safePageIdx + 1}/${safeTotalPages})` : '';
  row.addComponents(
    new SecondaryButtonBuilder()
      .setCustomId(`${prefix}-page-info`)
      .setLabel(`${totalLabel}: ${totalItems}${pageInfo}`)
      .setDisabled(true)
  );

  if (safePageIdx < safeTotalPages - 1) {
    row.addComponents(
      new SecondaryButtonBuilder().setCustomId(`${prefix}-next-page`).setLabel(nextLabel)
    );
  }

  return row;
}

module.exports = {
  getPaginationState,
  buildPaginationRow
};
