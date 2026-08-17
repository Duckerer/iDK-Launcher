const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const { app } = require('electron');
const paths = require('./paths');
const versions = require('./versions');
const modloaders = require('./modloaders');
const { tl } = require('./ti18n');

const UA = 'iDK-Launcher/1.0.0';
const API = 'https://api.modrinth.com/v2';

const LOADER_DEP_MAP = {
  'fabric-loader': 'fabric',
  'quilt-loader': 'quilt',
  forge: 'forge',
  neoforge: 'neoforge',
};

let migrated = false;
function migrateLegacy() {
  if (migrated) return;
  migrated = true;
  try {
    const legacy = path.join(app.getPath('appData'), '.idk-launcher', 'modpacks');
    const target = path.join(paths.gameDir(), 'modpacks');
    if (legacy === target || !fs.existsSync(legacy)) return;
    fs.mkdirSync(target, { recursive: true });
    for (const e of fs.readdirSync(legacy)) {
      const src = path.join(legacy, e);
      const dst = path.join(target, e);
      if (!fs.statSync(src).isDirectory()) continue;
      if (fs.existsSync(dst)) continue;
      try {
        fs.renameSync(src, dst);
      } catch {}
    }
  } catch {}
}

function rootDir() {
  migrateLegacy();
  const d = path.join(paths.gameDir(), 'modpacks');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'pack';
}

async function fetchJson(url, what) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${what} — HTTP ${res.status}`);
  return res.json();
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function safeJoin(base, rel) {
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error(tl('modpacks.badPath', { path: rel }));
  return abs;
}

async function safeExtract(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const root = fs.realpathSync(dest);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = String(entry.entryName || '').replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
      throw new Error(tl('modpacks.badPath', { path: name }));
    }
    const abs = path.resolve(root, name);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error(tl('modpacks.badPath', { path: name }));
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await new Promise((resolve, reject) => {
      entry.getData((err, data) => {
        if (err) return reject(err);
        try {
          fs.writeFileSync(abs, data);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  }
}

async function ensureBase(mc, loader, loaderVersion, onProgress) {
  const vj = await versions.getVersionJsonForId(mc);
  const resolved = await versions.resolveVersion(vj);
  if (!versions.isInstalled(mc, resolved)) {
    if (onProgress) onProgress({ done: 0, total: 1, percent: 0, phase: 'client', name: tl('modpacks.installingMc', { mc }) });
    await versions.installVersion(mc, resolved, onProgress);
  }
  if (loader && loaderVersion) {
    if (onProgress) onProgress({ done: 0, total: 1, percent: 0, phase: 'loader', name: tl('modpacks.installingLoader', { loader, version: loaderVersion }) });
    const r = await modloaders.installModloader({ loader, mcVersion: mc, loaderVersion }, onProgress);
    return r.id;
  }
  return mc;
}

async function search({ query, mcVersions, loader, categories, environment, limit = 30, offset = 0 }) {
  const facets = [['project_type:modpack']];
  if (mcVersions && mcVersions.length) facets.push(mcVersions.map((v) => `versions:${v}`));
  if (loader) facets.push([`loaders:${loader}`]);
  if (categories && categories.length) facets.push(categories.map((c) => `categories:${c}`));
  if (environment === 'client') facets.push(['client_side:required', 'client_side:optional']);
  if (environment === 'server') facets.push(['server_side:required', 'server_side:optional']);
  const url =
    `${API}/search?limit=${limit}&offset=${offset}` +
    (query ? `&query=${encodeURIComponent(query)}` : '') +
    `&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  const data = await fetchJson(url, tl('modpacks.searchLabel'));
  return {
    list: (data.hits || []).map((h) => ({
      source: 'modrinth',
      id: h.project_id,
      slug: h.slug,
      name: h.title,
      description: h.description || '',
      icon: h.icon_url || '',
      downloads: h.downloads || 0,
      author: h.author || '',
    })),
    total: data.total_hits || 0,
  };
}

async function versionsForPicker(id) {
  const list = await fetchJson(`${API}/project/${id}/version`, tl('modpacks.versionsLabel'));
  return (list || []).map((v) => ({
    id: v.id,
    name: v.name || v.version_number || v.id,
    versionNumber: v.version_number || '',
    gameVersions: v.game_versions || [],
    loaders: v.loaders || [],
    fileSize: (v.files || []).reduce((s, f) => s + (f.size || 0), 0),
  }));
}

