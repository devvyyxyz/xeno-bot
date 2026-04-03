#!/usr/bin/env node

require('../scripts/check-node-version.js');

const path = require('path');
const { spawn } = require('child_process');

const mode = (process.argv[2] || process.env.BOT_START_MODE || 'shards').toLowerCase();
const entrypoint =
  mode === 'single'
    ? path.join(__dirname, '..', 'src', 'index.js')
    : path.join(__dirname, '..', 'scripts', 'shard.js');

const child = spawn(process.execPath, [entrypoint], {
  stdio: 'inherit',
  env: process.env,
});

let shutdownRequested = false;
let forceShutdownTimer = null;

function requestShutdown(signal) {
  if (shutdownRequested) return;
  shutdownRequested = true;

  if (child.exitCode !== null || child.signalCode !== null) return;

  const shutdownTimeoutMs = Number(process.env.SHUTDOWN_FORCE_TIMEOUT_MS) || 30000;
  forceShutdownTimer = setTimeout(() => {
    try {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    } catch (error) {
      console.error('Failed to force-kill child process:', error);
    }
    process.exit(1);
  }, shutdownTimeoutMs);

  if (typeof forceShutdownTimer.unref === 'function') {
    forceShutdownTimer.unref();
  }

  try {
    child.kill(signal);
  } catch (error) {
    console.error(`Failed to forward ${signal} to child process:`, error);
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGBREAK']) {
  process.on(signal, () => requestShutdown(signal));
}

child.on('error', (error) => {
  console.error('Failed to start bot process:', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (forceShutdownTimer) {
    clearTimeout(forceShutdownTimer);
    forceShutdownTimer = null;
  }

  if (signal) {
    process.exit(0);
    return;
  }

  process.exit(code === null ? 0 : code);
});