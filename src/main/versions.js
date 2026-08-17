const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const { tl } = require('./ti18n');
const { currentOs, arch, rulesAllow } = require('../common/utils');

const UA = 'iDK-Launcher/1.0.0';
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const LIBRARY_BASE = 'https://libraries.minecraft.net/';
const ASSET_BASE = 'https://resources.download.minecraft.net/';
const ASSET_BASE_FALLBACK = 'https://resources.download.minecraft.net/';
const CONCURRENCY = 12;
const MANIFEST_TTL = 10 * 60 * 1000;

let manifestCache = { data: null, at: 0 };

function invalidateManifestCache() {
  manifestCache = { data: null, at: 0 };
}

function sha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

async function fetchJson(url, what) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${what} — HTTP ${res.status}`);
  return res.json();
}

async function getManifest() {
  if (manifestCache.data && Date.now() - manifestCache.at < MANIFEST_TTL) return manifestCache.data;
  const m = await fetchJson(MANIFEST_URL, tl('versions.manifestLabel'));
  manifestCache = { data: m, at: Date.now() };
  return m;
}

async function getVersionJson(id, url) {
  const vdir = paths.versionDir(id);
  const local = path.join(vdir, `${id}.json`);
  if (fs.existsSync(local)) {
    try {
      return JSON.parse(fs.readFileSync(local, 'utf8'));
    } catch {}
  }
  const vj = await fetchJson(url, tl('versions.versionLabel', { id }));
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(local, JSON.stringify(vj, null, 2));
  return vj;
}

async function getVersionJsonForId(id) {
  const local = path.join(paths.versionDir(id), `${id}.json`);
  if (fs.existsSync(local)) {
    try {
      return JSON.parse(fs.readFileSync(local, 'utf8'));
    } catch {}
  }
  const manifest = await getManifest();
  const entry = (manifest.versions || []).find((v) => v.id === id);
  if (!entry) throw new Error(tl('versions.notFound', { id }));
  return getVersionJson(id, entry.url);
}

function mergeInherit(parent, child) {
  const out = { ...parent, ...child, id: child.id, inheritsFrom: undefined };
  delete out.inheritsFrom;
  out.libraries = [...(parent.libraries || []), ...(child.libraries || [])];
  const parg = parent.arguments;
  const carg = child.arguments;
  if (parg || carg) {
    out.arguments = {
      game: [...(parg && parg.game ? parg.game : []), ...(carg && carg.game ? carg.game : [])],
      jvm: [...(parg && parg.jvm ? parg.jvm : []), ...(carg && carg.jvm ? carg.jvm : [])],
    };
  }
  out.assetIndex = child.assetIndex || parent.assetIndex;
  out.javaVersion = child.javaVersion || parent.javaVersion;
  out.downloads = child.downloads || parent.downloads;
  out.mainClass = child.mainClass || parent.mainClass;
  out.minecraftArguments = child.minecraftArguments || parent.minecraftArguments;
  out.type = child.type || parent.type || 'custom';
  out.releaseTime = child.releaseTime || parent.releaseTime;
  return out;
}

async function resolveVersion(versionJson) {
  if (!versionJson.inheritsFrom) return versionJson;
  const parent = await getVersionJsonForId(versionJson.inheritsFrom);
  const resolvedParent = await resolveVersion(parent);
  return mergeInherit(resolvedParent, versionJson);
}

async function downloadFile(url, dest, sha, size, onProgress) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    let ok = true;
    if (sha) ok = ok && sha1(dest) === sha;
    else if (size) ok = ok && fs.statSync(dest).size === size;
    if (ok) return 'skipped';
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const tmp = dest + '.part';
  const total = parseInt(res.headers.get('content-length') || '0', 10) || size || 0;
  let received = 0;
  const ws = fs.createWriteStream(tmp);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    ws.write(Buffer.from(value));
    if (onProgress) onProgress(received, total, url);
  }
  await new Promise((resolve, reject) => {
    ws.on('error', reject);
    ws.on('finish', resolve);
    ws.end();
  });
  if (sha && sha1(tmp) !== sha) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw new Error(tl('versions.shaMismatch', { url }));
  }
  fs.renameSync(tmp, dest);
  return 'downloaded';
}

function libArtifactPath(lib) {
  if (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.path) {
    return lib.downloads.artifact.path.split('/');
  }
  const [g, a, v] = lib.name.split(':');
  return [...g.split('.'), a, v, `${a}-${v}.jar`];
}

function libArtifact(lib) {
  if (lib.downloads && lib.downloads.artifact) {
    const a = lib.downloads.artifact;
    return { pathParts: a.path.split('/'), url: a.url || `${LIBRARY_BASE}${a.path}`, sha1: a.sha1, size: a.size };
  }
  if (lib.name) {
    const [g, a, v] = lib.name.split(':');
    const pathParts = [...g.split('.'), a, v, `${a}-${v}.jar`];
    return { pathParts, url: (lib.url || LIBRARY_BASE) + pathParts.join('/'), sha1: null, size: null };
  }
  return null;
}

function modernNativeForOs(classifier) {
  const os = currentOs();
  if (!classifier.startsWith('natives-')) return false;
  if (!classifier.startsWith(`natives-${os}`)) return false;
  const suffix = classifier.slice(`natives-${os}`.length).replace(/^-/, '');
  if (!suffix) return true;
  if (/^(arm64|aarch64)$/i.test(suffix)) return process.arch === 'arm64';
  if (/^(x86|i386|x32)$/i.test(suffix)) return process.arch === 'ia32';
  if (/^(x86_64|amd64|x64)$/i.test(suffix)) return process.arch === 'x64';
  return true;
}

function getNativeSpec(lib) {
  if (!rulesAllow(lib.rules)) return null;
  const nameParts = String(lib.name || '').split(':');
  const classifier = nameParts.length >= 4 ? nameParts[3] : null;
  let dl = null;

  if (lib.natives && lib.natives[currentOs()]) {
    const c = String(lib.natives[currentOs()]).replace('${arch}', arch());
    dl = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[c];
    if (!dl) return null;
    return { classifier: c, pathParts: dl.path.split('/'), url: dl.url || `${LIBRARY_BASE}${dl.path}`, sha1: dl.sha1, size: dl.size };
  }

  if (classifier && classifier.startsWith('natives-') && modernNativeForOs(classifier) && lib.downloads && lib.downloads.artifact) {
    dl = lib.downloads.artifact;
    return { classifier, pathParts: dl.path.split('/'), url: dl.url || `${LIBRARY_BASE}${dl.path}`, sha1: dl.sha1, size: dl.size };
  }

  return null;
}

function isNativeLibrary(lib) {
  return getNativeSpec(lib) !== null;
}

function libraryPath(lib) {
  const parts = libArtifactPath(lib);
  return path.join(paths.libDir(), ...parts);
}

function nativesTargetDir(versionJson) {
  const root = path.join(paths.versionDir(versionJson.id), 'natives');
  let suffix = '';
  const jvm = versionJson.arguments && versionJson.arguments.jvm;
  if (Array.isArray(jvm)) {
    for (const a of jvm) {
      if (typeof a !== 'string') continue;
      const m = String(a).match(/^-Djava\.library\.path=\$\{natives_directory\}(.*)$/);
      if (m) {
        suffix = m[1].replace(/^[/\\]+/, '');
        break;
      }
    }
  }
  return suffix ? path.join(root, suffix) : root;
}

async function extractNatives(jarPath, nativesDir) {
  fs.mkdirSync(nativesDir, { recursive: true });
  const zip = new AdmZip(jarPath);
  const entries = zip.getEntries();
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (entry.isDirectory) continue;
    if (!/\.(dll|so|dylib|jnilib)$/i.test(name)) continue;
    const base = path.basename(name);
    zip.extractEntryTo(entry, nativesDir, false, true);
  }
}

async function runPool(items, worker, concurrency) {
  const queue = [...items];
  let i = 0;
  const run = async () => {
    while (i < queue.length) {
      const idx = i++;
      await worker(queue[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, run));
}

async function installVersion(id, versionJson, onProgress) {
  const vdir = paths.versionDir(id);
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(path.join(vdir, `${id}.json`), JSON.stringify(versionJson, null, 2));

  const tasks = [];
  let done = 0;

  const client = versionJson.downloads && versionJson.downloads.client;
  if (client) {
    tasks.push({
      phase: 'client',
      name: tl('versions.clientLabel'),
      run: () =>
        downloadFile(
          client.url,
          path.join(vdir, `${id}.jar`),
          client.sha1,
          client.size,
          () => {}
        ),
    });
  }

  const libs = [];
  const natives = [];
  for (const lib of versionJson.libraries || []) {
    if (!rulesAllow(lib.rules)) continue;
    const native = getNativeSpec(lib);
    if (isNativeLibrary(lib)) {
      if (native) natives.push(native);
    } else {
      const art = libArtifact(lib);
      if (art) libs.push(art);
    }
  }

  for (const art of libs) {
    tasks.push({
      phase: 'libs',
      name: art.pathParts.join('/'),
      run: () => downloadFile(art.url, path.join(paths.libDir(), ...art.pathParts), art.sha1, art.size, () => {}),
    });
  }

  for (const nat of natives) {
    tasks.push({
      phase: 'natives',
      name: nat.pathParts[nat.pathParts.length - 1],
      run: async () => {
        const jarPath = path.join(paths.libDir(), ...nat.pathParts);
        await downloadFile(nat.url, jarPath, nat.sha1, nat.size, () => {});
        const nativesDir = nativesTargetDir(versionJson);
        fs.mkdirSync(nativesDir, { recursive: true });
        await extractNatives(jarPath, nativesDir);
      },
    });
  }

  let assetIndex = null;
  if (versionJson.assetIndex) {
    const idx = versionJson.assetIndex;
    const idxPath = path.join(paths.assetsIndexDir(), `${idx.id}.json`);
    await downloadFile(idx.url, idxPath, idx.sha1, idx.size, () => {});
    assetIndex = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  }

  const assetMap = new Map();
  if (assetIndex && assetIndex.objects) {
    for (const obj of Object.values(assetIndex.objects)) {
      if (!assetMap.has(obj.hash)) assetMap.set(obj.hash, obj);
    }
  }
  const assetCount = assetMap.size;

  const total = tasks.length + assetCount;

  const report = (name, phase) => {
    done += 1;
    if (onProgress) {
      onProgress({ done, total, phase, name, percent: total ? Math.min(100, Math.round((done / total) * 100)) : 100 });
    }
  };

  await runPool(
    tasks,
    (t) => t.run().then(() => report(t.name, t.phase)),
    6
  );

  if (assetMap.size) {
    const items = [...assetMap.entries()];
    await runPool(
      items,
      async ([hash, obj]) => {
        const dest = path.join(paths.assetsDir(), 'objects', hash.slice(0, 2), hash);
        if (!fs.existsSync(dest)) {
          await downloadFile(`${ASSET_BASE}${hash.slice(0, 2)}/${hash}`, dest, hash, obj.size, () => {});
        }
        report(hash.slice(0, 8), 'assets');
      },
      CONCURRENCY
    );
  }

  if (onProgress) onProgress({ done: total, total, phase: 'done', name: tl('status.done'), percent: 100 });
  return { libs: libs.length, natives: natives.length, assets: assetCount };
}

function isInstalled(id, versionJson) {
  const vdir = paths.versionDir(id);
  const hasJson = fs.existsSync(path.join(vdir, `${id}.json`));
  if (!hasJson) return false;
  if (versionJson && versionJson.inheritsFrom) return true;
  if (!fs.existsSync(path.join(vdir, `${id}.jar`))) return false;
  for (const lib of (versionJson && versionJson.libraries) || []) {
    if (!rulesAllow(lib.rules)) continue;
    if (isNativeLibrary(lib)) continue;
    const art = libArtifact(lib);
    if (!art) continue;
    if (!fs.existsSync(path.join(paths.libDir(), ...art.pathParts))) return false;
  }
  return true;
}

function installedVersions() {
  const list = [];
  try {
    const dirs = fs.readdirSync(paths.gameDir() + '/versions');
    for (const d of dirs) {
      if (d === '..' || d === '.') continue;
      const vdir = path.join(paths.gameDir(), 'versions', d);
      const vj = path.join(vdir, `${d}.json`);
      const jar = path.join(vdir, `${d}.jar`);
      if (!fs.existsSync(vj)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(vj, 'utf8'));
        list.push({
          id: d,
          type: meta.type || 'custom',
          releaseTime: meta.releaseTime || '',
          installed: fs.existsSync(jar) || !!meta.inheritsFrom,
        });
      } catch {}
    }
  } catch {}
  return list;
}

module.exports = { getManifest, invalidateManifestCache, getVersionJson, getVersionJsonForId, resolveVersion, installVersion, isInstalled, installedVersions, currentOs, arch, getNativeSpec, isNativeLibrary, libArtifact, sha1, downloadFile, nativesTargetDir, rulesAllow };
