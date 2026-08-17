const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const BG_TOP = [11, 14, 26];
const BG_BOT = [30, 41, 66];
const TILES = [
  [74, 222, 128],  // accent green
  [168, 85, 247],  // purple
  [59, 130, 246],  // blue
  [239, 68, 68],   // red
];
const GAP = SIZE * 0.06;
const MARGIN = SIZE * 0.24;
const TILE = (SIZE - MARGIN * 2 - GAP) / 2;
const RADIUS = TILE * 0.22;

const table = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function inRoundRect(x, y, rx, ry, w, h, r) {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const cx = Math.max(rx + r, Math.min(x, rx + w - r));
  const cy = Math.max(ry + r, Math.min(y, ry + h - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function makeIcon() {
  const stride = SIZE * 4 + 1;
  const px = Buffer.alloc(SIZE * stride);
  let o = 0;
  const tiles = [
    [MARGIN, MARGIN, TILES[0]],
    [MARGIN + TILE + GAP, MARGIN, TILES[1]],
    [MARGIN, MARGIN + TILE + GAP, TILES[2]],
    [MARGIN + TILE + GAP, MARGIN + TILE + GAP, TILES[3]],
  ];
  for (let y = 0; y < SIZE; y++) {
    px[o++] = 0;
    const t = y / (SIZE - 1);
    const r0 = Math.round(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t);
    const g0 = Math.round(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t);
    const b0 = Math.round(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t);
    for (let x = 0; x < SIZE; x++) {
      let r = r0;
      let g = g0;
      let b = b0;
      for (const [tx, ty, c] of tiles) {
        if (inRoundRect(x, y, tx, ty, TILE, TILE, RADIUS)) {
          r = c[0];
          g = c[1];
          b = c[2];
          break;
        }
      }
      px[o++] = r;
      px[o++] = g;
      px[o++] = b;
      px[o++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(px, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png);
  console.log('wrote', out);
}

makeIcon();
