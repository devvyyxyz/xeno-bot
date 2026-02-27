/**
 * Shared autocomplete helper.
 *
 * Usage:
 * const autocomplete = require('../utils/autocomplete');
 * // inside command.autocomplete(interaction):
 * return autocomplete(interaction, items, { map: item => ({ name: item.name, value: item.id }) });
 *
 * items: array of arbitrary objects
 * opts.map: function(item) -> { name, value }
 * opts.filterFields: array of fields to match against focused input (optional)
 * opts.max: max results (default 25)
 */
module.exports = async function autocomplete(interaction, items = [], opts = {}) {
  const focused = String(interaction.options.getFocused?.() || '');
  const mapFn = typeof opts.map === 'function' ? opts.map : (it) => ({ name: String(it.name || it.id || it.label || it.value || it), value: String(it.id || it.value || it) });
  const filterFields = Array.isArray(opts.filterFields) ? opts.filterFields : null;
  const max = Number(opts.max || 25);

  try {
    let choices = items.map(mapFn).filter(Boolean).map(c => ({ name: String(c.name).slice(0, 100), value: String(c.value).slice(0, 100) }));
    if (focused) {
      const q = focused.toLowerCase();
      choices = choices.filter(c => {
        if ((c.name || '').toLowerCase().includes(q)) return true;
        if ((c.value || '').toLowerCase().includes(q)) return true;
        // optional field matching
        if (filterFields && filterFields.length > 0) {
          for (const f of filterFields) {
            const v = String(c[f] || '').toLowerCase();
            if (v.includes(q)) return true;
          }
        }
        return false;
      });
    }
    choices = choices.slice(0, max);
    // Discord expects array of { name, value }
    await interaction.respond(choices);
  } catch (e) {
    try { await interaction.respond([]); } catch (e2) {}
  }
};
