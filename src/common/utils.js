const path = require('path');

function currentOs() {
  const p = process.platform;
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'osx';
  return 'linux';
}

function arch() {
  return process.arch === 'ia32' ? '32' : '64';
}

function rulesAllow(rules) {
  if (!rules || !rules.length) return true;
  let allow = false;
  for (const r of rules) {
    let ok = true;
    if (r.os) {
      ok = ok && (r.os.name ? r.os.name === currentOs() : true);
      if (r.os.arch) ok = ok && r.os.arch === arch();
    }
    if (r.features) {
      for (const [k, v] of Object.entries(r.features)) {
        ok = ok && !!v;
      }
    }
    if (!ok) continue;
    if (r.action === 'disallow') allow = false;
    else allow = true;
  }
  return allow;
}

function safeSeg(seg) {
  return (
    typeof seg === 'string' &&
    seg &&
    seg !== '.' &&
    seg !== '..' &&
    !seg.includes('/') &&
    !seg.includes('\\')
  );
}

const SAFE_URL_SCHEMES = new Set(['https:', 'http:']);

function isSafeUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (!SAFE_URL_SCHEMES.has(u.protocol)) return false;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1') return false;
    return true;
  } catch {
    return false;
  }
}

function ipcHandler(fn) {
  return async (_e, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  };
}

module.exports = { currentOs, arch, rulesAllow, safeSeg, isSafeUrl, ipcHandler };
