const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./src/main/store');
const paths = require('./src/main/paths');
const java = require('./src/main/java');
const versions = require('./src/main/versions');
const auth = require('./src/main/auth');
const launch = require('./src/main/launch');
const authlib = require('./src/main/authlib');
const news = require('./src/main/news');
const modloaders = require('./src/main/modloaders');
const mods = require('./src/main/mods');
const modpacks = require('./src/main/modpacks');
const skins = require('./src/main/skins');
const { tl } = require('./src/main/ti18n');

let win = null;
let installing = false;
let versionsWatcher = null;
let versionsWatchTimer = null;

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

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function setupVersionsWatcher() {
  if (versionsWatcher) {
    try {
      versionsWatcher.close();
    } catch {}
    versionsWatcher = null;
  }
  clearTimeout(versionsWatchTimer);
  const vdir = path.join(paths.gameDir(), 'versions');
  if (!fs.existsSync(vdir)) return;
  try {
    versionsWatcher = fs.watch(vdir, { recursive: true }, () => {
      clearTimeout(versionsWatchTimer);
      versionsWatchTimer = setTimeout(() => send('versions:changed'), 400);
    });
    versionsWatcher.on('error', () => {
      try {
        versionsWatcher && versionsWatcher.close();
      } catch {}
      versionsWatcher = null;
    });
  } catch {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 660,
    frame: false,
    show: false,
    backgroundColor: '#0b0e1a',
    title: 'iDK Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    if (process.argv.includes('--smoke')) setTimeout(() => app.quit(), 8000);
  });
  win.on('closed', () => (win = null));
  win.on('maximize', () => send('win:maximized', true));
  win.on('unmaximize', () => send('win:maximized', false));
  if (process.argv.includes('--smoke')) {
    win.webContents.on('console-message', (_e, level, message) => {
      console.log('[renderer:' + level + '] ' + message);
    });
  }
}

