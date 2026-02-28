const fs = require('fs');
const path = require('path');
const ARTICLES_DIR = path.join(__dirname, '..', '..', 'config', 'articles');

let cache = { ts: 0, latest: 0, title: null, lastChecked: 0 };
const CACHE_TTL = 30 * 1000; // 30s

function scanLatest() {
  try {
    if (!fs.existsSync(ARTICLES_DIR)) return { latest: 0, title: null };
    const files = fs.readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.md'));
    let latest = 0;
    let latestFile = null;
    for (const f of files) {
      try {
        const st = fs.statSync(path.join(ARTICLES_DIR, f));
        if (st.mtimeMs > latest) { latest = st.mtimeMs; latestFile = f; }
      } catch (e) { /* ignore */ }
    }
    let title = null;
    if (latestFile) {
      try {
        const raw = fs.readFileSync(path.join(ARTICLES_DIR, latestFile), 'utf8');
        // split into parts similar to news loader
        let parts = raw.split(/(?:\r?\n){0,2}-{3,}(?:\r?\n){0,2}/).map(s => s.trim()).filter(Boolean);
        if (parts.length <= 1) {
          const headingParts = raw.split(/(?=^#{1,2}\s)/m).map(s => s.trim()).filter(Boolean);
          if (headingParts.length > 1) {
            if (headingParts[0].match(/^#\s+/) && headingParts.length > 1) headingParts.shift();
            parts = headingParts;
          }
        }
        if (parts.length > 0) {
          const last = parts[parts.length - 1];
          const m = last.split(/\r?\n/).map(l => l.trim()).find(l => l);
          if (m) {
            const mm = m.match(/^#{1,2}\s+(.+)$/);
            title = mm ? mm[1] : m;
          }
        }
      } catch (e) { /* ignore */ }
    }
    return { latest, title };
  } catch (e) {
    return { latest: 0, title: null };
  }
}

  function getLatestArticleContent() {
    try {
      if (!fs.existsSync(ARTICLES_DIR)) return null;
      const files = fs.readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.md'));
      let latest = 0;
      let latestFile = null;
      for (const f of files) {
        try {
          const st = fs.statSync(path.join(ARTICLES_DIR, f));
          if (st.mtimeMs > latest) { latest = st.mtimeMs; latestFile = f; }
        } catch (e) { }
      }
      if (!latestFile) return null;
      const raw = fs.readFileSync(path.join(ARTICLES_DIR, latestFile), 'utf8');
      let parts = raw.split(/(?:\r?\n){0,2}-{3,}(?:\r?\n){0,2}/).map(s => s.trim()).filter(Boolean);
      if (parts.length <= 1) {
        const headingParts = raw.split(/(?=^#{1,2}\s)/m).map(s => s.trim()).filter(Boolean);
        if (headingParts.length > 1) {
          if (headingParts[0].match(/^#\s+/) && headingParts.length > 1) headingParts.shift();
          parts = headingParts;
        }
      }
      if (parts.length === 0) return raw;
      return parts[parts.length - 1];
    } catch (e) {
      return null;
    }
  }

function getLatestArticleInfo() {
  const now = Date.now();
  if (now - cache.lastChecked < CACHE_TTL && cache.ts === cache.latest) {
    return { latest: cache.latest, title: cache.title };
  }
  const res = scanLatest();
  cache.lastChecked = now;
  cache.latest = res.latest || 0;
  cache.title = res.title || null;
  cache.ts = cache.latest;
  return { latest: cache.latest, title: cache.title };
}

module.exports = { getLatestArticleInfo, getLatestArticleContent };
