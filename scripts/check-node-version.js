#!/usr/bin/env node

// Guard against unsupported runtime versions.
const major = Number((process.versions && process.versions.node || '').split('.')[0] || 0);
const supportedMin = 16;
const supportedMaxExclusive = 24;

if (!Number.isFinite(major) || major < supportedMin || major >= supportedMaxExclusive) {
  const actual = process.versions && process.versions.node ? process.versions.node : 'unknown';
  console.error(`Unsupported Node.js version: ${actual}`);
  console.error(`This project supports Node.js >=${supportedMin} and <${supportedMaxExclusive}.`);
  console.error('Use Node 22.x or 23.x to run locally.');
  process.exit(1);
}
