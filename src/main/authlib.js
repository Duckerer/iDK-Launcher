const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');

function jarPath() {
  return path.join(app.getPath('userData'), 'authlib-injector.jar');
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'iDK-Launcher' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return httpsGetJson(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(dest);
    https
      .get(url, { headers: { 'User-Agent': 'iDK-Launcher' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return downloadFile(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        res.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

async function ensure() {
  const jar = jarPath();
  try {
    if (fs.existsSync(jar) && fs.statSync(jar).size > 50000) return jar;
  } catch {}
  fs.mkdirSync(path.dirname(jar), { recursive: true });
  const meta = await httpsGetJson('https://authlib-injector.yushi.moe/artifact/latest.json');
  const url = meta && meta.download_url;
  if (!url) throw new Error('authlib-injector: no download url');
  await downloadFile(url, jar);
  if (!fs.existsSync(jar) || fs.statSync(jar).size < 50000) throw new Error('authlib-injector: bad jar');
  return jar;
}

module.exports = { ensure };
