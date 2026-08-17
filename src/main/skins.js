const fs = require('fs');
const path = require('path');
const { dialog, BrowserWindow, app, session } = require('electron');
const { tl } = require('./ti18n');
const auth = require('./auth');
const store = require('./store');

const STEVE_UUID = '069a79f444e94726a5befca90e38aaf5';
const ALEX_UUID = '853c80ef3c3749fdaa49938b674adae6';
const defaults = {};

// in-memory ely.by site session per account uuid (memory only; the cookies
// themselves live in the persist:elyby partition so re-login is not required)
const elySessions = {};
const ELY_PARTITION = 'persist:elyby';
const ELY_AUTH_URL =
  'https://account.ely.by/oauth2/v1/ely?scope=account_info%2Caccount_email&response_type=code' +
  '&redirect_uri=https%3A%2F%2Fely.by%2Fauthorization%2Foauth&state=idklauncher';

async function textureSkinUrl(mcUuid) {
  try {
    const r = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${mcUuid}`);
    if (!r.ok) return null;
    const j = await r.json();
    const tex = (j.properties || []).find((p) => p.name === 'textures');
    if (!tex) return null;
    const t = JSON.parse(Buffer.from(tex.value, 'base64').toString('utf8'));
    return (t.textures && t.textures.SKIN && t.textures.SKIN.url) || null;
  } catch {
    return null;
  }
}

async function ensureDefaults() {
  if (!defaults.steve) defaults.steve = await textureSkinUrl(STEVE_UUID);
  if (!defaults.alex) defaults.alex = await textureSkinUrl(ALEX_UUID);
}

async function defaultBytes(style) {
  await ensureDefaults();
  const url = style === 'alex' ? defaults.alex : defaults.steve;
  if (!url) throw new Error(tl('skins.noDefault'));
  const r = await fetch(url);
  if (!r.ok) throw new Error(tl('skins.noDefault'));
  return Buffer.from(await r.arrayBuffer());
}

function findAccount(uuid) {
  const acc = store.accounts().find((a) => a.uuid === uuid);
  if (!acc) throw new Error(tl('skins.noAcc'));
  return acc;
}

async function msAccount(uuid) {
  const acc = findAccount(uuid);
  if (!acc.accessToken) throw new Error(tl('skins.noToken'));
  if (acc.expiresAt && Date.now() > acc.expiresAt - 5 * 60 * 1000) {
    try {
      const fresh = await auth.refreshMicrosoft(acc);
      const all = store.accounts().map((a) => (a.uuid === fresh.uuid ? fresh : a));
      store.set('accounts', all);
      return fresh;
    } catch (e) {
      throw new Error(tl('skins.refreshFail', { msg: e.message }));
    }
  }
  return acc;
}

function localSkinDir() {
  return path.join(app.getPath('userData'), 'skins');
}

function offlineFiles(uuid) {
  const dir = localSkinDir();
  return { dir, skin: path.join(dir, uuid + '.png') };
}

// ---------------- profile ----------------

async function msProfile(acc) {
  const r = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: 'Bearer ' + acc.accessToken },
  });
  if (!r.ok) throw new Error(tl('skins.profile', { status: r.status }));
  const p = await r.json();
  const skin = (p.skins || []).find((s) => s.state === 'ACTIVE');
  const skinUrl = (skin && skin.url) || null;
  const variant = (skin && skin.variant) || null;
  if (skinUrl) {
    store.set('localSkins.' + acc.uuid + '.lastUrl', skinUrl);
    store.set('localSkins.' + acc.uuid + '.variant', variant);
  }
  return {
    ok: true,
    name: p.name,
    skinUrl,
    variant,
  };
}

async function elybyProfile(acc) {
  const name = encodeURIComponent(acc.name);
  let skinUrl = `https://skinsystem.ely.by/skins/${name}.png`;
  let variant = null;
  try {
    const r = await fetch(`https://skinsystem.ely.by/textures/${name}`);
    if (r.ok) {
      const j = await r.json();
      const m = j && j.SKIN && j.SKIN.metadata && j.SKIN.metadata.model;
      if (m === 'slim' || m === 'classic') variant = m;
    }
  } catch {
    variant = null;
  }
  const cachedB64 = store.get('localSkins.' + acc.uuid + '.b64', null);
  const cachedVariant = store.get('localSkins.' + acc.uuid + '.variant', null);
  if (cachedB64) {
    return {
      ok: true,
      name: acc.name,
      skinUrl: 'data:image/png;base64,' + cachedB64,
      variant: cachedVariant || variant,
    };
  }
  return {
    ok: true,
    name: acc.name,
    skinUrl,
    variant,
  };
}

function offlineProfile(acc) {
  const { skin } = offlineFiles(acc.uuid);
  let skinUrl = null;
  if (fs.existsSync(skin)) skinUrl = 'data:image/png;base64,' + fs.readFileSync(skin).toString('base64');
  return {
    ok: true,
    name: acc.name,
    skinUrl,
    variant: store.get('localSkins.' + acc.uuid + '.variant', null),
  };
}

async function profile(uuid) {
  const acc = findAccount(uuid);
  if (acc.type === 'microsoft') return msProfile(await msAccount(uuid));
  if (acc.type === 'elyby') return elybyProfile(acc);
  return offlineProfile(acc);
}

// ---------------- ely.by website session (OAuth window) ----------------

function elySiteHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '') === 'ely.by';
  } catch {
    return false;
  }
}

