const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const SENSITIVE_KEYS = ['accessToken', 'msRefreshToken'];

class Store {
  constructor() {
    this.file = null;
    this.data = {};
  }

  init() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.decryptAccounts();
    } catch {
      this.data = {};
    }
  }

  get(key, def) {
    const keys = key.split('.');
    let cur = this.data;
    for (const k of keys) {
      if (cur && typeof cur === 'object' && k in cur) cur = cur[k];
      else return def;
    }
    return cur;
  }

  set(key, value) {
    const keys = key.split('.');
    let cur = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!cur[keys[i]] || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
    if (key === 'accounts') this.data.accounts = value;
    this.save();
  }

  save() {
    if (!this.file) return;
    const toSave = JSON.parse(JSON.stringify(this.data));
    if (Array.isArray(toSave.accounts)) {
      toSave.accounts = toSave.accounts.map((a) => this.encryptAccount(a));
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(toSave, null, 2));
  }

  encryptAccount(acc) {
    if (!safeStorage.isEncryptionAvailable()) return acc;
    const out = { ...acc };
    for (const k of SENSITIVE_KEYS) {
      if (out[k] && typeof out[k] === 'string' && !out[k].startsWith('enc:')) {
        out[k] = 'enc:' + safeStorage.encryptString(out[k]).toString('base64');
      }
    }
    return out;
  }

  decryptAccounts() {
    if (!Array.isArray(this.data.accounts)) return;
    this.data.accounts = this.data.accounts.map((a) => this.decryptAccount(a));
  }

  decryptAccount(acc) {
    if (!safeStorage.isEncryptionAvailable()) return acc;
    const out = { ...acc };
    for (const k of SENSITIVE_KEYS) {
      if (out[k] && typeof out[k] === 'string' && out[k].startsWith('enc:')) {
        try {
          out[k] = safeStorage.decryptString(Buffer.from(out[k].slice(4), 'base64'));
        } catch {
          out[k] = '';
        }
      }
    }
    return out;
  }

  accounts() {
    return this.get('accounts', []);
  }

  addAccount(acc) {
    const list = this.accounts().filter((a) => a.uuid !== acc.uuid);
    list.push(acc);
    this.set('accounts', list);
  }

  removeAccount(uuid) {
    this.set(
      'accounts',
      this.accounts().filter((a) => a.uuid !== uuid)
    );
  }

  selectedAccountUuid() {
    return this.get('selectedAccount', '');
  }
}

module.exports = new Store();
