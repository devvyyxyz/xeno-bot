const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

// Encode a compact customId with expiry: "base::expiryBase36"
function encodeCustomId(baseId, ttlMs = DEFAULT_TTL) {
  const expiry = Date.now() + ttlMs;
  return `${baseId}::${expiry.toString(36)}`;
}

// Parse an encoded customId. Returns null for legacy ids.
function parseCustomId(customId) {
  if (typeof customId !== 'string') return null;
  const parts = customId.split('::');
  if (parts.length !== 2) return null;
  const [baseId, expiry36] = parts;
  const expiry = Number.parseInt(expiry36, 36);
  if (Number.isNaN(expiry)) return null;
  return { baseId, expiry };
}

function isExpired(customId) {
  const parsed = parseCustomId(customId);
  if (!parsed) return false; // legacy ids never expire here
  return Date.now() > parsed.expiry;
}

// Disable components on a Message-like payload by editing with disabled=true
async function disableMessageComponents(message) {
  if (!message) return;
  try {
    // message.components are ActionRow-like objects
    const comps = (message.components || []).map(row => {
      const newRow = Object.assign({}, row);
      if (Array.isArray(newRow.components)) {
        newRow.components = newRow.components.map(c => Object.assign({}, c, { disabled: true }));
      }
      return newRow;
    });
    // Try edit; some messages may not support edit (ignore failures)
    await message.edit?.({ components: comps }).catch(() => {});
  } catch (_) { /* ignore */ }
}

module.exports = { encodeCustomId, parseCustomId, isExpired, disableMessageComponents };
