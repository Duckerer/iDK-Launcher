const { app } = require('electron');
const fs = require('fs');
const path = require('path');

class Store {
  constructor() {
    this.file = null;
    this.data = {};
  }

  init() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
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
    this.save();
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
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
