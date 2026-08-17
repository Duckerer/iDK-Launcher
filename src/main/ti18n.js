const store = require('./store');
const { resolve } = require('../common/i18n');

function tl(key, params) {
  return resolve(store.get('language', 'en') || 'en', key, params);
}

module.exports = { tl };
