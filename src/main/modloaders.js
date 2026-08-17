const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const paths = require('./paths');
const versions = require('./versions');
const javaMod = require('./java');
const { tl } = require('./ti18n');

const UA = 'iDK-Launcher/1.0.0';

async function fetchJson(url, what) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${what} — HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url, what) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${what} — HTTP ${res.status}`);
  return res.text();
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const ws = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    ws.write(Buffer.from(value));
  }
  await new Promise((resolve, reject) => {
    ws.on('error', reject);
    ws.on('finish', resolve);
    ws.end();
  });
}

function mavenVersions(xml) {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]).reverse();
}

// ---------------- Fabric ----------------

async function fabricVersions(mcVersion) {
  const loaders = await fetchJson(
    `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`,
    tl('ml.list.fabric')
  );
  return loaders.map((l) => ({ version: l.loader.version, stable: !!l.loader.stable }));
}

async function fabricProfile(mcVersion, loaderVersion) {
  return fetchJson(
    `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`,
    tl('ml.profile.fabric')
  );
}

// ---------------- Quilt ----------------

async function quiltVersions(mcVersion) {
  const loaders = await fetchJson(
    `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mcVersion)}`,
    tl('ml.list.quilt')
  );
  return loaders.map((l) => ({ version: l.loader.version, stable: !!l.loader.stable }));
}

async function quiltProfile(mcVersion, loaderVersion) {
  return fetchJson(
    `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`,
    tl('ml.profile.quilt')
  );
}

// ---------------- Legacy Fabric ----------------

async function legacyFabricVersions(mcVersion) {
  const loaders = await fetchJson(
    `https://meta.legacyfabric.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`,
    tl('ml.list.legacyFabric')
  );
  return loaders.map((l) => ({ version: l.loader.version, stable: !!l.loader.stable }));
}

async function legacyFabricProfile(mcVersion, loaderVersion) {
  return fetchJson(
    `https://meta.legacyfabric.net/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`,
    tl('ml.profile.legacyFabric')
  );
}

// ---------------- Forge ----------------

async function forgeVersions(mcVersion) {
  const xml = await fetchText('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml', tl('ml.list.forge'));
  const prefix = mcVersion + '-';
  return mavenVersions(xml)
    .filter((v) => v.startsWith(prefix))
    .map((v) => ({ version: v.slice(prefix.length), full: v }));
}

// ---------------- NeoForge ----------------

function mcToNeoforgePrefix(mcVersion) {
  const m = /^1\.(\d+)\.(\d+)$/.exec(mcVersion);
  if (!m) return null;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  if (major === 20 && minor === 1) return '47.1.';
  return `${major}.${minor}.`;
}

async function neoforgeVersions(mcVersion) {
  const prefix = mcToNeoforgePrefix(mcVersion);
  if (!prefix) return [];
  const xml = await fetchText('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', tl('ml.list.neoforge'));
  return mavenVersions(xml)
    .filter((v) => v.startsWith(prefix))
    .map((v) => ({ version: v, full: v }));
}

// ---------------- installer (Forge / NeoForge) ----------------

function installerJavaMajor(mcVersion) {
  const m = /^1\.(\d+)\.?(\d*)$/.exec(mcVersion);
  if (!m) return 8;
  const major = parseInt(m[1], 10);
  if (major >= 21) return 21;
  if (major >= 20) return 17;
  if (major >= 17) return 16;
  return 8;
}