async function install({ id, versionId }, onProgress) {
  const project = await fetchJson(`${API}/project/${id}`, tl('modpacks.projectLabel'));
  const version = await fetchJson(`${API}/project/${id}/version/${versionId}`, tl('modpacks.versionLabel'));
  const mr = version.files && version.files.find((f) => f.filename.endsWith('.mrpack'));
  if (!mr) throw new Error(tl('modpacks.noMrpack'));

  const tmpZip = path.join(os.tmpdir(), `idk-mrpack-${Date.now()}.mrpack`);
  const tmpDir = path.join(os.tmpdir(), `idk-mrpack-${Date.now()}`);
  try {
    if (onProgress) onProgress({ done: 0, total: 1, percent: 0, phase: 'pack', name: tl('modpacks.downloadingPack') });
    await versions.downloadFile(mr.url, tmpZip, (mr.hashes && mr.hashes.sha1) || null, mr.size || null, () => {});
    const zip = new AdmZip(tmpZip);
    await safeExtract(zip, tmpDir);
    const indexPath = path.join(tmpDir, 'modrinth.index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const deps = index.dependencies || {};
    const mc = deps.minecraft;
    if (!mc) throw new Error(tl('modpacks.noMc'));

    const depKey = Object.keys(LOADER_DEP_MAP).find((k) => deps[k]);
    const loader = depKey ? LOADER_DEP_MAP[depKey] : '';
    const loaderVersion = depKey ? deps[depKey] : '';
    const launchId = await ensureBase(mc, loader, loaderVersion, onProgress);

    const packDir = safeJoin(rootDir(), project.slug);
    fs.rmSync(packDir, { recursive: true, force: true });
    fs.mkdirSync(packDir, { recursive: true });

    for (const sub of ['overrides', 'client-overrides']) {
      const s = path.join(tmpDir, sub);
      if (fs.existsSync(s)) copyDir(s, packDir);
    }

    let fileCount = 0;
    let totalSize = 0;
    for (const f of index.files || []) {
      if (f.env && f.env.client === 'unsupported') continue;
      const entry = (f.downloads || [])[0];
      const url = typeof entry === 'string' ? entry : entry && entry.url;
      if (!url) continue;
      const dest = safeJoin(packDir, f.path);
      await versions.downloadFile(url, dest, (f.hashes && f.hashes.sha1) || null, f.fileSize || null, () => {});
      fileCount += 1;
      totalSize += f.fileSize || 0;
    }

    const instance = {
      slug: project.slug,
      name: project.title || project.slug,
      iconUrl: project.icon_url || '',
      description: project.description || '',
      mc,
      loader,
      loaderVersion,
      launchId,
      versionId,
      versionName: version.name || version.version_number || '',
      fileCount,
      totalSize,
      installedAt: Date.now(),
      custom: false,
    };
    fs.writeFileSync(path.join(packDir, 'instance.json'), JSON.stringify(instance, null, 2));
    return instance;
  } finally {
    try {
      fs.unlinkSync(tmpZip);
    } catch {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

async function create({ name, mcVersion, loader, loaderVersion }, onProgress) {
  if (!mcVersion) throw new Error(tl('ml.selectMc'));
  const launchId = await ensureBase(mcVersion, loader, loaderVersion, onProgress);
  const slug = `${slugify(name)}-${Date.now().toString(36)}`;
  const packDir = path.join(rootDir(), slug);
  fs.mkdirSync(packDir, { recursive: true });
  const instance = {
    slug,
    name: name || slug,
    iconUrl: '',
    description: '',
    mc: mcVersion,
    loader: loader || '',
    loaderVersion: loaderVersion || '',
    launchId,
    versionId: '',
    versionName: '',
    fileCount: 0,
    totalSize: 0,
    installedAt: Date.now(),
    custom: true,
  };
  fs.writeFileSync(path.join(packDir, 'instance.json'), JSON.stringify(instance, null, 2));
  return instance;
}

function get(slug) {
  const p = path.join(safeJoin(rootDir(), slug), 'instance.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function list() {
  const out = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(rootDir());
  } catch {}
  for (const d of dirs) {
    const p = path.join(rootDir(), d, 'instance.json');
    if (!fs.existsSync(p)) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(p, 'utf8')));
    } catch {}
  }
  return out.sort((a, b) => (b.installedAt || 0) - (a.installedAt || 0));
}

function remove(slug) {
  const p = safeJoin(rootDir(), slug);
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p, { recursive: true, force: true });
  return true;
}

module.exports = { rootDir, search, versionsForPicker, install, create, get, list, remove };
