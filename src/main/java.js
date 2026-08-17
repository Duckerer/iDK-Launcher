const { spawnSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const BIN_NAME = process.platform === 'win32' ? 'java.exe' : 'java';

function dlRoot() {
  return path.join(app.getPath('userData'), 'java');
}

function javaFeature(requiredMajor) {
  if (!requiredMajor || requiredMajor <= 8) return 8;
  if (requiredMajor <= 11) return 11;
  if (requiredMajor <= 17) return 17;
  if (requiredMajor <= 21) return 21;
  return requiredMajor;
}

function executableBin(bin) {
  if (process.platform !== 'win32' || !bin) return bin;
  const low = bin.toLowerCase();
  if (low.endsWith('java.exe')) {
    const javaw = path.join(path.dirname(bin), 'javaw.exe');
    return fs.existsSync(javaw) ? javaw : bin;
  }
  return bin;
}

function unique(list) {
  return [...new Set(list.map((p) => (p || '').trim().toLowerCase()).filter(Boolean))].map((p) => p);
}

function candidateBins() {
  const bins = [];
  const env = process.env;
  const paths = [];

  if (env.JAVA_HOME) paths.push(path.join(env.JAVA_HOME, 'bin'));
  if (env.JRE_HOME) paths.push(path.join(env.JRE_HOME, 'bin'));

  const roots = [];
  if (env.ProgramFiles) roots.push(env.ProgramFiles);
  if (env['ProgramFiles(x86)']) roots.push(env['ProgramFiles(x86)']);
  if (env.ProgramW6432) roots.push(env.ProgramW6432);
  if (env.LOCALAPPDATA) roots.push(path.join(env.LOCALAPPDATA, 'Programs'));

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(root, e);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        const bin = path.join(p, 'bin', BIN_NAME);
        if (fs.existsSync(bin)) paths.push(path.join(p, 'bin'));
        try {
          for (const sub of fs.readdirSync(p)) {
            if (sub.toLowerCase().includes('jdk') || sub.toLowerCase().includes('jre') || sub.toLowerCase().includes('java')) {
              const b2 = path.join(p, sub, 'bin', BIN_NAME);
              if (fs.existsSync(b2)) paths.push(path.join(p, sub, 'bin'));
            }
          }
        } catch {}
      }
    }
  }

  // PATH lookup
  const pathVar = env.Path || env.PATH || '';
  for (const entry of pathVar.split(';')) {
    const t = entry.replace(/^"|"$/g, '').trim();
    if (!t) continue;
    if (/java/i.test(t) || /jdk|jre|temurin|zulu|microsoft|openjdk|graal|corretto|adoptium|bellsoft/i.test(t)) {
      if (fs.existsSync(path.join(t, BIN_NAME))) paths.push(t);
    }
  }

  for (const p of paths) {
    const bin = path.join(p, BIN_NAME);
    if (fs.existsSync(bin)) bins.push(bin);
  }

  const root = dlRoot();
  if (fs.existsSync(root)) {
    try {
      for (const e of fs.readdirSync(root)) {
        const p = path.join(root, e);
        if (!fs.statSync(p).isDirectory()) continue;
        const bin = path.join(p, 'bin', BIN_NAME);
        if (fs.existsSync(bin)) bins.push(bin);
      }
    } catch {}
  }

  return unique(bins.map(executableBin));
}

