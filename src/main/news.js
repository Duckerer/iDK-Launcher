const https = require('https');

const CHANNEL = 'idklauncher';
const URL = `https://t.me/s/${CHANNEL}`;
const TTL = 10 * 60 * 1000;

let cache = null;

function httpsGetText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return httpsGetText(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

function decodeEntities(s) {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseMessages(html) {
  const out = [];
  const parts = html.split('data-post="');
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    const postMatch = chunk.match(/^([\w-]+)\/(\d+)/);
    if (!postMatch) continue;
    const postId = postMatch[1] + '/' + postMatch[2];
    const textMatch = chunk.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!textMatch) continue;
    const text = decodeEntities(textMatch[1]);
    if (!text) continue;
    const timeMatch = chunk.match(/datetime="([^"]+)"/);
    out.push({ postId, text, date: timeMatch ? timeMatch[1] : '' });
    if (out.length >= 20) break;
  }
  return out;
}

async function fetchNews(force) {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.items;
  const html = await httpsGetText(URL);
  const items = parseMessages(html);
  cache = { at: Date.now(), items };
  return items;
}

module.exports = { fetchNews, CHANNEL };