async function elySiteCookie(win) {
  try {
    const cookies = await win.webContents.session.cookies.get({});
    const session = cookies.filter(
      (c) => c.name === 'PHPSESSID' && (c.domain === 'ely.by' || c.domain === '.ely.by')
    );
    if (!session.length) return null;
    return session.map((c) => c.name + '=' + c.value).join('; ');
  } catch {
    return null;
  }
}

async function verifySession(cookie) {
  try {
    const r = await fetch('https://ely.by/settings', { headers: { Cookie: cookie }, redirect: 'manual' });
    return r.status === 200;
  } catch {
    return false;
  }
}

function cookieFile(uuid) {
  return path.join(app.getPath('userData'), 'elyby-session-' + uuid + '.cookie');
}

function readCookieFile(uuid) {
  try {
    const s = fs.readFileSync(cookieFile(uuid), 'utf8').trim();
    return s || null;
  } catch {
    return null;
  }
}

async function partitionSession() {
  try {
    const ses = session.fromPartition(ELY_PARTITION);
    const cookies = await ses.cookies.get({});
    return (
      cookies
        .filter((c) => c.name === 'PHPSESSID' && (c.domain === 'ely.by' || c.domain === '.ely.by'))
        .map((c) => c.name + '=' + c.value)
        .join('; ') || null
    );
  } catch {
    return null;
  }
}

async function elybyLogin(acc) {
  let cached = elySessions[acc.uuid] || (await partitionSession()) || readCookieFile(acc.uuid);
  if (cached && (await verifySession(cached))) {
    elySessions[acc.uuid] = cached;
    return { ok: true, cached: true };
  }
  return new Promise((resolve) => {
    let done = false;
    let onSite = false;
    let lastCookie = null;
    const win = new BrowserWindow({
      width: 480,
      height: 680,
      autoHideMenuBar: true,
      title: tl('skins.elyAuth'),
      webPreferences: { partition: ELY_PARTITION },
    });
    const finish = (err) => {
      if (done) return;
      done = true;
      if (!win.isDestroyed()) win.destroy();
      if (err) resolve({ ok: false, error: err.message });
      else {
        try {
          fs.writeFileSync(cookieFile(acc.uuid), lastCookie);
        } catch {}
        elySessions[acc.uuid] = lastCookie;
        resolve({ ok: true });
      }
    };
    let timer = null;
    const startPolling = () => {
      if (timer) return;
      let n = 0;
      timer = setInterval(async () => {
        n++;
        const cookie = await elySiteCookie(win);
        if (cookie && (await verifySession(cookie))) {
          lastCookie = cookie;
          clearInterval(timer);
          finish();
          return;
        }
        if (done) return;
        if (n >= 40) {
          clearInterval(timer);
          finish(new Error(tl('skins.elyAuthNoSession')));
        }
      }, 750);
    };
    win.webContents.on('did-navigate', (e, url) => {
      if (elySiteHost(url)) {
        onSite = true;
        startPolling();
      }
    });
    win.webContents.on('did-finish-load', () => {
      if (onSite) startPolling();
    });
    win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
      if (isMainFrame && code !== -3) finish(new Error(tl('skins.elyAuthFail', { msg: desc })));
    });
    win.on('closed', () => {
      if (done) return;
      if (lastCookie) return finish();
      finish(new Error(tl('skins.elyAuthCancel')));
    });
    win.loadURL(ELY_AUTH_URL);
  });
}

