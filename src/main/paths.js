const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const store = require('./store');

function init() {
  const base = path.join(app.getPath('appData'), '.idk-launcher');
  fs.mkdirSync(base, { recursive: true });
  ensureMinecraftDirs();
}

function gameDir() {
  const g = store.get('gameDir', '');
  return g && g.trim() ? g.trim() : path.join(app.getPath('appData'), '.idk-launcher', 'minecraft');
}

function ensureMinecraftDirs() {
  const g = gameDir();
  for (const d of [
    'versions',
    'libraries',
    'assets',
    'assets/indexes',
    'assets/objects',
    'logs',
    'crash-reports',
  ]) {
    fs.mkdirSync(path.join(g, d), { recursive: true });
  }
  return g;
}

function versionDir(id) {
  return path.join(gameDir(), 'versions', id);
}

function libDir() {
  return path.join(gameDir(), 'libraries');
}

function assetsDir() {
  return path.join(gameDir(), 'assets');
}

function assetsIndexDir() {
  return path.join(gameDir(), 'assets', 'indexes');
}

module.exports = { init, gameDir, ensureMinecraftDirs, versionDir, libDir, assetsDir, assetsIndexDir };
