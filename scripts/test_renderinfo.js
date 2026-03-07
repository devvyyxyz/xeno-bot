const mod = require('../src/commands/evolve/index.js');
const evol = require('../config/evolutions.json');
const x = { id: 123, role: 'drone', stage: 'drone', pathway: 'pathogen' };
console.log(mod.renderInfoText(x, evol));