async function needSession(acc) {
  let cookie = elySessions[acc.uuid] || (await partitionSession()) || readCookieFile(acc.uuid);
  if (cookie && (await verifySession(cookie))) {
    elySessions[acc.uuid] = cookie;
    return cookie;
  }
  const e = new Error(tl('skins.elyLoginNeeded'));
  e.code = 'elybyLoginNeeded';
  throw e;
}

async function elybyApplySkin(acc, bytes, filename, slim) {
  const cookie = await needSession(acc);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), filename);
  if (slim != null) form.append('variant', slim ? 'SLIM' : 'CLASSIC');
  const r = await fetch('https://ely.by/skins/upload', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(tl('skins.httpErr', { status: r.status, msg: text.slice(0, 200) }));
  let id = null;
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    j = null;
  }
  if (j && typeof j.url === 'string') {
    const m = j.url.match(/s(\d+)/);
    if (m) id = m[1];
  }
  if (id == null && j) id = j.skin && j.skin.id;
  if (id == null && j) id = j.id;
  if (id == null && j) id = j.skin_id;
  if (id == null && j && j.data) id = j.data.id;
  if (id == null && j && /error_skin_load_skin_have/.test(j.error || '')) {
    // ely.by: this exact skin is already the active one on the account
    return;
  }
  if (id == null) {
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const looksAuth =
      ct.includes('text/html') || /(authenticated|sign in|log in|login|войти|авториз)/i.test(text.slice(0, 300));
    if (looksAuth) {
      const e = new Error(tl('skins.elyLoginNeeded'));
      e.code = 'elybyLoginNeeded';
      throw e;
    }
    throw new Error(tl('skins.httpErr', { status: 200, msg: 'upload: ' + text.slice(0, 400) }));
  }
  const w = await fetch('https://ely.by/skins/wear', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'skinId=' + encodeURIComponent(id),
  });
  const wText = await w.text();
  if (!w.ok) throw new Error(tl('skins.httpErr', { status: w.status, msg: wText.slice(0, 200) }));
}

// ---------------- pick + apply ----------------

function pickPng(title) {
  const win = BrowserWindow.getAllWindows()[0];
  return dialog.showOpenDialog(win, {
    title,
    filters: [{ name: 'PNG', extensions: ['png'] }],
    properties: ['openFile'],
  });
}

async function pick(title) {
  const res = await pickPng(title || tl('skins.uploadDialog'));
  if (res.canceled || !res.filePaths.length) return { ok: true, cancelled: true };
  const file = res.filePaths[0];
  return {
    ok: true,
    path: file,
    dataUrl: 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'),
  };
}

async function setDefault(uuid, style) {
  const acc = findAccount(uuid);
  if (acc.type === 'microsoft') {
    const a = await msAccount(uuid);
    await ensureDefaults();
    const url = style === 'alex' ? defaults.alex : defaults.steve;
    if (!url) throw new Error(tl('skins.noDefault'));
    const variant = style === 'alex' ? 'SLIM' : 'CLASSIC';
    const r = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + a.accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant, url }),
    });
    if (!r.ok) throw new Error(tl('skins.setFail', { status: r.status }));
    store.set('localSkins.' + uuid + '.b64', null);
    store.set('localSkins.' + uuid + '.variant', variant);
    return { ok: true };
  }
  const bytes = await defaultBytes(style);
  const b64 = bytes.toString('base64');
  if (acc.type === 'elyby') {
    await elybyApplySkin(acc, bytes, 'skin.png');
    store.set('localSkins.' + uuid + '.b64', b64);
    store.set('localSkins.' + uuid + '.variant', style === 'alex' ? 'SLIM' : 'CLASSIC');
    return { ok: true };
  }
  const files = offlineFiles(acc.uuid);
  fs.mkdirSync(files.dir, { recursive: true });
  fs.writeFileSync(files.skin, bytes);
  store.set('localSkins.' + acc.uuid + '.variant', style === 'alex' ? 'SLIM' : 'CLASSIC');
  return { ok: true };
}

