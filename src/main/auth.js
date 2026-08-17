const crypto = require('crypto');
const http = require('http');
const { app, BrowserWindow } = require('electron');
const store = require('./store');
const { tl } = require('./ti18n');

const UA = 'iDK-Launcher/1.0.0';

function formatUuid(id) {
  const s = String(id).replace(/-/g, '');
  if (s.length !== 32) return id;
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function offlineUuid(nick) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + nick).digest('hex');
  return `${md5.slice(0, 8)}-${md5.slice(8, 12)}-${md5.slice(12, 16)}-${md5.slice(16, 20)}-${md5.slice(20)}`;
}

function sanitize(nick) {
  return nick.trim();
}

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, data };
}

function loginOffline(rawNick) {
  const nick = sanitize(rawNick);
  if (!nick) throw new Error(tl('auth.nickRequired'));
  if (!/^[A-Za-z0-9_]{1,16}$/.test(nick)) throw new Error(tl('auth.nickInvalid'));
  const acc = {
    type: 'offline',
    uuid: offlineUuid(nick),
    name: nick,
    accessToken: '0',
    userType: 'legacy',
    createdAt: Date.now(),
  };
  store.addAccount(acc);
  store.set('selectedAccount', acc.uuid);
  return acc;
}

async function loginElyby(rawNick, rawPass) {
  const username = sanitize(rawNick);
  if (!username || !rawPass) throw new Error(tl('auth.elybyCredentials'));
  const clientToken = crypto.randomUUID();
  const { ok, status, data } = await post('https://authserver.ely.by/auth/authenticate', {
    username,
    password: rawPass,
    clientToken,
    requestUser: false,
  });
  if (!ok || !data || !data.selectedProfile) {
    const msg = data && (data.errorMessage || data.error);
    throw new Error(msg ? tl('auth.elybyError', { msg }) : tl('auth.elybyHttp', { status }));
  }
  const acc = {
    type: 'elyby',
    uuid: formatUuid(data.selectedProfile.id),
    name: data.selectedProfile.name,
    accessToken: data.accessToken,
    clientToken: data.clientToken || clientToken,
    userType: 'mojang',
    createdAt: Date.now(),
  };
  store.addAccount(acc);
  store.set('selectedAccount', acc.uuid);
  return acc;
}

async function refreshElyby(acc) {
  const { ok, data } = await post('https://authserver.ely.by/auth/refresh', {
    accessToken: acc.accessToken,
    clientToken: acc.clientToken,
    requestUser: false,
  });
  if (!ok || !data || !data.selectedProfile) return acc;
  return {
    ...acc,
    uuid: formatUuid(data.selectedProfile.id),
    name: data.selectedProfile.name,
    accessToken: data.accessToken,
    clientToken: data.clientToken || acc.clientToken,
  };
}

// ---------------- Microsoft ----------------

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest();
}

async function msExchangeToken(params) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch('https://login.live.com/oauth20_token.srf', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!res.ok || !data) throw new Error(tl('auth.msToken', { status: res.status }));
  return data;
}

async function xblAuthenticate(msAccessToken) {
  const { ok, status, data } = await post('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  if (!ok || !data) throw new Error(tl('auth.xbl', { status }));
  const uhs = data.DisplayClaims && data.DisplayClaims.xui && data.DisplayClaims.xui[0] && data.DisplayClaims.xui[0].uhs;
  return { token: data.Token, uhs };
}

async function xstsAuthorize(xblToken) {
  const { ok, status, data } = await post('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  });
  if (!ok) {
    const xerr = data && data.XErr;
    let msg = tl('auth.xsts');
    if (xerr === 2148916233) msg = tl('auth.xsts.noProfile');
    else if (xerr === 2148916235) msg = tl('auth.xsts.country');
    else if (xerr === 2148916238) msg = tl('auth.xsts.child');
    else if (xerr === 2148916227) msg = tl('auth.xsts.banned');
    throw new Error(msg);
  }
  return { token: data.Token };
}

async function minecraftLogin(uhs, xstsToken) {
  const { ok, status, data } = await post('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xstsToken}`,
  });
  if (!ok || !data) throw new Error(tl('auth.mcLogin', { status }));
  return data;
}

function msLoginWindow(url, redirectPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const redirectUri = parsed.searchParams.get('redirect_uri');
    let server = null;
    let settled = false;
    let win = null;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(tl('auth.msTimeout')));
    }, timeoutMs || 180000);

    const cleanup = () => {
      clearTimeout(timeout);
      if (server) server.close();
      if (win && !win.isDestroyed()) win.destroy();
      settled = true;
    };

    server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== redirectPath) {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = u.searchParams.get('code');
      const error = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>iDK Launcher</title><body style="font-family:sans-serif;background:#0b0e1a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>' +
          tl('auth.msDoneTitle') +
          '</h2><p>' +
          tl('auth.msDoneText') +
          '</p></div></body>'
      );
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(new Error(`Microsoft: ${error}`));
      } else if (code) {
        resolve(code);
      } else {
        reject(new Error(tl('auth.msCode')));
      }
    });

    server.listen(parsed.port, '127.0.0.1', () => {
      win = new BrowserWindow({
        width: 520,
        height: 780,
        autoHideMenuBar: true,
        parent: BrowserWindow.getAllWindows()[0],
        title: tl('auth.msWinTitle'),
      });
      win.webContents.setWindowOpenHandler(({ url }) => {
        require('electron').shell.openExternal(url);
        return { action: 'deny' };
      });
      win.loadURL(url);
      win.on('closed', () => {
        if (!settled) {
          cleanup();
          reject(new Error(tl('auth.msClosed')));
        }
      });
    });
    server.on('error', (e) => {
      cleanup();
      reject(new Error(tl('auth.msServer', { msg: e.message })));
    });
  });
}