async function runInstaller(loader, mcVersion, loaderVersion, onProgress) {
  const full = loader === 'forge' ? `${mcVersion}-${loaderVersion}` : loaderVersion;
  const versionsRoot = path.join(paths.gameDir(), 'versions');
  const expectedId =
    loader === 'forge' ? `${mcVersion}-forge-${loaderVersion}` : `${mcVersion}-neoforge-${loaderVersion}`;
  if (fs.existsSync(path.join(versionsRoot, expectedId, `${expectedId}.json`))) return expectedId;

  const cacheDir = path.join(paths.gameDir(), 'modloader-installers');
  fs.mkdirSync(cacheDir, { recursive: true });
  const jar = path.join(cacheDir, `${loader}-${full}-installer.jar`);
  if (!fs.existsSync(jar)) {
    const url =
      loader === 'forge'
        ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`
        : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${full}/neoforge-${full}-installer.jar`;
    if (onProgress) onProgress({ done: 0, total: 1, percent: 0, phase: 'loader', name: tl('ml.downloadingInstaller') });
    await download(url, jar);
  }

  const required = installerJavaMajor(mcVersion);
  const { java } = javaMod.resolveJava(required);
  if (!java) throw new Error(tl('ml.javaRequired', { required, loader }));

  const installDir = paths.gameDir();

  const lpj = path.join(installDir, 'launcher_profiles.json');
  if (!fs.existsSync(lpj)) fs.writeFileSync(lpj, '{"profiles":{}}', 'utf8');

  if (onProgress) onProgress({ done: 0, total: 1, percent: 0, phase: 'loader', name: tl('ml.runningInstaller', { loader }) });

  const before = new Set(fs.existsSync(versionsRoot) ? fs.readdirSync(versionsRoot) : []);

  const heartbeat = () => {
    if (onProgress) onProgress({ done: 0, total: 1, percent: 0, phase: 'loader', name: tl('ml.installerWorking', { loader }) });
  };

  const runCmd = (args, noHeartbeat) =>
    new Promise((resolve) => {
      const proc = spawn(java.bin, args, { cwd: installDir, windowsHide: true });
      let out = '';
      let err = '';
      let finished = false;
      const timer = noHeartbeat ? null : setInterval(heartbeat, 2000);
      const finish = (code) => {
        if (finished) return;
        finished = true;
        if (timer) clearInterval(timer);
        resolve({ code, out, err });
      };
      proc.stdout && proc.stdout.on('data', (d) => { out = (out + d).slice(-200000); });
      proc.stderr && proc.stderr.on('data', (d) => { err = (err + d).slice(-200000); });
      proc.on('error', (e) => { err += '\n[spawn] ' + e.message; finish(1); });
      proc.on('exit', (code) => finish(code ?? 1));
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
        finish('timeout');
      }, 900000);
    });

  const help = await runCmd(['-jar', jar, '--help'], true);
  const helpText = (help.out || '') + (help.err || '');
  const useInstallDirArg = /--installDir/i.test(helpText);
  const baseArgs = ['-jar', jar, '--installClient'];
  const installArgs = useInstallDirArg ? [...baseArgs, '--installDir', installDir] : [...baseArgs, installDir];

  let r = await runCmd(installArgs);
  if (r.code === 'timeout') throw new Error(tl('ml.installerTimeout', { loader }));
  if (r.code !== 0) r = await runCmd(['-jar', jar, '--installClient']);
  if (r.code !== 0) {
    const out = ((r.err || '') + (r.out || '')).slice(0, 800);
    throw new Error(tl('ml.installerFailed', { loader, code: r.code ?? '?', out }));
  }

  const after = new Set(fs.existsSync(versionsRoot) ? fs.readdirSync(versionsRoot) : []);
  for (const d of after) {
    if (!before.has(d) && fs.existsSync(path.join(versionsRoot, d, `${d}.json`))) return d;
  }
  if (fs.existsSync(path.join(versionsRoot, expectedId, `${expectedId}.json`))) return expectedId;
  throw new Error(tl('ml.installerNoVersion'));
}

// ---------------- public API ----------------

const LOADERS = {
  fabric: { label: 'Fabric', versions: fabricVersions, profile: fabricProfile },
  quilt: { label: 'Quilt', versions: quiltVersions, profile: quiltProfile },
  'legacy-fabric': { label: 'Legacy Fabric', versions: legacyFabricVersions, profile: legacyFabricProfile },
  forge: { label: 'Forge', versions: forgeVersions, installer: true },
  neoforge: { label: 'NeoForge', versions: neoforgeVersions, installer: true },
};

async function listLoadersForVersion(mcVersion) {
  const out = [];
  for (const [key, def] of Object.entries(LOADERS)) {
    try {
      const versions = await def.versions(mcVersion);
      out.push({ loader: key, label: def.label, versions });
    } catch {
      out.push({ loader: key, label: def.label, versions: [] });
    }
  }
  return out;
}

async function installModloader({ loader, mcVersion, loaderVersion }, onProgress) {
  const def = LOADERS[loader];
  if (!def) throw new Error(tl('ml.unknown', { loader }));

  if (def.installer) {
    const id = await runInstaller(loader, mcVersion, loaderVersion, onProgress);
    const vdir = paths.versionDir(id);
    const profile = JSON.parse(fs.readFileSync(path.join(vdir, `${id}.json`), 'utf8'));
    const resolved = await versions.resolveVersion(profile);
    const result = await versions.installVersion(id, resolved, onProgress);
    fs.writeFileSync(path.join(vdir, `${id}.json`), JSON.stringify(profile, null, 2));
    return { id, ...result };
  }

  const profile = await def.profile(mcVersion, loaderVersion);
  const id = profile.id || `${loader}-${loaderVersion}-${mcVersion}`;
  const resolved = await versions.resolveVersion(profile);
  const result = await versions.installVersion(id, resolved, onProgress);
  const vdir = paths.versionDir(id);
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(path.join(vdir, `${id}.json`), JSON.stringify(profile, null, 2));
  return { id, ...result };
}

module.exports = { listLoadersForVersion, installModloader, LOADERS };
