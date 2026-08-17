const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();

function onEvent(channel, cb) {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  const key = channel + ':' + cb;
  listeners.set(key, handler);
  return key;
}

function offEvent(channel, cb) {
  const key = channel + ':' + cb;
  const handler = listeners.get(key);
  if (handler) {
    ipcRenderer.removeListener(channel, handler);
    listeners.delete(key);
  }
}

contextBridge.exposeInMainWorld('idk', {
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggle-maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    onMaximized: (cb) => onEvent('win:maximized', cb),
    offMaximized: (cb) => offEvent('win:maximized', cb),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  },
  java: {
    list: () => ipcRenderer.invoke('java:list'),
    pick: () => ipcRenderer.invoke('java:pick'),
  },
  dir: {
    pick: (title) => ipcRenderer.invoke('dir:pick', title),
    open: (sub) => ipcRenderer.invoke('dir:open', sub),
  },
  versions: {
    list: () => ipcRenderer.invoke('versions:list'),
    installed: () => ipcRenderer.invoke('versions:installed'),
    install: (id, url) => ipcRenderer.invoke('versions:install', id, url),
    delete: (id) => ipcRenderer.invoke('versions:delete', id),
    onProgress: (cb) => onEvent('dl:progress', cb),
    offProgress: (cb) => offEvent('dl:progress', cb),
    onChanged: (cb) => onEvent('versions:changed', cb),
    offChanged: (cb) => offEvent('versions:changed', cb),
  },
  auth: {
    list: () => ipcRenderer.invoke('auth:list'),
    selected: () => ipcRenderer.invoke('auth:selected'),
    offline: (nick) => ipcRenderer.invoke('auth:offline', nick),
    elyby: (username, password) => ipcRenderer.invoke('auth:elyby', username, password),
    microsoft: () => ipcRenderer.invoke('auth:microsoft'),
    select: (uuid) => ipcRenderer.invoke('auth:select', uuid),
    remove: (uuid) => ipcRenderer.invoke('auth:remove', uuid),
    onStatus: (cb) => onEvent('auth:status', cb),
    offStatus: (cb) => offEvent('auth:status', cb),
  },
  game: {
    launch: (payload) => ipcRenderer.invoke('game:launch', payload),
    stop: (versionId) => ipcRenderer.invoke('game:stop', versionId),
    logs: (payload) => ipcRenderer.invoke('game:logs', payload),
    openLogs: (payload) => ipcRenderer.invoke('game:openLogs', payload),
    onLog: (cb) => onEvent('game:log', cb),
    offLog: (cb) => offEvent('game:log', cb),
    onExit: (cb) => onEvent('game:exit', cb),
    offExit: (cb) => offEvent('game:exit', cb),
  },
  modloaders: {
    loaders: (mcVersion) => ipcRenderer.invoke('modloaders:loaders', mcVersion),
    install: (payload) => ipcRenderer.invoke('modloaders:install', payload),
  },
  mods: {
    search: (payload) => ipcRenderer.invoke('mods:search', payload),
    install: (payload) => ipcRenderer.invoke('mods:install', payload),
    installed: () => ipcRenderer.invoke('mods:installed'),
    versions: (id) => ipcRenderer.invoke('mods:versions', id),
    gameVersions: () => ipcRenderer.invoke('mods:game-versions'),
  },
  modpacks: {
    search: (payload) => ipcRenderer.invoke('modpacks:search', payload),
    versions: (id) => ipcRenderer.invoke('modpacks:versions', id),
    install: (payload) => ipcRenderer.invoke('modpacks:install', payload),
    create: (payload) => ipcRenderer.invoke('modpacks:create', payload),
    list: () => ipcRenderer.invoke('modpacks:list'),
    remove: (slug) => ipcRenderer.invoke('modpacks:remove', slug),
    onChanged: (cb) => onEvent('modpacks:changed', cb),
    offChanged: (cb) => offEvent('modpacks:changed', cb),
  },
  shell: {
    open: (url) => ipcRenderer.invoke('shell:open', url),
  },
  news: {
    get: (force) => ipcRenderer.invoke('news:get', force),
  },
  agreements: {
    accept: (payload) => ipcRenderer.invoke('agreements:accept', payload),
  },
  skins: {
    get: (uuid) => ipcRenderer.invoke('skins:get', uuid),
    setDefault: (uuid, style) => ipcRenderer.invoke('skins:setDefault', uuid, style),
    upload: (uuid, file, slim) => ipcRenderer.invoke('skins:upload', uuid, file, slim),
    applyB64: (uuid, b64, slim) => ipcRenderer.invoke('skins:applyB64', uuid, b64, slim),
    reset: (uuid) => ipcRenderer.invoke('skins:reset', uuid),
    pick: () => ipcRenderer.invoke('skins:pick'),
    elybyLogin: (uuid) => ipcRenderer.invoke('skins:elybyLogin', uuid),
  },
});
