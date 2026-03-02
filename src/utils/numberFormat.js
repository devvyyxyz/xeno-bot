/**
 * Formats a number with comma separators
 * @param {number} num - The number to format
 * @returns {string} Formatted number with commas (e.g., "1,205,012")
 */
function formatNumber(num) {
  if (num === null || num === undefined) return '0';
  const n = Number(num);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US');
}

/**
 * Formats a number with K/M/B suffixes for large numbers
 * @param {number} num - The number to format
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted number (e.g., "1.5K", "2.3M", "1.2B")
 */
function formatNumberShort(num, decimals = 1) {
  if (num === null || num === undefined) return '0';
  const n = Number(num);
  if (!Number.isFinite(n)) return '0';
  
  const absNum = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  
  if (absNum >= 1_000_000_000) {
    return sign + (absNum / 1_000_000_000).toFixed(decimals).replace(/\.0+$/, '') + 'B';
  }
  if (absNum >= 1_000_000) {
    return sign + (absNum / 1_000_000).toFixed(decimals).replace(/\.0+$/, '') + 'M';
  }
  if (absNum >= 1_000) {
    return sign + (absNum / 1_000).toFixed(decimals).replace(/\.0+$/, '') + 'K';
  }
  
  return n.toString();
}

/**
 * Formats a number intelligently - uses short format for large numbers, comma format for smaller ones
 * @param {number} num - The number to format
 * @param {number} threshold - Threshold for switching to short format (default: 10000)
 * @returns {string} Formatted number
 */
function formatNumberAuto(num, threshold = 10_000) {
  if (num === null || num === undefined) return '0';
  const n = Number(num);
  if (!Number.isFinite(n)) return '0';
  
  if (Math.abs(n) >= threshold) {
    return formatNumberShort(n);
  }
  
  return formatNumber(n);
}

module.exports = {
  formatNumber,
  formatNumberShort,
  formatNumberAuto
};
