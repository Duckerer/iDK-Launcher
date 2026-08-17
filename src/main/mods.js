const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { downloadFile } = require('./versions');
const { tl } = require('./ti18n');

const UA = 'iDK-Launcher/1.0.0';
const MODRINTH_API = 'https://api.modrinth.com/v2';

let gameVersionsCache = null;
let gameVersionsFetch = null;

async function gameVersions() {
  if (gameVersionsCache) return gameVersionsCache;
  if (!gameVersionsFetch) {
    gameVersionsFetch = fetchJson(`${MODRINTH_API}/tag/game_version`)
      .then((list) => {
        gameVersionsCache = (list || []).map((o) => o.version);
        return gameVersionsCache;
      })
      .finally(() => {
        gameVersionsFetch = null;
      });
  }
  return gameVersionsFetch;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

// ---------------- Modrinth ----------------

async function search({ query, projectType, mcVersions, loader, categories, features, impacts, resolutions, environment, limit = 30, offset = 0 }) {
  const facets = [[`project_type:${projectType || 'mod'}`]];
  if (mcVersions && mcVersions.length) facets.push(mcVersions.map((v) => `versions:${v}`));
  if (loader) facets.push([`loaders:${loader}`]);
  const cats = [...(categories || []), ...(features || []), ...(impacts || []), ...(resolutions || [])];
  if (cats.length) facets.push(cats.map((c) => `categories:${c}`));
  if (environment === 'client') facets.push(['client_side:required', 'client_side:optional']);
  if (environment === 'server') facets.push(['server_side:required', 'server_side:optional']);
  const url =
    `${MODRINTH_API}/search?limit=${limit}&offset=${offset}` +
    (query ? `&query=${encodeURIComponent(query)}` : '') +
    `&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  const data = await fetchJson(url);
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

async function modrinthFile(modId, mcVersion, loader) {
  const params = new URLSearchParams();
  if (mcVersion) params.set('game_versions', JSON.stringify([mcVersion]));
  if (loader) params.set('loaders', JSON.stringify([loader]));
  const versions = await fetchJson(`${MODRINTH_API}/project/${encodeURIComponent(modId)}/version?${params}`);
  const v = (versions || [])[0];
  if (!v) return null;
  const file = (v.files || []).find((f) => f.primary) || (v.files || [])[0];
  if (!file) return null;
  return {
    versionNumber: v.version_number,
    filename: file.filename,
    url: file.url,
    size: file.size || 0,
    sha1: file.hashes && file.hashes.sha1,
  };
}

async function versions(modId) {
  const data = await fetchJson(`${MODRINTH_API}/project/${encodeURIComponent(modId)}/version?featured=false`);
  const gv = new Set();
  const ld = new Set();
  for (const v of data || []) {
    for (const g of v.game_versions || []) gv.add(g);
    for (const l of v.loaders || []) ld.add(l);
  }
  const versionSort = (a, b) => {
    const pa = (a.replace(/[^\d.]/g, '') || '0').split('.').map(Number);
    const pb = (b.replace(/[^\d.]/g, '') || '0').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return y - x;
    }
    return 0;
  };
  return {
    gameVersions: [...gv].sort(versionSort),
    loaders: [...ld],
  };
}

// ---------------- public ----------------

async function gameVersionsForPicker() {
  return gameVersions();
}async function install({ id, mcVersion, loader, projectType }) {
  const file = await modrinthFile(id, mcVersion, loader);
  if (!file) throw new Error(tl('mods.noFile'));
  const dir = projectType === 'resourcepack' ? 'resourcepacks' : projectType === 'shader' ? 'shaderpacks' : 'mods';
  const targetDir = path.join(paths.gameDir(), dir);
  fs.mkdirSync(targetDir, { recursive: true });
  const dest = path.join(targetDir, file.filename);
  if (fs.existsSync(dest)) throw new Error(tl('mods.alreadyInstalled', { name: file.filename }));
  await downloadFile(file.url, dest, file.sha1 || null, file.size || null, () => {});
  return { filename: file.filename, version: file.versionNumber, size: file.size };
}

function installedList() {
  const modsDir = path.join(paths.gameDir(), 'mods');
  try {
    return fs.readdirSync(modsDir).filter((f) => f.toLowerCase().endsWith('.jar'));
  } catch {
    return [];
  }
}

module.exports = { search, install, installedList, versions, gameVersionsForPicker };