function probeJava(bin) {
  let probeBin = bin;
  if (process.platform === 'win32' && bin && bin.toLowerCase().endsWith('javaw.exe')) {
    const alt = path.join(path.dirname(bin), 'java.exe');
    if (fs.existsSync(alt)) probeBin = alt;
  }
  const r = spawnSync(probeBin, ['-version'], { encoding: 'utf8', timeout: 15000 });
  const text = (r.stderr || '') + '\n' + (r.stdout || '');
  const m = text.match(/version "([^"]+)"/);
  if (!m) return null;
  const raw = m[1];
  const parts = raw.split(/[._]/);
  const major = parts[0] === '1' ? parseInt(parts[1], 10) : parseInt(parts[0], 10);
  const vendorMatch = text.match(/^(OpenJDK|Java HotSpot|Eclipse Adoptium|Oracle|Microsoft|GraalVM|Zulu|BellSoft)[^\n]*/m);
  const bits = /64-Bit|64-bit/.test(text) ? 64 : 32;
  return {
    bin,
    home: path.dirname(path.dirname(bin)),
    major,
    version: raw,
    vendor: vendorMatch ? vendorMatch[0].split(' ')[0] : 'Java',
    bits,
  };
}

function detectJava() {
  const out = [];
  for (const bin of candidateBins()) {
    const info = probeJava(bin);
    if (info) out.push(info);
  }
  out.sort((a, b) => b.major - a.major || (b.bits - a.bits));
  return out;
}

function resolveJava(requiredMajor) {
  const list = detectJava();
  if (!list.length) return { java: null, list };
  const good = list.find((j) => j.major >= (requiredMajor || 8) && j.bits === 64) || list[0];
  return { java: good, list };
}

function findJavaBin(dir) {
  try {
    for (const e of fs.readdirSync(dir)) {
      const p = path.join(dir, e);
      if (!fs.statSync(p).isDirectory()) continue;
      const bin = path.join(p, 'bin', BIN_NAME);
      if (fs.existsSync(bin)) return bin;
    }
    const bin = path.join(dir, 'bin', BIN_NAME);
    if (fs.existsSync(bin)) return bin;
  } catch {}
  return null;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'iDK-Launcher' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve({ redirect: res.headers.location });
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    let current = url;
    let steps = 0;
    const go = () => {
      httpsGet(current)
        .then((res) => {
          if (res.redirect) {
            current = res.redirect;
            if (++steps > 10) return reject(new Error('Too many redirects'));
            return go();
          }
          const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
          let done = 0;
          const ws = fs.createWriteStream(dest);
          res.on('data', (chunk) => {
            done += chunk.length;
            if (total && onProgress) onProgress(Math.min(99, Math.round((done / total) * 100)));
          });
          ws.on('error', reject);
          res.on('error', reject);
          res.pipe(ws).on('finish', () => {
            ws.end();
            resolve();
          });
        })
        .catch(reject);
    };
    go();
  });
}

async function downloadJava(requiredMajor, { onProgress } = {}) {
  const feature = javaFeature(requiredMajor);
  const destDir = path.join(dlRoot(), `jre-${feature}`);
  const found = findJavaBin(destDir);
  if (found) return found;

  const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const archName = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz';
  const url = `https://api.adoptium.net/v3/binary/latest/${feature}/ga/${osName}/${archName}/jre/hotspot/normal/eclipse`;
  const tmpFile = path.join(app.getPath('temp'), `idk-java-${feature}.${ext}`);

  fs.mkdirSync(destDir, { recursive: true });
  await downloadFile(url, tmpFile, (percent) => onProgress && onProgress(percent));
  try {
    let ok = false;
    if (process.platform === 'win32') {
      const r = spawnSync('tar', ['-xf', tmpFile, '-C', destDir], { stdio: 'ignore' });
      ok = r.status === 0;
      if (!ok) {
        const ps = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${tmpFile.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`], { stdio: 'ignore' });
        ok = ps.status === 0;
      }
    } else {
      const r = spawnSync('tar', ['-xzf', tmpFile, '-C', destDir], { stdio: 'ignore' });
      ok = r.status === 0;
    }
    if (!ok) throw new Error('Failed to extract Java archive');
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
  }
  const bin = findJavaBin(destDir);
  if (!bin) throw new Error('Java download failed');
  return bin;
}

module.exports = { detectJava, resolveJava, probeJava, executableBin, downloadJava, javaFeature };
