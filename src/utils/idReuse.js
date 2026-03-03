/**
 * Utility for finding and reusing deleted IDs in database tables
 */
const db = require('../db');

/**
 * Find the lowest available unused ID in a table
 * @param {string} tableName - Name of the table
 * @param {string} idColumn - Name of the ID column (default: 'id')
 * @returns {Promise<number>} The next available ID
 */
async function findNextAvailableId(tableName, idColumn = 'id') {
  try {
    // Get all existing IDs, ordered
    const rows = await db.knex(tableName)
      .select(idColumn)
      .orderBy(idColumn, 'asc');
    
    if (!rows || rows.length === 0) {
      return 1; // No records, start at 1
    }
    
    // Convert to array of IDs
    const existingIds = rows.map(row => Number(row[idColumn]));
    
    // Find the first gap in the sequence
    for (let i = 1; i <= existingIds.length + 1; i++) {
      if (!existingIds.includes(i)) {
        return i;
      }
    }
    
    // If no gaps, return next sequential ID
    return Math.max(...existingIds) + 1;
  } catch (error) {
    console.error(`Failed to find next available ID for ${tableName}:`, error);
    throw error;
  }
}

/**
 * Insert a record with a manually assigned ID (reusing deleted IDs)
 * @param {string} tableName - Name of the table
 * @param {Object} payload - Data to insert
 * @param {string} idColumn - Name of the ID column (default: 'id')
 * @returns {Promise<number>} The ID of the inserted record
 */
async function insertWithReusedId(tableName, payload, idColumn = 'id') {
  try {
    const nextId = await findNextAvailableId(tableName, idColumn);
    const payloadWithId = { ...payload, [idColumn]: nextId };
    
    await db.knex(tableName).insert(payloadWithId);
    return nextId;
  } catch (error) {
    console.error(`Failed to insert with reused ID for ${tableName}:`, error);
    throw error;
  }
}

module.exports = {
  findNextAvailableId,
  insertWithReusedId
};