function registerIpc() {
  ipcMain.handle('win:minimize', () => win && win.minimize());
  ipcMain.handle('win:toggle-maximize', () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('win:close', () => win && win.close());

  ipcMain.handle('settings:get', () => ({
    gameDir: paths.gameDir(),
    memory: store.get('memory', 2048),
    javaPath: store.get('javaPath', ''),
    jvmArgs: store.get('jvmArgs', ''),
    lastVersion: store.get('lastVersion', ''),
    lastModpack: store.get('lastModpack', ''),
    msClientId: store.get('ms.clientId', ''),
    msRedirectUri: store.get('ms.redirectUri', 'http://127.0.0.1:54434/callback'),
    theme: store.get('theme', 'dark'),
    accent: store.get('accent', '#4ade80'),
    versionsCategories: store.get('versions.categories', ['all']),
    versionsInstalledOnly: store.get('versions.installedOnly', false),
    language: store.get('language', 'en'),
    onboardingDone: store.get('onboardingDone', false),
    tosAccepted: store.get('tosAccepted', false),
    eulaAccepted: store.get('eulaAccepted', false),
  }));
  ipcMain.handle('settings:set', (_e, key, value) => {
    store.set(key, value);
    if (key === 'gameDir') {
      paths.ensureMinecraftDirs();
      setupVersionsWatcher();
    }
    return true;
  });

  ipcMain.handle('agreements:accept', async (_e, payload) => {
    const p = payload || {};
    if (p.eula) {
      store.set('eulaAccepted', true);
      const dir = paths.gameDir();
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n', 'utf8');
      } catch {}
    }
    if (p.tos) store.set('tosAccepted', true);
    return true;
  });

  ipcMain.handle('java:list', () => java.detectJava());

  ipcMain.handle('dir:pick', async (_e, title) => {
    const r = await dialog.showOpenDialog(win, { title: title || tl('dialog.pickFolder'), properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('dir:open', async (_e, sub) => {
    if (sub != null && !safeSeg(sub)) return { ok: false, error: tl('main.badPath') };
    const dir = sub ? path.join(paths.gameDir(), sub) : paths.gameDir();
    try {
      const err = await shell.openPath(dir);
      return err ? { ok: false, error: err } : { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('java:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: tl('dialog.pickJava'),
      properties: ['openFile'],
      filters: [{ name: 'Java', extensions: ['exe'] }],
    });
    if (r.canceled) return null;
    const bin = java.executableBin(r.filePaths[0]);
    const info = java.probeJava(bin);
    return info || { bin, home: path.dirname(path.dirname(bin)), major: 0, version: '?', vendor: 'Java', bits: 0 };
  });

  ipcMain.handle('versions:list', async () => {
    let manifest = null;
    try {
      manifest = await versions.getManifest();
    } catch {}
    const installed = versions.installedVersions().reduce((m, v) => {
      m[v.id] = v;
      return m;
    }, {});
    const seen = new Set((manifest && manifest.versions || []).map((v) => v.id));
    const extra = versions
      .installedVersions()
      .filter((v) => !seen.has(v.id))
      .map((v) => ({ ...v, installed: true }));
    const list = [...(manifest ? manifest.versions : []), ...extra]
      .map((v) => ({ ...v, installed: !!installed[v.id] }))
      .sort((a, b) => (b.releaseTime || '').localeCompare(a.releaseTime || ''));
    return { latest: manifest && manifest.latest, list };
  });

  ipcMain.handle('versions:installed', () => versions.installedVersions());

  ipcMain.handle('versions:delete', async (_e, id) => {
    if (!safeSeg(id)) return { ok: false, error: tl('main.badPath') };
    if (installing) return { ok: false, error: tl('main.installingBusy') };
    if (launch.isRunning(id)) return { ok: false, error: tl('main.versionRunning') };
    const dir = paths.versionDir(id);
    if (!fs.existsSync(dir)) return { ok: false, error: tl('main.versionNotInstalled') };
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      send('versions:changed');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('versions:install', async (_e, id, url) => {
    if (!safeSeg(id)) return { ok: false, error: tl('main.badPath') };
    if (installing) return { ok: false, error: tl('toast.anotherInstall') };
    installing = true;
    try {
      const vj = await versions.getVersionJson(id, url);
      const result = await versions.installVersion(id, vj, (p) => send('dl:progress', { ...p, version: id }));
      return { ok: true, result };
    } catch (e) {
      send('dl:progress', { error: e.message, done: 0, total: 1, percent: 0, phase: 'error', version: id });
      return { ok: false, error: e.message };
    } finally {
      installing = false;
    }
  });

  ipcMain.handle('auth:list', () => auth.listAccounts());
  ipcMain.handle('auth:selected', () => auth.getSelectedAccount());
  ipcMain.handle('auth:offline', (_e, nick) => {
    try {
      return { ok: true, account: auth.loginOffline(nick) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('auth:elyby', async (_e, username, password) => {
    try {
      return { ok: true, account: await auth.loginElyby(username, password) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('auth:microsoft', async () => {
    try {
      const account = await auth.loginMicrosoft({ status: (s) => send('auth:status', s) });
      return { ok: true, account };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('auth:select', (_e, uuid) => {
    auth.selectAccount(uuid);
    return true;
  });
  ipcMain.handle('auth:remove', (_e, uuid) => {
    auth.removeAccount(uuid);
    return true;
  });

  ipcMain.handle('game:launch', async (_e, payload) => {
    try {
      const { versionId: rawVid, versionUrl, modpack } = payload;
      const account = await auth.getPlayableAccount();
      if (!account) throw new Error(tl('auth.noAccount'));

      let versionId = rawVid;
      let runId = null;
      let gameDir = paths.gameDir();
      if (modpack) {
        const inst = modpacks.get(modpack);
        if (!inst) throw new Error(tl('main.modpackNotFound'));
        versionId = inst.launchId;
        runId = 'mp:' + inst.slug;
        gameDir = path.join(modpacks.rootDir(), inst.slug);
        if (!fs.existsSync(path.join(gameDir, 'instance.json'))) throw new Error(tl('main.modpackCorrupt'));
      }

      const vj = versionUrl ? await versions.getVersionJson(versionId, versionUrl) : await versions.getVersionJsonForId(versionId);
      if (!vj) throw new Error(tl('main.versionNotFound'));
      const resolved = await versions.resolveVersion(vj);

      if (!versions.isInstalled(versionId, vj)) {
        await versions.installVersion(versionId, resolved, (p) => send('dl:progress', { ...p, version: versionId }));
      }

      let javaBin = store.get('javaPath', '');
      if (javaBin) {
        if (!javaBin.toLowerCase().endsWith('java.exe') && !javaBin.toLowerCase().endsWith('java')) {
          javaBin = path.join(javaBin, process.platform === 'win32' ? 'java.exe' : 'java');
        }
        javaBin = java.executableBin(javaBin);
      }
      const requiredMajor = (resolved.javaVersion && resolved.javaVersion.majorVersion) || 8;
      let selectedJava = null;
      if (javaBin && java.probeJava(javaBin)) selectedJava = java.probeJava(javaBin);
      if (!selectedJava || selectedJava.major < requiredMajor) {
        const res = java.resolveJava(requiredMajor);
        if (res.java && res.java.major >= requiredMajor) {
          selectedJava = res.java;
        } else {
          if (res.java) {
            send('game:log', { level: 'warn', text: tl('main.javaRecommended', { major: requiredMajor, found: res.java.major }) });
          }
          try {
            send('game:log', { level: 'info', text: tl('main.javaDownloading', { major: requiredMajor }) });
            const bin = await java.downloadJava(requiredMajor, (percent) =>
              send('dl:progress', { phase: 'java', name: tl('phase.java', { major: java.javaFeature(requiredMajor) }), percent, version: versionId })
            );
            selectedJava = java.probeJava(bin);
          } catch (e) {
            send('game:log', { level: 'warn', text: tl('main.javaDownloadFailed', { msg: e.message }) });
          }
        }
      }
      if (!selectedJava) throw new Error(tl('main.javaRequired', { major: requiredMajor }));
      selectedJava = { ...selectedJava, bin: java.executableBin(selectedJava.bin) };

      let authlibInjector = null;
      if (account.type === 'elyby') {
        try {
          authlibInjector = await authlib.ensure();
        } catch (e) {
          send('game:log', { level: 'warn', text: tl('main.authlibFailed', { msg: e.message }) });
        }
      }

      const settings = {
        memory: store.get('memory', 2048),
        jvmArgs: store.get('jvmArgs', ''),
        authlibInjector,
        gameDir: paths.gameDir(),
      };

      launch.launchGame({
        versionId,
        versionJson: resolved,
        account,
        java: selectedJava,
        settings,
        gameDir,
        runId,
        onOutput: (line) => send('game:log', { level: 'info', text: line }),
        onExit: (code) => {
          send('game:exit', { code, versionId, modpack });
        },
      });
      return { ok: true, java: selectedJava };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('game:stop', (_e, key) => launch.stopGame(key));

  const runGameDir = (payload) => {
    const p = payload || {};
    if (p.modpack) {
      const inst = modpacks.get(p.modpack);
      if (inst) return path.join(modpacks.rootDir(), inst.slug);
    }
    return paths.gameDir();
  };

  ipcMain.handle('game:logs', (_e, payload) => launch.lastLogs(runGameDir(payload)));

  ipcMain.handle('game:openLogs', async (_e, payload) => {
    try {
      const dir = path.join(runGameDir(payload), 'logs');
      const err = await shell.openPath(dir);
      return err ? { ok: false, error: err } : { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('news:get', async (_e, force) => {
    try {
      return { ok: true, channel: news.CHANNEL, items: await news.fetchNews(!!force) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modloaders:loaders', async (_e, mcVersion) => {
    try {
      return { ok: true, loaders: await modloaders.listLoadersForVersion(mcVersion) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('modloaders:install', async (_e, payload) => {
    if (installing) return { ok: false, error: tl('toast.anotherInstall') };
    installing = true;
    try {
      const result = await modloaders.installModloader(payload, (p) =>
        send('dl:progress', { ...p, version: `${payload.mcVersion} ${payload.loader}` })
      );
      return { ok: true, id: result.id, result };
    } catch (e) {
      send('dl:progress', { error: e.message, done: 0, total: 1, percent: 0, phase: 'error', version: payload.mcVersion });
      return { ok: false, error: e.message };
    } finally {
      installing = false;
    }
  });

  ipcMain.handle('shell:open', (_e, url) => shell.openExternal(url));

  ipcMain.handle('mods:search', async (_e, payload) => {
    try {
      const r = await mods.search(payload);
      return { ok: true, mods: r.list, total: r.total };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('mods:install', async (_e, payload) => {
    if (installing) return { ok: false, error: tl('toast.anotherInstall') };
    installing = true;
    try {
      return { ok: true, result: await mods.install(payload) };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      installing = false;
    }
  });
  ipcMain.handle('mods:installed', () => mods.installedList());
  ipcMain.handle('mods:versions', async (_e, id) => {
    try {
      return { ok: true, result: await mods.versions(id) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('mods:game-versions', async () => {
    try {
      return { ok: true, versions: await mods.gameVersionsForPicker() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('modpacks:search', async (_e, payload) => {
    try {
      const r = await modpacks.search(payload);
      return { ok: true, mods: r.list, total: r.total };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('modpacks:versions', async (_e, id) => {
    try {
      return { ok: true, versions: await modpacks.versionsForPicker(id) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('modpacks:install', async (_e, payload) => {
    if (installing) return { ok: false, error: tl('toast.anotherInstall') };
    installing = true;
    try {
      const result = await modpacks.install(payload, (p) => send('dl:progress', { ...p, version: tl('main.modpackVersion') }));
      send('modpacks:changed');
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      installing = false;
    }
  });
  ipcMain.handle('modpacks:create', async (_e, payload) => {
    if (installing) return { ok: false, error: tl('toast.anotherInstall') };
    installing = true;
    try {
      const result = await modpacks.create(payload, (p) => send('dl:progress', { ...p, version: tl('main.modpackVersion') }));
      send('modpacks:changed');
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      installing = false;
    }
  });
  ipcMain.handle('modpacks:list', () => {
    try {
      return { ok: true, packs: modpacks.list() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('modpacks:remove', (_e, slug) => {
    if (!safeSeg(slug)) return { ok: false, error: tl('main.badPath') };
    try {
      modpacks.remove(slug);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('skins:get', async (_e, uuid) => {
    try {
      return await skins.profile(uuid);
    } catch (e) {
      return { ok: false, error: e.message, errorCode: e.code || null };
    }
  });
  ipcMain.handle('skins:setDefault', async (_e, uuid, style) => {
    try {
      return await skins.setDefault(uuid, style);
    } catch (e) {
      return { ok: false, error: e.message, errorCode: e.code || null };
    }
  });
  ipcMain.handle('skins:upload', async (_e, uuid, file, slim) => {
    try {
      return await skins.upload(uuid, file, slim);
    } catch (e) {
      return { ok: false, error: e.message, errorCode: e.code || null };
    }
  });
  ipcMain.handle('skins:applyB64', async (_e, uuid, b64, slim) => {
    try {
      return await skins.applyB64(uuid, b64, slim);
    } catch (e) {
      return { ok: false, error: e.message, errorCode: e.code || null };
    }
  });
  ipcMain.handle('skins:reset', async (_e, uuid) => {
    try {
      return await skins.reset(uuid);
    } catch (e) {
      return { ok: false, error: e.message, errorCode: e.code || null };
    }
  });
  ipcMain.handle('skins:pick', async () => {
    try {
      return await skins.pick();
    } catch (e) {
      return { ok: false, error: e.message, errorCode: e.code || null };
    }
  });
  ipcMain.handle('skins:elybyLogin', async (_e, uuid) => {
    try {
      const acc = store.accounts().find((a) => a.uuid === uuid);
      if (!acc) return { ok: false, error: 'Account not found' };
      return await skins.elybyLogin(acc);
    } catch (e) {
      return { ok: false, error: e.message, errorCode: e.code || null };
    }
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.whenReady().then(() => {
  store.init();
  paths.init();
  createWindow();
  registerIpc();
  setupVersionsWatcher();
});