async function upload(uuid, file, slim) {
  const acc = findAccount(uuid);
  const bytes = fs.readFileSync(file);
  const b64 = bytes.toString('base64');
  if (acc.type === 'microsoft') {
    const a = await msAccount(uuid);
    const form = new FormData();
    form.append('variant', slim ? 'SLIM' : 'CLASSIC');
    form.append('file', new Blob([bytes], { type: 'image/png' }), path.basename(file));
    const r = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + a.accessToken },
      body: form,
    });
    if (!r.ok) throw new Error(tl('skins.setFail', { status: r.status }));
    store.set('localSkins.' + uuid + '.b64', b64);
    store.set('localSkins.' + uuid + '.variant', slim ? 'SLIM' : 'CLASSIC');
    return { ok: true };
  }
  if (acc.type === 'elyby') {
    await elybyApplySkin(acc, bytes, path.basename(file), slim);
    store.set('localSkins.' + uuid + '.b64', b64);
    store.set('localSkins.' + uuid + '.variant', slim ? 'SLIM' : 'CLASSIC');
    return { ok: true };
  }
  const files = offlineFiles(acc.uuid);
  fs.mkdirSync(files.dir, { recursive: true });
  fs.writeFileSync(files.skin, bytes);
  store.set('localSkins.' + acc.uuid + '.variant', slim ? 'SLIM' : 'CLASSIC');
  return { ok: true };
}

async function applyB64(uuid, b64, slim) {
  const bytes = Buffer.from(b64, 'base64');
  const acc = findAccount(uuid);
  if (acc.type === 'microsoft') {
    const a = await msAccount(uuid);
    const form = new FormData();
    form.append('variant', slim ? 'SLIM' : 'CLASSIC');
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'skin.png');
    const r = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + a.accessToken },
      body: form,
    });
    if (!r.ok) throw new Error(tl('skins.setFail', { status: r.status }));
    store.set('localSkins.' + uuid + '.b64', b64);
    store.set('localSkins.' + uuid + '.variant', slim ? 'SLIM' : 'CLASSIC');
    return { ok: true };
  }
  if (acc.type === 'elyby') {
    await elybyApplySkin(acc, bytes, 'skin.png', slim);
    store.set('localSkins.' + uuid + '.b64', b64);
    store.set('localSkins.' + uuid + '.variant', slim ? 'SLIM' : 'CLASSIC');
    return { ok: true };
  }
  const files = offlineFiles(acc.uuid);
  fs.mkdirSync(files.dir, { recursive: true });
  fs.writeFileSync(files.skin, bytes);
  store.set('localSkins.' + acc.uuid + '.variant', slim ? 'SLIM' : 'CLASSIC');
  return { ok: true };
}

async function reset(uuid) {
  const acc = findAccount(uuid);
  store.set('localSkins.' + uuid + '.b64', null);
  store.set('localSkins.' + uuid + '.variant', null);
  if (acc.type === 'microsoft') {
    const a = await msAccount(uuid);
    const r = await fetch('https://api.minecraftservices.com/minecraft/profile/skins/active', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + a.accessToken },
    });
    if (!r.ok) throw new Error(tl('skins.setFail', { status: r.status }));
    return { ok: true };
  }
  if (acc.type === 'elyby') {
    await elybyApplySkin(acc, await defaultBytes('steve'), 'skin.png');
    return { ok: true };
  }
  const files = offlineFiles(acc.uuid);
  if (fs.existsSync(files.skin)) fs.unlinkSync(files.skin);
  return { ok: true };
}

module.exports = { profile, setDefault, upload, applyB64, reset, elybyLogin, pick };