async function loginMicrosoft({ status }) {
  const clientId = store.get('ms.clientId', '').trim();
  const redirectUri = store.get('ms.redirectUri', 'http://127.0.0.1:54434/callback');
  if (!clientId) throw new Error(tl('login.msNoClientId'));
  if (status) status(tl('auth.connecting'));

  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(sha256(verifier));
  const redirectPath = new URL(redirectUri).pathname;

  const authUrl =
    'https://login.live.com/oauth20_authorize.srf' +
    '?client_id=' + encodeURIComponent(clientId) +
    '&response_type=code' +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&scope=' + encodeURIComponent('XboxLive.signin offline_access') +
    '&code_challenge=' + challenge +
    '&code_challenge_method=S256' +
    '&prompt=select_account';

  if (status) status(tl('auth.inBrowser'));
  const code = await msLoginWindow(authUrl, redirectPath);

  if (status) status(tl('auth.exchanging'));
  const tokens = await msExchangeToken({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    scope: 'XboxLive.signin offline_access',
  });
  const msRefresh = tokens.refresh_token;

  return finishMicrosoft(clientId, tokens.access_token, msRefresh, status);
}

async function finishMicrosoft(clientId, msAccessToken, msRefresh, status) {
  if (status) status(tl('auth.xbox'));
  const { token: xblToken, uhs } = await xblAuthenticate(msAccessToken);
  if (status) status(tl('auth.xsts2'));
  const { token: xstsToken } = await xstsAuthorize(xblToken);
  if (status) status(tl('auth.minecraft'));
  const mc = await minecraftLogin(uhs, xstsToken);

  if (mc.roles && mc.roles.length && !mc.roles.includes('user_minecraft')) {
    throw new Error(tl('auth.msNoMc'));
  }

  const acc = {
    type: 'microsoft',
    uuid: formatUuid(mc.id),
    name: mc.name,
    accessToken: mc.access_token,
    expiresAt: Date.now() + (mc.expires_in || 0) * 1000,
    msRefreshToken: msRefresh || null,
    userType: 'msa',
    clientId,
    xuid: uhs,
    createdAt: Date.now(),
  };
  store.addAccount(acc);
  store.set('selectedAccount', acc.uuid);
  return acc;
}

async function refreshMicrosoft(acc) {
  const clientId = acc.clientId || store.get('ms.clientId', '');
  const redirectUri = store.get('ms.redirectUri', 'http://127.0.0.1:54434/callback');
  if (!acc.msRefreshToken) throw new Error(tl('auth.msRefresh'));
  const tokens = await msExchangeToken({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: acc.msRefreshToken,
    redirect_uri: redirectUri,
    scope: 'XboxLive.signin offline_access',
  });
  const fresh = await finishMicrosoft(clientId, tokens.access_token, tokens.refresh_token || acc.msRefreshToken, null);
  return fresh;
}

function listAccounts() {
  return store.accounts();
}

function removeAccount(uuid) {
  store.removeAccount(uuid);
}

function selectAccount(uuid) {
  store.set('selectedAccount', uuid);
}

function getSelectedAccount() {
  const uuid = store.selectedAccountUuid();
  const all = store.accounts();
  return all.find((a) => a.uuid === uuid) || all[all.length - 1] || null;
}

async function getPlayableAccount() {
  let acc = getSelectedAccount();
  if (!acc) return null;
  if (acc.type === 'elyby') {
    try {
      acc = await refreshElyby(acc);
      const all = store.accounts().map((a) => (a.uuid === acc.uuid ? acc : a));
      store.set('accounts', all);
    } catch {}
  } else if (acc.type === 'microsoft') {
    const needsRefresh = !acc.expiresAt || Date.now() > acc.expiresAt - 5 * 60 * 1000;
    if (needsRefresh) {
      try {
        acc = await refreshMicrosoft(acc);
        const all = store.accounts().map((a) => (a.uuid === acc.uuid ? acc : a));
        store.set('accounts', all);
      } catch (e) {
        throw new Error(tl('auth.msRefreshFail', { msg: e.message }));
      }
    }
  }
  return acc;
}

module.exports = {
  loginOffline,
  loginElyby,
  loginMicrosoft,
  listAccounts,
  removeAccount,
  selectAccount,
  getSelectedAccount,
  getPlayableAccount,
  refreshMicrosoft,
};
