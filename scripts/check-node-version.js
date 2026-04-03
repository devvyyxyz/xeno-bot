#!/usr/bin/env node

// Guard against known runtime incompatibilities (winston/winston-transport on Node 23+).
const major = Number((process.versions && process.versions.node || '').split('.')[0] || 0);
const supportedMin = 16;
const supportedMaxExclusive = 23;

if (!Number.isFinite(major) || major < supportedMin || major >= supportedMaxExclusive) {
  const actual = process.versions && process.versions.node ? process.versions.node : 'unknown';
  console.error(`Unsupported Node.js version: ${actual}`);
  console.error(`This project supports Node.js >=${supportedMin} and <${supportedMaxExclusive}.`);
  console.error('Use Node 22.x LTS to run locally.');
  process.exit(1);
}
