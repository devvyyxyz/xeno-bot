// Optional alias registration: uses `module-alias` when available.
// This file is safe to require even if `module-alias` is not installed.
try {
  const path = require('path');
  const moduleAlias = require('module-alias');
  const root = path.join(__dirname);
  moduleAlias.addAlias('@utils', path.join(root, 'src', 'utils'));
  moduleAlias.addAlias('@models', path.join(root, 'src', 'models'));
} catch (e) {
  // module-alias not installed - ignore
}
