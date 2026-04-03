const fs = require('fs');
const path = require('path');
const { parseJSON } = require('../utils/format/jsonParse');

const FILE = path.join(__dirname, '../../data/profiles.json');

function loadAll() {
  if (!fs.existsSync(FILE)) return {};
  const s = fs.readFileSync(FILE, 'utf8');
  return parseJSON(s, {}, 'profiles.json');
}

function saveAll(data) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

const ALLOWED_USER_TYPES = ['tester', 'bot_contributor', 'faction_owner', 'member'];

module.exports = {
  getProfile: async (userId) => {
    const all = loadAll();
    const base = all[String(userId)] || { user_id: String(userId), created_at: new Date().toISOString() };
    // defaults
    return Object.assign({
      user_id: String(userId),
      user_type: 'member',
      faction: null,
      avatar_url: null,
      banner_url: null,
      created_at: base.created_at || new Date().toISOString()
    }, base);
  },

  setProfileField: async (userId, field, value) => {
    const all = loadAll();
    const id = String(userId);
    const profile = all[id] || { user_id: id, created_at: new Date().toISOString() };
    if (field === 'user_type') {
      if (!ALLOWED_USER_TYPES.includes(value)) throw new Error('invalid_user_type');
    } else if (field === 'faction') {
      if (typeof value !== 'string' || value.length > 64) throw new Error('invalid_faction');
    } else if (field === 'avatar_url' || field === 'banner_url') {
      if (typeof value !== 'string' || (!value.startsWith('http') && !value.startsWith('https'))) throw new Error('invalid_url');
    } else {
      throw new Error('invalid_field');
    }
    profile[field] = value;
    profile.updated_at = new Date().toISOString();
    all[id] = profile;
    saveAll(all);
    return profile;
  },

  getAllowedUserTypes: () => ALLOWED_USER_TYPES
};
