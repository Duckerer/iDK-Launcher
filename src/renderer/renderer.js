const api = window.idk;
const $ = (sel) => document.querySelector(sel);

const state = {
  settings: { memory: 2048, javaPath: '', gameDir: '', msClientId: '', msRedirectUri: '', versionsCategories: ['all'], versionsInstalledOnly: false },
  accounts: [],
  selected: null,
  versions: [],
  selectedVersion: null,
  selectedPack: null,
  playTab: null,
  installing: false,
  running: false,
  currentRunId: null,
  mods: { loader: 'fabric', categories: [], features: [], impacts: [], resolutions: [], mcVersions: [], verCats: ['all'], environment: 'all', projectType: 'mod', page: 0 },
  modsGameVersions: null,
  modpacks: { categories: [], environment: 'all', loader: '', mcVersions: [], installed: [], page: 0 },
};

const TYPE_LABEL = { offline: 'login.type.offline', elyby: 'login.type.elyby', microsoft: 'login.type.microsoft' };
const TYPE_COLOR = { offline: '#64748b', elyby: '#a855f7', microsoft: '#3b82f6' };

const LANG_NAMES = { en: 'English', ru: 'Русский', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', pl: 'Polski', uk: 'Українська' };

const MODS_PAGE_SIZE = 30;

function populateLangSelects() {
  const order = ['en', 'ru'];
  const opts = Object.keys(window.__DICT || {})
    .filter((l) => LANG_NAMES[l])
    .sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return LANG_NAMES[a].localeCompare(LANG_NAMES[b]);
    })
    .map((l) => `<option value="${l}">${LANG_NAMES[l]}</option>`).join('');
  if (opts) $('#language-select').innerHTML = opts;
}

/* ---------------- entrance animations ---------------- */
function takeStagger(container) {
  const section = container ? container.closest('.view') : null;
  if (!section || section.dataset.animPending !== '1') return false;
  if (container.hasAttribute('data-anim-done')) return false;
  container.setAttribute('data-anim-done', '1');
  return true;
}
function staggerInto(el, i) {
  el.style.animation = 'cardIn 0.35s ease both';
  el.style.animationDelay = Math.min(i * 30, 420) + 'ms';
}
function modalStagger(el, i) {
  el.style.animation = 'cardIn 0.3s ease both';
  el.style.animationDelay = Math.min(i * 25, 300) + 'ms';
}

/* ---------------- background particles ---------------- */
(function bg() {
  const canvas = $('#bg-canvas');
  const ctx = canvas.getContext('2d');
  let accentHex = '#4ade80';
  window.__setBgAccent = (hex) => { accentHex = hex; };
  const blendColor = (hex, f) => {
    const n = parseInt(hex.replace('#', ''), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = f < 0 ? 0 : 255, p = Math.abs(f);
    r = Math.round((t - r) * p + r);
    g = Math.round((t - g) * p + g);
    b = Math.round((t - b) * p + b);
    return `rgb(${r},${g},${b})`;
  };
  let W, H, parts = [];
  const resize = () => {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);
  const rand = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 42; i++) {
    parts.push({
      x: rand(0, 1), y: rand(0, 1), size: rand(3, 10), spd: rand(0.0004, 0.0014),
      tint: rand(-0.2, 0.3), alpha: rand(0.04, 0.2),
    });
  }
  let last = 0;
  const tick = (t) => {
    const dt = Math.min(50, t - last) / 1000;
    last = t;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.y -= p.spd * dt;
      if (p.y < -0.05) { p.y = 1.05; p.x = rand(0, 1); }
      const a = p.alpha * (0.5 + 0.5 * Math.sin(t / 800 + p.x * 9));
      ctx.globalAlpha = a;
      ctx.fillStyle = blendColor(accentHex, p.tint);
      ctx.fillRect(p.x * W, p.y * H, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(msg, isErr = true) {
  const el = $('#toast');
  el.textContent = msg;
  el.style.borderColor = isErr ? 'rgba(239,68,68,0.5)' : 'var(--accent)';
  el.style.color = isErr ? '#fecaca' : 'var(--accent-text)';
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 5000);
}

/* ---------------- window controls ---------------- */
$('#btn-min').onclick = () => api.win.minimize();
$('#btn-max').onclick = () => api.win.toggleMaximize();
$('#btn-close').onclick = () => api.win.close();
api.win.onMaximized((m) => { $('#btn-max').innerHTML = m ? '&#10065;' : '&#x25A1;'; });

/* ---------------- nav ---------------- */
const BROWSE_VIEWS = { mods: 'mod', resourcepacks: 'resourcepack', shaders: 'shader' };
const VIEW_SECTIONS = { play: 'play', versions: 'versions', modpacks: 'modpacks', mods: 'browse', resourcepacks: 'browse', shaders: 'browse', skins: 'skins', settings: 'settings' };
function switchView(name) {
  state.currentView = name;
  document.querySelectorAll('.nav-btn').forEach((x) => x.classList.remove('active'));
  document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
  const btn = document.querySelector(`.nav-btn[data-view="${name}"]`);
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.nav-folder').forEach((f) => f.classList.toggle('active', !!btn && f.closest('.nav-group').contains(btn)));
  const group = btn ? btn.closest('.nav-group') : null;
  if (group) group.classList.add('open');
  const section = $(`#view-${VIEW_SECTIONS[name]}`);
  if (section) {
    section.classList.add('active');
    section.dataset.animPending = '1';
    section.querySelectorAll('[data-anim-done]').forEach((el) => el.removeAttribute('data-anim-done'));
  }
  if (BROWSE_VIEWS[name] !== undefined) {
    const next = BROWSE_VIEWS[name];
    if (state.mods.projectType !== next) {
      state.mods.categories = [];
      state.mods.features = [];
      state.mods.impacts = [];
      state.mods.resolutions = [];
      state.mods.loader = '';
      state.mods.mcVersions = [];
    }
    state.mods.projectType = next;
    renderBrowseHead();
    initModsView();
  }
  if (name === 'modpacks') initModpacksView();
  if (name === 'versions') loadVersions();
  if (name === 'skins') loadSkins();
  if (name === 'play') loadNews(true);
}
document.querySelectorAll('.nav-btn').forEach((b) => {
  b.onclick = () => switchView(b.dataset.view);
});
document.querySelectorAll('.nav-folder').forEach((f) => {
  f.onclick = () => {
    const group = f.closest('.nav-group');
    const willOpen = !group.classList.contains('open');
    group.classList.toggle('open', willOpen);
    if (!willOpen) f.classList.remove('active');
  };
});

/* ---------------- modals ---------------- */
function openModal(sel) {
  $('#overlay').classList.remove('hidden');
  $(sel).classList.remove('hidden');
}
let confirmPending = null;
let modpickPending = null;
function closeModals() {
  if (confirmPending) {
    const r = confirmPending;
    confirmPending = null;
    r(false);
  }
  if (modpickPending) {
    const r = modpickPending;
    modpickPending = null;
    r(null);
  }
  $('#overlay').classList.add('hidden');
  document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
  document.querySelectorAll('.login-status').forEach((s) => s.classList.add('hidden'));
}
$('#overlay').onclick = closeModals;
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeModals));

function confirmDialog(text) {
  return new Promise((resolve) => {
    confirmPending = resolve;
    $('#confirm-text').textContent = text;
    $('#btn-confirm-yes').classList.remove('hidden');
    openModal('#modal-confirm');
  });
}
$('#btn-confirm-yes').onclick = () => {
  if (confirmPending) {
    const r = confirmPending;
    confirmPending = null;
    r(true);
  }
  closeModals();
};
$('#btn-confirm-no').onclick = () => {
  if (confirmPending) {
    const r = confirmPending;
    confirmPending = null;
    r(false);
  }
  closeModals();
};

function openLogin() {
  openModal('#modal-login');
  setTimeout(() => {
    const active = document.querySelector('#login-tabs .tab.active');
    const m = active && active.dataset.method;
    if (m === 'offline') $('#offline-nick').focus();
    else if (m === 'elyby') $('#ely-user').focus();
  }, 50);
}

document.querySelectorAll('#login-tabs .tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('#login-tabs .tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $(`.tab-panel[data-panel="${t.dataset.method}"]`).classList.add('active');
  };
});

/* ---------------- accounts ---------------- */
function renderAccounts() {
  const list = $('#acc-list');
  list.innerHTML = '';
  if (!state.accounts.length) {
    list.innerHTML = `<p class="panel-hint">${t('accounts.addFirst')}</p>`;
  }
  state.accounts.forEach((a, i) => {
    const item = document.createElement('div');
    item.className = 'acc-item' + (state.selected && state.selected.uuid === a.uuid ? ' current' : '');
    modalStagger(item, i);
    item.innerHTML = `
      <div class="acc-avatar" style="background:${TYPE_COLOR[a.type] || '#64748b'}">${a.name.charAt(0).toUpperCase()}</div>
      <div>
        <div class="acc-name">${escapeHtml(a.name)}</div>
        <div class="acc-type">${t(TYPE_LABEL[a.type] || a.type)}</div>
      </div>
      <div class="acc-actions">
        <button class="use">${t('accounts.use')}</button>
        <button class="del">${t('delete')}</button>
      </div>`;
    item.querySelector('.use').onclick = async () => {
      await api.auth.select(a.uuid);
      await refreshAccounts();
      closeModals();
    };
    item.querySelector('.del').onclick = async (e) => {
      e.stopPropagation();
      await api.auth.remove(a.uuid);
      await refreshAccounts();
    };
    list.appendChild(item);
  });
}

function refreshAccounts() {
  return Promise.all([api.auth.list(), api.auth.selected()]).then(([list, sel]) => {
    state.accounts = list || [];
    state.selected = sel;
    renderAccounts();
    renderAccountChip();
    if (state.currentView === 'skins') loadSkins();
  });
}

function renderAccountChip() {
  const chip = $('#chip-account');
  const dot = chip.querySelector('.chip-dot');
  const label = chip.querySelector('.chip-label');
  if (state.selected) {
    dot.className = 'chip-dot ok';
    label.textContent = state.selected.name;
  } else {
    dot.className = 'chip-dot';
    label.textContent = t('chip.noAccount');
  }
}

$('#chip-account').onclick = () => {
  openModal('#modal-accounts');
  renderAccounts();
};
$('#btn-add-account').onclick = () => {
  closeModals();
  openLogin();
};

/* ---------------- skins & capes ---------------- */
const SKINS_HINT = { microsoft: 'skins.msHint', elyby: 'skins.elyHint', offline: 'skins.offHint' };
let pendingSkin = null;
let appliedSkin = null;
const userSkins = [];

/* ---------------- 3D skin preview ---------------- */
let skinImg = null;
let skinYaw = 0.62;
let skinPitch = 0.18;
let skinSlim = false;
let skinOverlays = {};

// Face origins (top/bottom/right/front/left/back) in the skin texture for the
// standard 64x64 layout. Legacy 64x32 skins reuse the right-side origins for
// the left limbs too and the mirror flag flips them horizontally.
const SKIN_REGIONS = {
  head:   { top: [8, 0],   bottom: [16, 0], right: [0, 8],   front: [8, 8],  left: [16, 8],  back: [24, 8] },
  hat:    { top: [40, 0],  bottom: [48, 0], right: [32, 8],  front: [40, 8], left: [48, 8],  back: [56, 8] },
  body:   { top: [20, 16], bottom: [28, 16], right: [16, 20], front: [20, 20], left: [28, 20], back: [32, 20] },
  bodyOv: { top: [20, 32], bottom: [28, 32], right: [16, 36], front: [20, 36], left: [28, 36], back: [32, 36] },
  armR:   { top: [44, 16], bottom: [48, 16], right: [40, 20], front: [44, 20], left: [48, 20], back: [52, 20] },
  armROv: { top: [44, 32], bottom: [48, 32], right: [40, 36], front: [44, 36], left: [48, 36], back: [52, 36] },
  armL:   { top: [36, 48], bottom: [40, 48], right: [32, 52], front: [36, 52], left: [40, 52], back: [44, 52] },
  armLOv: { top: [52, 48], bottom: [56, 48], right: [48, 52], front: [52, 52], left: [56, 52], back: [60, 52] },
  legR:   { top: [4, 16],  bottom: [8, 16],  right: [0, 20],  front: [4, 20],  left: [8, 20],  back: [12, 20] },
  legROv: { top: [4, 32],  bottom: [8, 32],  right: [0, 36],  front: [4, 36],  left: [8, 36],  back: [12, 36] },
  legL:   { top: [20, 48], bottom: [24, 48], right: [16, 52], front: [20, 52], left: [24, 52], back: [28, 52] },
  legLOv: { top: [4, 48],  bottom: [8, 48],  right: [0, 52],  front: [4, 52],  left: [8, 52],  back: [12, 52] },
};

// Minecraft box geometry. cx/cy/cz = box centre, dx/dy/dz = half sizes.
// Overlay boxes (hat/jacket/sleeves) are grown by `grow` from the base box.
function skinParts(slim, is64x64) {
  const armDx = slim ? 1.5 : 2;
  const P = [
    { key: 'head', cx: 0, cy: 12, cz: 0, dx: 4, dy: 4, dz: 4, base: 'head', ov: 'hat', grow: 0.5 },
    { key: 'body', cx: 0, cy: 2, cz: 0, dx: 4, dy: 6, dz: 2, base: 'body', ov: 'bodyOv', grow: 0.25 },
    { key: 'armR', cx: -5, cy: 2, cz: 0, dx: armDx, dy: 6, dz: 2, base: 'armR', ov: 'armROv', grow: 0.25 },
    { key: 'armL', cx: 5, cy: 2, cz: 0, dx: armDx, dy: 6, dz: 2, base: 'armL', ov: 'armLOv', grow: 0.25 },
    { key: 'legR', cx: -2, cy: -10, cz: 0, dx: 2, dy: 6, dz: 2, base: 'legR', ov: 'legROv', grow: 0.25 },
    { key: 'legL', cx: 2, cy: -10, cz: 0, dx: 2, dy: 6, dz: 2, base: 'legL', ov: 'legLOv', grow: 0.25 },
  ];
  const parts = [];
  for (const p of P) {
    const leftLegacy = !is64x64 && (p.key === 'armL' || p.key === 'legL');
    const baseReg = leftLegacy ? SKIN_REGIONS[p.key === 'armL' ? 'armR' : 'legR'] : SKIN_REGIONS[p.base];
    parts.push(boxFaces(p, baseReg, !!leftLegacy, 0));
    if (skinOverlays[p.ov]) parts.push(boxFaces(p, SKIN_REGIONS[p.ov], false, p.grow));
  }
  return parts;
}

function boxFaces(p, faces, mirror, grow) {
  const dx = p.dx, dy = p.dy, dz = p.dz;
  const gx = dx + grow, gy = dy + grow, gz = dz + grow;
  const cx = p.cx, cy = p.cy, cz = p.cz;
  const out = [];
  // Corner points (local box space): front is +z, back is -z, right is +x.
  const bfl = [cx - gx, cy - gy, cz + gz], bfr = [cx + gx, cy - gy, cz + gz];
  const bbl = [cx - gx, cy - gy, cz - gz], bbr = [cx + gx, cy - gy, cz - gz];
  const tfl = [cx - gx, cy + gy, cz + gz], tfr = [cx + gx, cy + gy, cz + gz];
  const tbl = [cx - gx, cy + gy, cz - gz], tbr = [cx + gx, cy + gy, cz - gz];
  // UVs follow the standard Minecraft unwrap: texture v grows downward (top of
  // the part at region top), u grows right; top/bottom faces are rotated so the
  // front edge sits at the bottom/top of the region respectively.
  const add = (pts, normal, R, uvs) => {
    const horizontal = R === faces.top || R === faces.bottom;
    const sw = horizontal ? 2 * dx : R === faces.right || R === faces.left ? 2 * dz : 2 * dx;
    const sh = horizontal ? 2 * dz : 2 * dy;
    out.push({ pts, normal, mirror, reg: { sx: R[0], sy: R[1], sw, sh }, uv: uvs });
  };
  // top: back edge at v=0, front edge at v=1
  add([tbl, tbr, tfr, tfl], [0, 1, 0], faces.top, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  // bottom: front edge at v=0, back edge at v=1
  add([bfl, bfr, bbr, bbl], [0, -1, 0], faces.bottom, [[0, 1], [1, 1], [1, 0], [0, 0]]);
  // front: top at v=0
  add([bfl, bfr, tfr, tfl], [0, 0, 1], faces.front, [[0, 1], [1, 1], [1, 0], [0, 0]]);
  // back: top at v=0
  add([bbl, bbr, tbr, tbl], [0, 0, -1], faces.back, [[0, 1], [1, 1], [1, 0], [0, 0]]);
  // right (+x): u=0 is the front edge
  add([bfr, bbr, tbr, tfr], [1, 0, 0], faces.right, [[0, 1], [1, 1], [1, 0], [0, 0]]);
  // left (-x): u=0 is the front edge
  add([bfl, bbl, tbl, tfl], [-1, 0, 0], faces.left, [[0, 1], [1, 1], [1, 0], [0, 0]]);
  return out;
}

function skinTriMatrix(p0, p1, p2, A, B, C) {
  const u0 = A[0], v0 = A[1], u1 = B[0], v1 = B[1], u2 = C[0], v2 = C[1];
  const x0 = p0.x, y0 = p0.y, x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
  const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
  if (det === 0) return null;
  const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det;
  const c = ((u1 - u0) * (x2 - x0) - (u2 - u0) * (x1 - x0)) / det;
  const e = x0 - a * u0 - c * v0;
  const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det;
  const d = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
  const f = y0 - b * u0 - d * v0;
  return [a, b, c, d, e, f];
}

function skinDrawTri(ctx, img, p0, p1, p2, A, B, C) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.closePath();
  ctx.clip();
  const m = skinTriMatrix(p0, p1, p2, A, B, C);
  if (m) {
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, img.width, img.height);
  }
  ctx.restore();
}

function skinDrawQuad(ctx, img, face) {
  const { pts, uv, reg, mirror } = face;
  const pix = (u, v) => [
    (mirror ? reg.sx + reg.sw - u * reg.sw : reg.sx + u * reg.sw),
    reg.sy + v * reg.sh,
  ];
  const A = pix(uv[0][0], uv[0][1]);
  const B = pix(uv[1][0], uv[1][1]);
  const C = pix(uv[2][0], uv[2][1]);
  const D = pix(uv[3][0], uv[3][1]);
  skinDrawTri(ctx, img, pts[0], pts[1], pts[3], A, B, D);
  skinDrawTri(ctx, img, pts[1], pts[2], pts[3], B, C, D);
}

function renderSkin3D() {
  const canvas = $('#skins-preview');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!skinImg) return;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const D = 28;
  const f = 190;
  const cyaw = Math.cos(skinYaw);
  const syaw = Math.sin(skinYaw);
  const cpit = Math.cos(skinPitch);
  const spit = Math.sin(skinPitch);
  // Camera sits on the +z side looking toward -z, so the character's front
  // (+z faces) faces the viewer at yaw=0. Faces pointing toward the camera
  // (rotated normal z > 0) are drawn; the rest are back-face culled.
  const proj = (px, py, pz) => {
    let x = px * cyaw + pz * syaw;
    let z = -px * syaw + pz * cyaw;
    const y = py * cpit - z * spit;
    z = py * spit + z * cpit;
    const s = f / (D - z);
    return { x: cx + x * s, y: cy - y * s, z };
  };
  const rotZ = (nx, ny, nz) => {
    let z = -nx * syaw + nz * cyaw;
    const y = ny * cpit - z * spit;
    z = ny * spit + z * cpit;
    return z;
  };
  const faces = [];
  for (const part of skinParts(skinSlim, skinImg.height >= 64)) {
    for (const face of part) {
      if (rotZ(face.normal[0], face.normal[1], face.normal[2]) <= 0) continue;
      face.pts = face.pts.map((p) => proj(p[0], p[1], p[2]));
      const z = (face.pts[0].z + face.pts[1].z + face.pts[2].z + face.pts[3].z) / 4;
      faces.push({ z, face });
    }
  }
  faces.sort((a, b) => a.z - b.z);
  for (const fa of faces) {
    skinDrawQuad(ctx, skinImg, fa.face);
  }
}

function setSkinPreview(src, model) {
  const canvas = $('#skins-preview');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!src) {
    skinImg = null;
    skinOverlays = {};
    return;
  }
  const img = new Image();
  img.onload = () => {
    skinImg = img;
    const flag = model === 'slim' ? true : model === 'classic' ? false : autoSlim(img);
    setSkinModel(flag, true);
    computeSkinOverlays(img);
    renderSkin3D();
  };
  img.onerror = () => {
    $('#skins-prev-label').textContent = t('skins.noSkin');
  };
  img.src = src;
}

function setSkinModel(slim, silent) {
  skinSlim = !!slim;
  document.querySelectorAll('#skins-model .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.model === (skinSlim ? 'slim' : 'classic'));
  });
  if (!silent && skinImg) renderSkin3D();
}

function autoSlim(img) {
  if (img.height < 64) return false;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  try {
    const d = g.getImageData(47, 20, 1, 12).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
    return true;
  } catch {
    return false;
  }
}

function computeSkinOverlays(img) {
  skinOverlays = {};
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const has = (rects) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (const [x, y, w, h] of rects) {
      if (y + h > img.height) return false;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
    }
    const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
    return false;
  };
  const faceRects = (R, dx, dy, dz) => [
    [R.top[0], R.top[1], 2 * dx, 2 * dz],
    [R.bottom[0], R.bottom[1], 2 * dx, 2 * dz],
    [R.front[0], R.front[1], 2 * dx, 2 * dy],
    [R.back[0], R.back[1], 2 * dx, 2 * dy],
    [R.right[0], R.right[1], 2 * dz, 2 * dy],
    [R.left[0], R.left[1], 2 * dz, 2 * dy],
  ];
  const armDx = skinSlim ? 1.5 : 2;
  skinOverlays.hat = has(faceRects(SKIN_REGIONS.hat, 4, 4, 4));
  skinOverlays.bodyOv = has(faceRects(SKIN_REGIONS.bodyOv, 4, 6, 2));
  skinOverlays.armROv = has(faceRects(SKIN_REGIONS.armROv, armDx, 6, 2));
  skinOverlays.armLOv = has(faceRects(SKIN_REGIONS.armLOv, armDx, 6, 2));
  skinOverlays.legROv = has(faceRects(SKIN_REGIONS.legROv, 2, 6, 2));
  skinOverlays.legLOv = has(faceRects(SKIN_REGIONS.legLOv, 2, 6, 2));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

// Convert a skin image between classic and slim models. Returns a base64 PNG
// when a conversion was performed, or null when the image already matches the
// requested model.
function convertSkinModel(img, toSlim) {
  let src = img;
  let isSlim = img.height >= 64 && autoSlim(img);
  if (img.height < 64) {
    if (!toSlim) return null;
    src = upgradeLegacy(img);
    isSlim = false;
  }
  if (isSlim === toSlim) return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0);
  const FACES = [
    [44, 16, 4, 4], [48, 16, 4, 4], [40, 20, 4, 12], [44, 20, 4, 12], [48, 20, 4, 12], [52, 20, 4, 12],
    [44, 32, 4, 4], [48, 32, 4, 4], [40, 36, 4, 12], [44, 36, 4, 12], [48, 36, 4, 12], [52, 36, 4, 12],
    [36, 48, 4, 4], [40, 48, 4, 4], [32, 52, 4, 12], [36, 52, 4, 12], [40, 52, 4, 12], [44, 52, 4, 12],
    [52, 48, 4, 4], [56, 48, 4, 4], [48, 52, 4, 12], [52, 52, 4, 12], [56, 52, 4, 12], [60, 52, 4, 12],
  ];
  for (const [x, y, , h] of FACES) {
    if (toSlim) {
      g.clearRect(x + 3, y, 1, h);
    } else {
      const col = document.createElement('canvas');
      col.width = 1;
      col.height = h;
      const cg = col.getContext('2d');
      cg.drawImage(c, x + 2, y, 1, h, 0, 0, 1, h);
      g.drawImage(col, 0, 0, 1, h, x + 3, y, 1, h);
    }
  }
  return c.toDataURL('image/png').split(',')[1];
}

// Expand a legacy 64x32 skin to 64x64 by mirroring the right arm/leg textures
// into the left slots (used when converting to the slim model).
function upgradeLegacy(img) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  const mirror = (sx, sy, w, h, tx, ty) => {
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const tg = tmp.getContext('2d');
    tg.imageSmoothingEnabled = false;
    tg.translate(w, 0);
    tg.scale(-1, 1);
    tg.drawImage(img, sx, sy, w, h, 0, 0, w, h);
    g.drawImage(tmp, tx, ty);
  };
  mirror(44, 16, 4, 4, 36, 48);
  mirror(48, 16, 4, 4, 40, 48);
  mirror(40, 20, 4, 12, 40, 52);
  mirror(44, 20, 4, 12, 36, 52);
  mirror(48, 20, 4, 12, 32, 52);
  mirror(52, 20, 4, 12, 44, 52);
  mirror(4, 16, 4, 4, 20, 48);
  mirror(8, 16, 4, 4, 24, 48);
  mirror(0, 20, 4, 12, 24, 52);
  mirror(4, 20, 4, 12, 20, 52);
  mirror(8, 20, 4, 12, 16, 52);
  mirror(12, 20, 4, 12, 28, 52);
  return c;
}

let skinDragging = false;
let skinLastX = 0;
let skinLastY = 0;
$('#skins-preview').onmousedown = (e) => {
  skinDragging = true;
  skinLastX = e.clientX;
  skinLastY = e.clientY;
  $('#skins-preview').classList.add('dragging');
};
window.addEventListener('mousemove', (e) => {
  if (!skinDragging) return;
  skinYaw += (e.clientX - skinLastX) * 0.01;
  skinPitch = Math.max(-1.0, Math.min(1.0, skinPitch + (e.clientY - skinLastY) * 0.01));
  skinLastX = e.clientX;
  skinLastY = e.clientY;
  renderSkin3D();
});
window.addEventListener('mouseup', () => {
  skinDragging = false;
  $('#skins-preview').classList.remove('dragging');
});

async function loadSkins() {
  if (!state.selected) {
    $('#skins-status').classList.remove('hidden', 'ok');
    $('#skins-status').textContent = t('skins.noAccount');
    $('#skins-acc-chips').innerHTML = '';
    return;
  }
  pendingSkin = null;
  $('#skins-apply').classList.add('hidden');
  renderSkinAccounts();
  renderSkinGallery();
  $('#skins-acc-chips').querySelectorAll('.acc-chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.uuid === state.selected.uuid);
  });
  const st = $('#skins-status');
  st.classList.remove('hidden', 'ok');
  st.textContent = t('skins.loading');
  const res = await api.skins.get(state.selected.uuid);
  if (!res.ok) {
    st.classList.add('hidden');
    return toast(res.error);
  }
  st.classList.add('hidden');
  if (appliedSkin) {
    const a = appliedSkin;
    appliedSkin = null;
    setSkinPreview(a.src, a.model);
    $('#skins-prev-label').textContent = t('skins.current');
  } else if (res.skinUrl) {
    const v = res.variant;
    setSkinPreview(res.skinUrl, v === 'SLIM' || v === 'slim' ? 'slim' : v === 'CLASSIC' || v === 'classic' ? 'classic' : null);
    $('#skins-prev-label').textContent = t('skins.current');
  } else {
    setSkinPreview(null);
    $('#skins-prev-label').textContent = t('skins.default');
  }
  const type = state.selected.type || 'offline';
  $('#skins-hint').textContent = t(SKINS_HINT[type] || 'skins.offHint');
}

function renderSkinAccounts() {
  const box = $('#skins-acc-chips');
  box.innerHTML = '';
  state.accounts.forEach((a) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'acc-chip' + (state.selected && state.selected.uuid === a.uuid ? ' active' : '');
    chip.dataset.uuid = a.uuid;
    chip.innerHTML = `<span class="acc-chip-dot" style="background:${TYPE_COLOR[a.type] || '#64748b'}"></span>${escapeHtml(a.name)}`;
    chip.onclick = async () => {
      await api.auth.select(a.uuid);
      await refreshAccounts();
      loadSkins();
    };
    box.appendChild(chip);
  });
}

function skinsStatus(text, isOk) {
  const st = $('#skins-status');
  if (!text) {
    st.classList.add('hidden');
    return;
  }
  st.classList.remove('hidden');
  st.classList.toggle('ok', !!isOk);
  st.textContent = text;
}

async function skinsAction(fn, okMsg, previewSrc) {
  if (!state.selected) return toast(t('skins.noAccount'));
  skinsStatus(t('skins.loading'));
  let res = await fn(state.selected.uuid);
  if (res && res.errorCode === 'elybyLoginNeeded') {
    skinsStatus(t('skins.elyAuthing'));
    const login = await api.skins.elybyLogin(state.selected.uuid);
    if (!login.ok) {
      skinsStatus('');
      return toast(login.error);
    }
    skinsStatus(t('skins.loading'));
    res = await fn(state.selected.uuid);
  }
  skinsStatus('');
  if (!res.ok) return toast(res.error);
  if (res.cancelled) return;
  if (okMsg) toast(okMsg, false);
  if (previewSrc) {
    setSkinPreview(previewSrc);
    $('#skins-prev-label').textContent = t('skins.current');
  }
  loadSkins();
  return res;
}

function renderSkinGallery() {
  const row = $('#skins-gallery');
  if (!row) return;
  row.innerHTML = '';
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'gallery-card gallery-add';
  plus.title = t('skins.upload');
  plus.innerHTML = '<span class="gallery-add-icon">+</span><span>' + escapeHtml(t('skins.upload')) + '</span>';
  plus.onclick = () => onUploadSkin();
  row.appendChild(plus);
  const anim = takeStagger(row);
  const all = [...userSkins, ...(window.DEFAULT_SKINS || [])];
  let idx = 0;
  all.forEach((s) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'gallery-card' + (s.user ? ' gallery-user' : '');
    if (anim) staggerInto(card, idx);
    idx++;
    card.title = t(s.name);
    card.innerHTML =
      `<img src="data:image/png;base64,${s.b64}" alt="" />` +
      `<span class="${s.user ? 'gallery-name' : ''}">${escapeHtml(t(s.name))}</span>`;
    card.onclick = () => {
      const dataUrl = 'data:image/png;base64,' + s.b64;
      pendingSkin = { b64: s.b64, src: dataUrl, model: s.model };
      setSkinPreview(dataUrl, s.model === 'slim' ? 'slim' : 'classic');
      $('#skins-prev-label').textContent = t('skins.preview');
      $('#skins-apply').classList.remove('hidden');
    };
    if (s.user) {
      const nm = card.querySelector('.gallery-name');
      nm.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.maxLength = 24;
        inp.value = t(s.name) === s.name ? s.name : '';
        inp.placeholder = t('skins.mySkin');
        inp.className = 'gallery-name-input';
        nm.replaceWith(inp);
        inp.focus();
        inp.select();
        const commit = () => {
          const v = inp.value.trim();
          s.name = v ? v : 'skins.mySkin';
          renderSkinGallery();
        };
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') commit();
          else if (ev.key === 'Escape') renderSkinGallery();
        });
        inp.addEventListener('blur', commit);
      });
    }
    row.appendChild(card);
  });
}

function applyPending() {
  if (!pendingSkin) return;
  const p = pendingSkin;
  pendingSkin = null;
  $('#skins-apply').classList.add('hidden');
  (async () => {
    let b64 = p.b64;
    try {
      const img = await loadImage(p.src);
      const converted = convertSkinModel(img, p.model === 'slim');
      if (converted) b64 = converted;
    } catch {}
    const dataUrl = 'data:image/png;base64,' + b64;
    appliedSkin = { src: dataUrl, model: p.model };
    const res = await skinsAction((u) => api.skins.applyB64(u, b64, p.model === 'slim'), t('skins.setOk'), dataUrl);
    if (!res || !res.ok) appliedSkin = null;
    if (res && res.ok && p.addToGallery) addUserSkin(p);
  })();
}

function addUserSkin(p) {
  userSkins.unshift({ id: 'user-' + Date.now(), name: 'skins.mySkin', model: p.model, b64: p.b64, user: true });
  renderSkinGallery();
}

document.querySelectorAll('#skins-model .seg-btn').forEach((b) => {
  b.addEventListener('click', () => setSkinModel(b.dataset.model === 'slim'));
});

$('#btn-manage-skin').onclick = () => {
  closeModals();
  switchView('skins');
};
async function onUploadSkin() {
  if (!state.selected) return toast(t('skins.noAccount'));
  skinsStatus(t('skins.loading'));
  const res = await api.skins.pick();
  if (!res.ok) {
    skinsStatus('');
    return toast(res.error);
  }
  if (res.cancelled) {
    skinsStatus('');
    return;
  }
  skinsStatus('');
  let model = 'classic';
  try {
    const img = await loadImage(res.dataUrl);
    model = autoSlim(img) ? 'slim' : 'classic';
  } catch {}
  pendingSkin = { b64: res.dataUrl.split(',')[1], src: res.dataUrl, model, addToGallery: true };
  setSkinPreview(res.dataUrl, model);
  $('#skins-prev-label').textContent = t('skins.preview');
  $('#skins-apply').classList.remove('hidden');
}
$('#skins-apply').onclick = () => applyPending();
$('#skins-reset').onclick = () => skinsAction((u) => api.skins.reset(u), t('skins.resetOk'));

/* ---------------- auth actions ---------------- */
$('#btn-offline-go').onclick = async () => {
  const nick = $('#offline-nick').value;
  const btn = $('#btn-offline-go');
  btn.disabled = true;
  const res = await api.auth.offline(nick);
  btn.disabled = false;
  if (!res.ok) return toast(res.error);
  closeModals();
  await refreshAccounts();
  toast(t('login.loggedInAs', { name: res.account.name }), false);
};

$('#btn-elyby-go').onclick = async () => {
  const u = $('#ely-user').value.trim();
  const p = $('#ely-pass').value;
  const btn = $('#btn-elyby-go');
  btn.disabled = true;
  const res = await api.auth.elyby(u, p);
  btn.disabled = false;
  if (!res.ok) return toast(res.error);
  closeModals();
  await refreshAccounts();
  toast(t('login.loggedInAs', { name: res.account.name }), false);
};

$('#btn-ms-go').onclick = async () => {
  const btn = $('#btn-ms-go');
  const status = $('#ms-status');
  btn.disabled = true;
  status.classList.remove('hidden');
  status.textContent = t('login.opening');
  api.auth.onStatus((s) => (status.textContent = s));
  const res = await api.auth.microsoft();
  btn.disabled = false;
  if (!res.ok) {
    status.textContent = '';
    status.classList.add('hidden');
    return toast(res.error);
  }
  closeModals();
  await refreshAccounts();
  toast(t('login.loggedInAs', { name: res.account.name }), false);
};

/* ---------------- versions ---------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtCount(n) {
  return Number(n || 0).toLocaleString(window.__getLang() === 'ru' ? 'ru-RU' : 'en-US');
}

function typeBadge(type) {
  const t = type || 'custom';
  const map = { release: 'release', snapshot: 'snapshot', old_beta: 'old', old_alpha: 'old', custom: 'custom' };
  return `<span class="badge ${map[t] || 'custom'}">${t.replace('_', ' ')}</span>`;
}

const CATEGORIES = [
  { id: 'all', label: 'cat.all' },
  { id: 'release', label: 'cat.release' },
  { id: 'snapshot', label: 'cat.snapshot' },
  { id: 'april', label: 'cat.april' },
  { id: 'old_beta', label: 'cat.old_beta' },
  { id: 'old_alpha', label: 'cat.old_alpha' },
];

const APRIL_FOOLS_IDS = new Set([
  '3D Shareware v1.34',
  '1.RV-Pre1',
  '15w14a',
  '20w14infinite',
  '22w13oneblockatatime',
  '23w13a_or_b',
  '24w14potato',
  '25w14craftmine',
]);

function isAprilFools(v) {
  return APRIL_FOOLS_IDS.has(v.id);
}

function versionCategory(v) {
  if (isAprilFools(v)) return 'april';
  if (v.type === 'release') return 'release';
  if (v.type === 'old_beta') return 'old_beta';
  if (v.type === 'old_alpha') return 'old_alpha';
  return 'snapshot';
}

function renderCategories() {
  const bar = $('#cat-bar');
  if (!bar) return;
  const selected = Array.isArray(state.settings.versionsCategories) ? state.settings.versionsCategories : ['all'];
  bar.innerHTML = '';
  for (const c of CATEGORIES) {
    const count =
      c.id === 'all'
        ? state.versions.length
        : state.versions.filter((v) => versionCategory(v) === c.id).length;
    const btn = document.createElement('button');
    btn.className = 'cat-btn' + (selected.includes(c.id) ? ' active' : '');
    btn.innerHTML = `${t(c.label)} <span class="cat-count">${count}</span>`;
    btn.onclick = () => {
      let next;
      if (c.id === 'all') {
        next = ['all'];
      } else {
        const hasAll = selected.includes('all');
        const set = new Set(hasAll ? [] : selected);
        if (set.has(c.id)) set.delete(c.id);
        else set.add(c.id);
        next = set.size ? [...set] : ['all'];
      }
      state.settings.versionsCategories = next;
      api.settings.set('versions.categories', next);
      renderCategories();
      renderVersionGrid();
    };
    bar.appendChild(btn);
  }
}

async function refreshVersions() {
  const data = await api.versions.list();
  state.versions = data.list || [];
  renderCategories();
  renderVersionGrid();
  renderModsVersions();
  restoreSelection();
}

async function loadVersions() {
  const grid = $('#version-grid');
  grid.innerHTML = `<p class="panel-hint">${t('versions.loading')}</p>`;
  try {
    await refreshVersions();
  } catch (e) {
    grid.innerHTML = `<p class="panel-hint">${t('versions.loadError', { error: escapeHtml(e.message) })}</p>`;
  }
}

api.versions.onChanged(() => {
  if (state.installing) return;
  refreshVersions().catch(() => {});
});

function renderVersionGrid() {
  const grid = $('#version-grid');
  const q = $('#search-versions').value.trim().toLowerCase();
  const cats = Array.isArray(state.settings.versionsCategories) ? state.settings.versionsCategories : ['all'];
  const installedOnly = !!state.settings.versionsInstalledOnly;
  const list = state.versions.filter((v) => {
    if (!cats.includes('all') && !cats.includes(versionCategory(v))) return false;
    if (installedOnly && !v.installed) return false;
    return !q || v.id.toLowerCase().includes(q);
  });
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = `<p class="panel-hint">${t('mods.none')}</p>`;
    return;
  }
  const anim = takeStagger(grid);
  let idx = 0;
  for (const v of list) {
    const card = document.createElement('div');
    card.className = 'version-card' + (state.selectedVersion && state.selectedVersion.id === v.id ? ' current' : '');
    card.innerHTML = `
      <div class="version-id">${escapeHtml(v.id)}</div>
      <div class="version-meta">${typeBadge(v.type)}</div>
      <div class="version-actions">
        <button class="btn-ghost ${v.installed ? 'done' : ''}" data-action="${v.installed ? 'play' : 'install'}">
          ${v.installed ? t('installed') : t('download')}
        </button>
        ${v.installed ? `<button class="btn-del" data-action="delete">${t('delete')}</button>` : ''}
      </div>`;
    if (anim) staggerInto(card, idx);
    idx++;
    card.querySelector('[data-action="play"], [data-action="install"]').onclick = async () => {
      if (v.installed) {
        selectVersion(v);
        closeModals();
      } else {
        await installVersion(v);
      }
    };
    if (v.installed) {
      card.querySelector('[data-action="delete"]').onclick = async (e) => {
        e.stopPropagation();
        await deleteVersion(v);
      };
    }
    grid.appendChild(card);
  }
}

$('#search-versions').oninput = () => renderVersionGrid();

async function deleteVersion(v) {
  const ok = await confirmDialog(t('versions.confirmDelete', { id: v.id }));
  if (!ok) return;
  const res = await api.versions.delete(v.id);
  if (!res.ok) return toast(res.error);
  toast(t('versions.deleted', { id: v.id }), false);
  if (state.selectedVersion && state.selectedVersion.id === v.id) {
    state.selectedVersion = null;
    renderSelectChip();
  }
  refreshVersions().catch(() => {});
}

async function installVersion(v) {
  if (state.installing) return toast(t('toast.anotherInstall'));
  state.installing = true;
  closeModals();
  setPlayBusy(true, t('installing.version', { id: v.id }));
  showStatus(t('downloading'), 0);
  const res = await api.versions.install(v.id, v.url);
  if (res.ok) {
    v.installed = true;
    selectVersion(v);
    renderVersionGrid();
    toast(t('versions.installed', { id: v.id }), false);
  } else {
    toast(res.error);
  }
  state.installing = false;
  setPlayBusy(false, state.running ? t('play.running') : t('play'));
  showStatus(null);
}

/* ---------------- version picking ---------------- */
function selectVersion(v) {
  state.selectedVersion = v;
  if (state.selectedPack) {
    state.selectedPack = null;
    api.settings.set('lastModpack', '');
  }
  renderSelectChip();
  api.settings.set('lastVersion', v ? v.id : '');
}

function renderVerpick(container) {
  const list = container || $('#play-picker-list');
  const installed = state.versions.filter((v) => v.installed);
  list.innerHTML = '';
  if (!installed.length) {
    list.innerHTML = `<p class="panel-hint">${t('versions.verpickNone')}</p>`;
    return;
  }
  let idx = 0;
  for (const v of installed) {
    const item = document.createElement('button');
    item.className = 'verpick-item' + (state.selectedVersion && state.selectedVersion.id === v.id ? ' current' : '');
    item.innerHTML = `<span class="verpick-id">${escapeHtml(v.id)}</span>${typeBadge(v.type)}`;
    modalStagger(item, idx++);
    item.onclick = () => {
      selectVersion(v);
      closeModals();
      closePicker();
    };
    list.appendChild(item);
  }
}

/* ---------------- modpack picking (play tab) ---------------- */
function selectPack(p) {
  state.selectedPack = p;
  if (state.selectedVersion) {
    state.selectedVersion = null;
    api.settings.set('lastVersion', '');
  }
  renderSelectChip();
  api.settings.set('lastModpack', p ? p.slug : '');
}

function restoreSelection() {
  const lp = state.settings.lastModpack;
  if (lp && !state.selectedPack) {
    const p = state.modpacks.installed.find((x) => x.slug === lp);
    if (p) { selectPack(p); return; }
  }
  const lv = state.settings.lastVersion;
  if (lv && !state.selectedVersion) {
    const v = state.versions.find((x) => x.id === lv);
    if (v) selectVersion(v);
  }
}

function renderSelectChip() {
  const label = $('#chip-select-label');
  const dot = $('#chip-select-dot');
  if (state.selectedPack) {
    label.textContent = state.selectedPack.name;
    dot.className = 'chip-dot pack';
  } else if (state.selectedVersion) {
    label.textContent = state.selectedVersion.id;
    dot.className = 'chip-dot version';
  } else {
    label.textContent = t('chip.selectVersionOrPack');
    dot.className = 'chip-dot';
  }
}

function renderTabs() {
  $('#tab-version').classList.toggle('active', state.playTab === 'version');
  $('#tab-modpack').classList.toggle('active', state.playTab === 'modpack');
  const btn = $('#btn-pick-install');
  if (btn) btn.textContent = t(state.playTab === 'modpack' ? 'play.installPacks' : 'play.installVersions');
}

function renderPackpick(container) {
  const list = container || $('#play-picker-list');
  list.innerHTML = '';
  const none = document.createElement('button');
  none.className = 'verpick-item' + (!state.selectedPack ? ' current' : '');
  none.innerHTML = `<span class="verpick-id">${t('chip.noModpack')}</span>`;
  none.onclick = () => {
    selectPack(null);
    closeModals();
    closePicker();
  };
  list.appendChild(none);
  const packs = state.modpacks.installed;
  if (!packs.length) {
    const hint = document.createElement('p');
    hint.className = 'panel-hint';
    hint.textContent = t('modpacks.none');
    list.appendChild(hint);
  }
  let idx = 0;
  for (const p of packs) {
    const it = document.createElement('button');
    it.className = 'verpick-item' + (state.selectedPack && state.selectedPack.slug === p.slug ? ' current' : '');
    it.innerHTML = `<span class="verpick-id">${escapeHtml(p.name)}</span><span class="verpick-meta">MC ${escapeHtml(p.mc)}${p.loader ? ' · ' + escapeHtml(p.loader) : ''}</span>`;
    modalStagger(it, idx++);
    it.onclick = () => {
      selectPack(p);
      closeModals();
      closePicker();
    };
    list.appendChild(it);
  }
}

function renderPlayPicker() {
  if (state.playTab === 'version') renderVerpick();
  else if (state.playTab === 'modpack') renderPackpick();
}

function closePicker() {
  state.playTab = null;
  closeModals();
  renderTabs();
}

function togglePicker() {
  if (!state.playTab) state.playTab = 'version';
  openModal('#modal-pick');
  renderTabs();
  renderPlayPicker();
}

function switchPickerTab(tab) {
  state.playTab = tab;
  if (tab === 'modpack') loadInstalledPacks();
  renderTabs();
  renderPlayPicker();
}

$('#chip-select').onclick = () => togglePicker();
$('#tab-version').onclick = () => switchPickerTab('version');
$('#tab-modpack').onclick = () => switchPickerTab('modpack');
$('#btn-pick-install').onclick = () => {
  const tab = state.playTab === 'modpack' ? 'modpacks' : 'versions';
  closeModals();
  switchView(tab);
};

$('#chk-installed-only').onclick = (e) => {
  const on = e.currentTarget.getAttribute('aria-checked') !== 'true';
  e.currentTarget.setAttribute('aria-checked', String(on));
  state.settings.versionsInstalledOnly = on;
  api.settings.set('versions.installedOnly', on);
  renderVersionGrid();
};

/* ---------------- modloaders ---------------- */
const LOADER_TYPES = [
  { id: 'fabric', label: 'Fabric' },
  { id: 'quilt', label: 'Quilt' },
  { id: 'legacy-fabric', label: 'Legacy Fabric' },
  { id: 'forge', label: 'Forge' },
  { id: 'neoforge', label: 'NeoForge' },
];

$('#btn-modloader').onclick = () => {
  openModal('#modal-modloader');
  initModloaderModal();
};

function initModloaderModal() {
  const mcSel = $('#ml-mc');
  mcSel.innerHTML = '';
  for (const v of state.versions) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.id;
    mcSel.appendChild(opt);
  }
  if (!mcSel.options.length) {
    mcSel.innerHTML = `<option value="">${t('ml.noAvailable')}</option>`;
    return;
  }
  mcSel.value = state.selectedVersion ? state.selectedVersion.id : mcSel.options[0].value;

  const typeBox = $('#ml-type');
  typeBox.innerHTML = '';
  state.mlType = 'fabric';
  for (const t of LOADER_TYPES) {
    const b = document.createElement('button');
    b.className = 'loader-type-btn' + (t.id === state.mlType ? ' active' : '');
    b.textContent = t.label;
    b.onclick = () => {
      state.mlType = t.id;
      typeBox.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      loadLoaderVersions();
    };
    typeBox.appendChild(b);
  }
  loadLoaderVersions();
}

async function loadLoaderVersions() {
  const mc = $('#ml-mc').value;
  const sel = $('#ml-loader-version');
  const hint = $('.ml-hint');
  sel.disabled = true;
  sel.innerHTML = '';
  if (!mc) {
    hint.textContent = t('ml.selectMc');
    return;
  }
  hint.textContent = t('ml.loading');
  const res = await api.modloaders.loaders(mc);
  const ldr = (res.loaders || []).find((l) => l.loader === state.mlType);
  if (!res.ok || !ldr || !ldr.versions.length) {
    hint.textContent = t('ml.unavailable');
    return;
  }
  const vs = ldr.versions.slice().sort((a, b) => (b.stable ? 1 : 0) - (a.stable ? 1 : 0));
  for (const v of vs) {
    const opt = document.createElement('option');
    opt.value = v.version;
    opt.textContent = v.version + (v.stable ? t('ml.stable') : '');
    sel.appendChild(opt);
  }
  sel.disabled = false;
  hint.textContent = '';
}

$('#ml-mc').onchange = loadLoaderVersions;

$('#btn-ml-install').onclick = async () => {
  const mc = $('#ml-mc').value;
  const lv = $('#ml-loader-version').value;
  const type = state.mlType;
  if (!mc || !lv) return toast(t('ml.selectVersion'));
  const btn = $('#btn-ml-install');
  btn.disabled = true;
  state.installing = true;
  closeModals();
  setPlayBusy(true, t('ml.installing', { loader: type, version: lv }));
  showStatus(t('downloading'), 0);
  const res = await api.modloaders.install({ loader: type, mcVersion: mc, loaderVersion: lv });
  if (res.ok) {
    toast(t('ml.installed', { loader: type, version: lv, mc }), false);
    await refreshVersions();
    selectVersion({ id: res.id, type: 'custom', installed: true, releaseTime: '' });
  } else {
    toast(res.error);
  }
  btn.disabled = false;
  state.installing = false;
  setPlayBusy(false, state.running ? t('play.running') : t('play'));
  showStatus(null);
};

/* ---------------- mods ---------------- */
const MODS_LOADERS = [
  { id: '', label: 'loader.any' },
  { id: 'fabric', label: 'loader.fabric' },
  { id: 'quilt', label: 'loader.quilt' },
  { id: 'forge', label: 'loader.forge' },
  { id: 'neoforge', label: 'loader.neoforge' },
  { id: 'legacy-fabric', label: 'loader.legacyFabric' },
  { id: 'liteloader', label: 'loader.liteloader' },
  { id: 'modloader', label: 'loader.modloader' },
  { id: 'rift', label: 'loader.rift' },
  { id: 'babric', label: 'loader.babric' },
  { id: 'ornithe', label: 'loader.ornithe' },
];
const MODS_CATEGORIES = [
  { id: 'adventure', label: 'cat.adventure' },
  { id: 'cursed', label: 'cat.cursed' },
  { id: 'decoration', label: 'cat.decoration' },
  { id: 'economy', label: 'cat.economy' },
  { id: 'equipment', label: 'cat.equipment' },
  { id: 'food', label: 'cat.food' },
  { id: 'game-mechanics', label: 'cat.gameMechanics' },
  { id: 'library', label: 'cat.library' },
  { id: 'magic', label: 'cat.magic' },
  { id: 'management', label: 'cat.management' },
  { id: 'minigame', label: 'cat.minigame' },
  { id: 'mobs', label: 'cat.mobs' },
  { id: 'optimization', label: 'cat.optimization' },
  { id: 'social', label: 'cat.social' },
  { id: 'storage', label: 'cat.storage' },
  { id: 'technology', label: 'cat.technology' },
  { id: 'transportation', label: 'cat.transportation' },
  { id: 'utility', label: 'cat.utility' },
  { id: 'worldgen', label: 'cat.worldgen' },
];

const MODS_ENV = [
  { id: 'all', label: 'env.all' },
  { id: 'client', label: 'env.client' },
  { id: 'server', label: 'env.server' },
];

const RP_CATEGORIES = [
  { id: 'combat', label: 'cat.combat' },
  { id: 'cursed', label: 'cat.cursed' },
  { id: 'decoration', label: 'cat.decoration' },
  { id: 'modded', label: 'rp.modded' },
  { id: 'realistic', label: 'rp.realistic' },
  { id: 'simplistic', label: 'rp.simplistic' },
  { id: 'themed', label: 'rp.themed' },
  { id: 'tweaks', label: 'rp.tweaks' },
  { id: 'utility', label: 'cat.utility' },
  { id: 'vanilla-like', label: 'rp.vanillaLike' },
];

const RP_FEATURES = [
  { id: 'audio', label: 'rp.audio' },
  { id: 'blocks', label: 'rp.blocks' },
  { id: 'core-shaders', label: 'rp.coreShaders' },
  { id: 'entities', label: 'rp.entities' },
  { id: 'environment', label: 'rp.environment' },
  { id: 'equipment', label: 'rp.equipment' },
  { id: 'fonts', label: 'rp.fonts' },
  { id: 'gui', label: 'rp.gui' },
  { id: 'items', label: 'rp.items' },
  { id: 'locale', label: 'rp.locale' },
  { id: 'models', label: 'rp.models' },
];

const RP_RESOLUTIONS = [
  { id: '8x-', label: '8x-' },
  { id: '16x', label: '16x' },
  { id: '32x', label: '32x' },
  { id: '48x', label: '48x' },
  { id: '64x', label: '64x' },
  { id: '128x', label: '128x' },
  { id: '256x', label: '256x' },
  { id: '512x+', label: '512x+' },
];

const SHADER_CATEGORIES = [
  { id: 'cartoon', label: 'sh.cartoon' },
  { id: 'cursed', label: 'cat.cursed' },
  { id: 'fantasy', label: 'sh.fantasy' },
  { id: 'realistic', label: 'sh.realistic' },
  { id: 'semi-realistic', label: 'sh.semiRealistic' },
  { id: 'vanilla-like', label: 'sh.vanillaLike' },
];

const SHADER_FEATURES = [
  { id: 'atmosphere', label: 'sh.atmosphere' },
  { id: 'bloom', label: 'sh.bloom' },
  { id: 'colored-lighting', label: 'sh.coloredLighting' },
  { id: 'foliage', label: 'sh.foliage' },
  { id: 'path-tracing', label: 'sh.pathTracing' },
  { id: 'pbr', label: 'sh.pbr' },
  { id: 'reflections', label: 'sh.reflections' },
  { id: 'shadows', label: 'sh.shadows' },
];

const SHADER_IMPACTS = [
  { id: 'low', label: 'imp.low' },
  { id: 'medium', label: 'imp.medium' },
  { id: 'high', label: 'imp.high' },
  { id: 'potato', label: 'imp.potato' },
  { id: 'screenshot', label: 'imp.screenshot' },
];

const SHADER_LOADERS = [
  { id: '', label: 'loader.any' },
  { id: 'iris', label: 'loader.iris' },
  { id: 'optifine', label: 'loader.optifine' },
  { id: 'canvas', label: 'loader.canvas' },
  { id: 'vanilla', label: 'loader.vanillaShaders' },
];

const CATEGORIES_BY_TYPE = {
  mod: MODS_CATEGORIES,
  resourcepack: RP_CATEGORIES,
  shader: SHADER_CATEGORIES,
};

const FEATURES_BY_TYPE = {
  resourcepack: RP_FEATURES,
  shader: SHADER_FEATURES,
};

const IMPACTS_BY_TYPE = {
  shader: SHADER_IMPACTS,
};

const RESOLUTIONS_BY_TYPE = {
  resourcepack: RP_RESOLUTIONS,
};

const LOADERS_BY_TYPE = {
  mod: MODS_LOADERS,
  shader: SHADER_LOADERS,
};

const TYPE_META = {
  mod: { key: 'type.mod', dir: 'mods' },
  resourcepack: { key: 'type.resourcepack', dir: 'resourcepacks' },
  shader: { key: 'type.shader', dir: 'shaderpacks' },
};

function renderBrowseHead() {
  const meta = TYPE_META[state.mods.projectType] || TYPE_META.mod;
  const t2 = $('#browse-title');
  if (t2) t2.textContent = t(meta.key + '.title');
  const s = $('#mods-search');
  if (s) s.placeholder = t(meta.key + '.placeholder');
  const f = $('#btn-mods-folder');
  if (f) f.textContent = t(meta.key + '.folder');
}

function renderModsCategories() {
  const box = $('#mods-category');
  box.innerHTML = '';
  const active = state.mods.categories || [];
  for (const c of CATEGORIES_BY_TYPE[state.mods.projectType] || MODS_CATEGORIES) {
    const b = document.createElement('button');
    b.className = 'mods-tab' + (active.includes(c.id) ? ' active' : '');
    b.textContent = t(c.label);
    b.onclick = () => {
      const set = new Set(active);
      if (set.has(c.id)) set.delete(c.id);
      else set.add(c.id);
      state.mods.categories = [...set];
      renderModsCategories();
      searchModsReset();
    };
    box.appendChild(b);
  }
}

function renderModsEnv() {
  const box = $('#mods-env');
  if (!box) return;
  box.innerHTML = '';
  for (const e of MODS_ENV) {
    const b = document.createElement('button');
    b.className = 'mods-tab' + (e.id === state.mods.environment ? ' active' : '');
    b.textContent = e.label;
    b.onclick = () => {
      state.mods.environment = e.id;
      renderModsEnv();
      searchModsReset();
    };
    box.appendChild(b);
  }
}

function renderModsChipSet(key, list, elId) {
  const box = $(elId);
  if (!box) return;
  box.innerHTML = '';
  const active = state.mods[key] || [];
  for (const c of list) {
    const b = document.createElement('button');
    b.className = 'mods-tab' + (active.includes(c.id) ? ' active' : '');
    b.textContent = t(c.label);
    b.onclick = () => {
      const set = new Set(active);
      if (set.has(c.id)) set.delete(c.id);
      else set.add(c.id);
      state.mods[key] = [...set];
      renderModsChipSet(key, list, elId);
      searchModsReset();
    };
    box.appendChild(b);
  }
}

function renderModsFeatures() {
  renderModsChipSet('features', FEATURES_BY_TYPE[state.mods.projectType] || [], '#mods-feature');
}

function renderModsImpacts() {
  renderModsChipSet('impacts', IMPACTS_BY_TYPE[state.mods.projectType] || [], '#mods-impact');
}

function renderModsResolutions() {
  renderModsChipSet('resolutions', RESOLUTIONS_BY_TYPE[state.mods.projectType] || [], '#mods-resolution');
}

function renderModsLoaders() {
  const ld = $('#mods-loader-tabs');
  if (!ld) return;
  ld.innerHTML = '';
  const list = LOADERS_BY_TYPE[state.mods.projectType] || MODS_LOADERS;
  for (const l of list) {
    const b = document.createElement('button');
    b.className = 'mods-tab' + (l.id === state.mods.loader ? ' active' : '');
    b.textContent = t(l.label);
    b.onclick = () => {
      state.mods.loader = l.id;
      renderModsLoaders();
      searchModsReset();
    };
    ld.appendChild(b);
  }
}

function renderBrowseRows() {
  const t = state.mods.projectType;
  const show = {
    'line-category': true,
    'line-feature': t === 'resourcepack' || t === 'shader',
    'line-impact': t === 'shader',
    'line-resolution': t === 'resourcepack',
    'line-env': t === 'mod',
    'line-vercats': true,
    'line-versions': true,
    'line-loader': t === 'mod' || t === 'shader',
  };
  for (const id of Object.keys(show)) {
    const el = $(`#${id}`);
    if (el) el.classList.toggle('hidden', !show[id]);
  }
}

function renderModsVerCats() {
  const box = $('#mods-vercats');
  if (!box) return;
  box.innerHTML = '';
  const selected = state.mods.verCats || ['all'];
  for (const c of CATEGORIES) {
    const b = document.createElement('button');
    b.className = 'mods-tab' + (selected.includes(c.id) ? ' active' : '');
    b.textContent = t(c.label);
    b.onclick = () => {
      let next;
      if (c.id === 'all') {
        next = ['all'];
      } else {
        const hasAll = selected.includes('all');
        const set = new Set(hasAll ? [] : selected);
        if (set.has(c.id)) set.delete(c.id);
        else set.add(c.id);
        next = set.size ? [...set] : ['all'];
      }
      state.mods.verCats = next;
      renderModsVerCats();
      renderModsVersions();
    };
    box.appendChild(b);
  }
}

function renderModsVersions() {
  const box = $('#mods-mc-version');
  if (!box) return;
  const sel = state.mods.mcVersions || [];
  const cats = state.mods.verCats || ['all'];
  box.innerHTML = '';
  const mk = (val, label, on) => {
    const b = document.createElement('button');
    b.className = 'mods-tab' + (on ? ' active' : '');
    b.textContent = label;
    b.onclick = () => {
      let next;
      if (val === '') {
        next = [];
      } else {
        const hasAny = sel.length === 0;
        const set = new Set(hasAny ? [] : sel);
        if (set.has(val)) set.delete(val);
        else set.add(val);
        next = set.size ? [...set] : [];
      }
      state.mods.mcVersions = next;
      renderModsVersions();
      searchModsReset();
    };
    box.appendChild(b);
  };
  mk('', t('filter.anyVersion'), sel.length === 0);
  const known = state.modsGameVersions;
  const list = state.versions
    .filter((v) => {
      if (!cats.includes('all') && !cats.includes(versionCategory(v))) return false;
      return !known || known.includes(v.id);
    })
    .slice()
    .sort((a, b) => (b.releaseTime || '').localeCompare(a.releaseTime || ''));
  for (const v of list) mk(v.id, v.id, sel.includes(v.id));
}

async function initModsView() {
  renderBrowseRows();
  renderModsCategories();
  renderModsFeatures();
  renderModsImpacts();
  renderModsResolutions();
  renderModsEnv();
  renderModsVerCats();
  renderModsVersions();
  renderModsLoaders();
  $('#mods-hint').textContent = t('mods.hint', { type: t((TYPE_META[state.mods.projectType] || TYPE_META.mod).key + '.label') });
  state.mods.page = 0;
  searchMods();
}

async function searchMods() {
  const query = $('#mods-search').value.trim();
  const grid = $('#mods-grid');
  const label = t((TYPE_META[state.mods.projectType] || TYPE_META.mod).key + '.label');
  grid.innerHTML = `<p class="panel-hint">${query ? t('mods.searching', { type: label }) : t('mods.loadingPopular', { type: label })}</p>`;
  $('#mods-hint').textContent = '';
  const page = state.mods.page || 0;
  const res = await api.mods.search({
    query,
    projectType: state.mods.projectType || 'mod',
    mcVersions: state.mods.mcVersions || [],
    loader: state.mods.loader,
    categories: state.mods.categories,
    features: state.mods.features || [],
    impacts: state.mods.impacts || [],
    resolutions: state.mods.resolutions || [],
    environment: state.mods.environment,
    limit: MODS_PAGE_SIZE,
    offset: page * MODS_PAGE_SIZE,
  });
  if (!res.ok) {
    grid.innerHTML = '';
    renderPager('#mods-pager', page, 0);
    $('#mods-hint').textContent = res.error;
    return;
  }
  renderMods(res.mods || []);
  renderPager('#mods-pager', page, res.total || 0);
}

function renderPager(sel, page, total) {
  const el = $(sel);
  if (!el) return;
  const pages = Math.max(1, Math.ceil((total || 0) / MODS_PAGE_SIZE));
  el.innerHTML = '';
  if (pages <= 1) return;
  const mk = (label, go, cls, dis) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pager-btn' + (cls ? ' ' + cls : '');
    b.textContent = label;
    if (dis) {
      b.disabled = true;
    } else {
      b.onclick = () => {
        state.mods.page = go;
        searchMods();
      };
    }
    el.appendChild(b);
  };
  mk('«', 0, 'pager-nav', page === 0);
  mk('‹', page - 1, 'pager-nav', page === 0);
  let from = Math.max(0, Math.min(page - 2, pages - 5));
  const to = Math.min(pages, from + 5);
  for (let p = from; p < to; p++) mk(String(p + 1), p, p === page ? 'active' : '');
  mk('›', page + 1, 'pager-nav', page >= pages - 1);
  mk('»', pages - 1, 'pager-nav', page >= pages - 1);
}

function renderMods(list) {
  const grid = $('#mods-grid');
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = `<p class="panel-hint">${t('mods.none')}</p>`;
    return;
  }
  const anim = takeStagger(grid);
  let idx = 0;
  for (const m of list) {
    const card = document.createElement('div');
    card.className = 'mod-card';
    card.innerHTML = `
      <div class="mod-icon-wrap">
        ${m.icon ? `<img class="mod-icon" src="${escapeHtml(m.icon)}" alt="" />` : '<div class="mod-icon mod-icon-fallback"></div>'}
      </div>
      <div class="mod-info">
        <div class="mod-name">${escapeHtml(m.name)}</div>
        <div class="mod-desc">${escapeHtml(m.description)}</div>
        <div class="mod-meta">${t('mods.downloads', { count: fmtCount(m.downloads || 0) })}${m.author ? ' · ' + escapeHtml(m.author) : ''}</div>
      </div>
      <button class="btn-ghost mod-install">${t('mods.install')}</button>`;
    if (anim) staggerInto(card, idx);
    idx++;
    const icon = card.querySelector('.mod-icon');
    if (icon) {
      icon.onerror = () => {
        const fb = document.createElement('div');
        fb.className = 'mod-icon mod-icon-fallback';
        icon.replaceWith(fb);
      };
    }
    const typePath = state.mods.projectType === 'resourcepack' ? 'resourcepack' : state.mods.projectType === 'shader' ? 'shader' : 'mod';
    card.title = t('mods.openOnModrinth');
    card.onclick = () => api.shell.open('https://modrinth.com/' + typePath + '/' + encodeURIComponent(m.slug || m.id));
    card.querySelector('.mod-install').onclick = (e) => {
      e.stopPropagation();
      installMod(m, e.target);
    };
    grid.appendChild(card);
  }
}

async function openModPick(mod, curMc, curLoader) {
  const res = await api.mods.versions(mod.id);
  if (!res.ok) {
    toast(res.error);
    return null;
  }
  const { gameVersions = [], loaders = [] } = res.result || {};
  const vSel = $('#modpick-version');
  vSel.innerHTML = '';
  for (const g of gameVersions) {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    if (g === curMc) opt.selected = true;
    vSel.appendChild(opt);
  }
  const lSel = $('#modpick-loader');
  lSel.innerHTML = '';
  for (const l of loaders) {
    const opt = document.createElement('option');
    opt.value = l;
    opt.textContent = l;
    if (l === curLoader) opt.selected = true;
    lSel.appendChild(opt);
  }
  if (!vSel.value && vSel.options.length) vSel.selectedIndex = 0;
  if (!lSel.value && lSel.options.length) lSel.selectedIndex = 0;
  $('#modpick-title').textContent = t('modpick.title', { name: mod.name });
  $('#modpick-hint').textContent = gameVersions.length > 0
    ? t('modpick.hint')
    : t('modpick.failed');
  openModal('#modal-modpick');
  return new Promise((resolve) => {
    modpickPending = resolve;
  });
}

$('#btn-modpick-ok').onclick = () => {
  const r = { mcVersion: $('#modpick-version').value, loader: $('#modpick-loader').value };
  const p = modpickPending;
  modpickPending = null;
  closeModals();
  if (p) p(r);
};
$('#btn-modpick-cancel').onclick = () => {
  const p = modpickPending;
  modpickPending = null;
  closeModals();
  if (p) p(null);
};

async function installMod(m, btn) {
  if (state.installing) return toast(t('toast.anotherInstall'));
  const mcVersions = state.mods.mcVersions || [];
  let mcVersion = mcVersions.length === 1 ? mcVersions[0] : '';
  let loader = state.mods.loader;
  if (!mcVersion || !loader) {
    btn.textContent = t('mods.select');
    const picked = await openModPick(m, mcVersion, loader);
    btn.textContent = t('mods.install');
    if (!picked || !picked.mcVersion || !picked.loader) return;
    mcVersion = picked.mcVersion;
    loader = picked.loader;
  }
  state.installing = true;
  btn.disabled = true;
  btn.textContent = t('mods.downloading');
  const res = await api.mods.install({
    id: m.id,
    mcVersion,
    loader,
    projectType: state.mods.projectType || 'mod',
  });
  if (res.ok) {
    btn.textContent = t('mods.installed');
    btn.classList.add('done');
    toast(t('mods.installedMod', { name: res.result.filename }), false);
  } else {
    btn.disabled = false;
    btn.textContent = t('mods.install');
    toast(res.error);
  }
  state.installing = false;
}

$('#btn-mods-search').onclick = searchModsReset;
$('#mods-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchModsReset();
});
$('#btn-mods-folder').onclick = async () => {
  const meta = TYPE_META[state.mods.projectType] || TYPE_META.mod;
  const res = await api.dir.open(meta.dir);
  if (!res.ok) toast(res.error);
};

/* ---------------- modpacks ---------------- */
const MODPACK_CATEGORIES = [
  { id: 'adventure', label: 'cat.adventure' },
  { id: 'challenging', label: 'cat.challenging' },
  { id: 'combat', label: 'cat.combat' },
  { id: 'kitchen-sink', label: 'cat.kitchenSink' },
  { id: 'lightweight', label: 'cat.lightweight' },
  { id: 'magic', label: 'cat.magic' },
  { id: 'multiplayer', label: 'cat.multiplayer' },
  { id: 'optimization', label: 'cat.optimization' },
  { id: 'quests', label: 'cat.quests' },
  { id: 'technology', label: 'cat.technology' },
];

const CREATE_PACK_LOADERS = [
  { id: '', label: 'loader.none' },
  { id: 'fabric', label: 'loader.fabric' },
  { id: 'quilt', label: 'loader.quilt' },
  { id: 'forge', label: 'loader.forge' },
  { id: 'neoforge', label: 'loader.neoforge' },
];

function renderModpackChips(elId, list, stateKey, multi) {
  const box = $(elId);
  if (!box) return;
  box.innerHTML = '';
  const active = state.modpacks[stateKey];
  for (const c of list) {
    const b = document.createElement('button');
    const on = multi ? active.includes(c.id) : active === c.id;
    b.className = 'mods-tab' + (on ? ' active' : '');
    b.textContent = t(c.label);
    b.onclick = () => {
      if (multi) {
        const set = new Set(active);
        if (set.has(c.id)) set.delete(c.id);
        else set.add(c.id);
        state.modpacks[stateKey] = [...set];
        renderModpackChips(elId, list, stateKey, multi);
      } else {
        state.modpacks[stateKey] = c.id;
        renderModpackChips(elId, list, stateKey, multi);
      }
      searchModpacksReset();
    };
    box.appendChild(b);
  }
}

function renderModpackVersions() {
  const box = $('#modpack-mc-version');
  if (!box) return;
  const sel = state.modpacks.mcVersions || [];
  box.innerHTML = '';
  const mk = (val, label, on) => {
    const b = document.createElement('button');
    b.className = 'mods-tab' + (on ? ' active' : '');
    b.textContent = label;
    b.onclick = () => {
      let next;
      if (val === '') {
        next = [];
      } else {
        const set = new Set(sel);
        if (set.has(val)) set.delete(val);
        else set.add(val);
        next = set.size ? [...set] : [];
      }
      state.modpacks.mcVersions = next;
      renderModpackVersions();
      searchModpacksReset();
    };
    box.appendChild(b);
  };
  mk('', t('filter.anyVersion'), sel.length === 0);
  const known = state.modsGameVersions;
  const list = state.versions
    .filter((v) => v.type === 'release' || v.type === 'snapshot')
    .filter((v) => !known || known.includes(v.id));
  for (const v of list.slice(0, 400)) mk(v.id, v.id, sel.includes(v.id));
}

function initModpacksView() {
  renderModpackChips('#modpack-category', MODPACK_CATEGORIES, 'categories', true);
  renderModpackChips('#modpack-env', MODS_ENV, 'environment', false);
  renderModpackChips('#modpack-loader', MODS_LOADERS, 'loader', false);
  renderModpackVersions();
  renderInstalledPacks();
  loadInstalledPacks();
  state.modpacks.page = 0;
  searchModpacks();
}

async function searchModpacks() {
  const query = $('#modpack-search').value.trim();
  const grid = $('#modpack-grid');
  grid.innerHTML = `<p class="panel-hint">${query ? t('modpacks.searching') : t('modpacks.loadingPopular')}</p>`;
  $('#modpack-hint').textContent = '';
  const page = state.modpacks.page || 0;
  const res = await api.modpacks.search({
    query,
    mcVersions: state.modpacks.mcVersions || [],
    loader: state.modpacks.loader,
    categories: state.modpacks.categories,
    environment: state.modpacks.environment,
    limit: MODS_PAGE_SIZE,
    offset: page * MODS_PAGE_SIZE,
  });
  if (!res.ok) {
    grid.innerHTML = '';
    renderModpackPager(page, 0);
    $('#modpack-hint').textContent = res.error;
    return;
  }
  let list = res.mods || [];
  let emptyText = '';
  renderModpackCards(list, emptyText);
  renderModpackPager(page, res.total || 0);
}

function renderModpackPager(page, total) {
  const el = $('#modpack-pager');
  if (!el) return;
  const pages = Math.max(1, Math.ceil((total || 0) / MODS_PAGE_SIZE));
  el.innerHTML = '';
  if (pages <= 1) return;
  const mk = (label, go, cls, dis) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pager-btn' + (cls ? ' ' + cls : '');
    b.textContent = label;
    if (dis) {
      b.disabled = true;
    } else {
      b.onclick = () => {
        state.modpacks.page = go;
        searchModpacks();
      };
    }
    el.appendChild(b);
  };
  mk('«', 0, 'pager-nav', page === 0);
  mk('‹', page - 1, 'pager-nav', page === 0);
  let from = Math.max(0, Math.min(page - 2, pages - 5));
  const to = Math.min(pages, from + 5);
  for (let p = from; p < to; p++) mk(String(p + 1), p, p === page ? 'active' : '');
  mk('›', page + 1, 'pager-nav', page >= pages - 1);
  mk('»', pages - 1, 'pager-nav', page >= pages - 1);
}

function searchModsReset() {
  state.mods.page = 0;
  searchMods();
}

function searchModpacksReset() {
  state.modpacks.page = 0;
  searchModpacks();
}

function renderModpackCards(list, emptyText) {
  const grid = $('#modpack-grid');
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = `<p class="panel-hint">${escapeHtml(emptyText || t('modpacks.noFound'))}</p>`;
    return;
  }
  const anim = takeStagger(grid);
  let idx = 0;
  for (const m of list) {
    const installed = state.modpacks.installed.some((p) => p.slug === m.slug);
    const card = document.createElement('div');
    card.className = 'mod-card' + (installed ? ' installed' : '');
    card.innerHTML = `
      <div class="mod-icon-wrap">
        ${m.icon ? `<img class="mod-icon" src="${escapeHtml(m.icon)}" alt="" />` : '<div class="mod-icon mod-icon-fallback"></div>'}
      </div>
      <div class="mod-info">
        <div class="mod-name">${escapeHtml(m.name)}</div>
        <div class="mod-desc">${escapeHtml(m.description)}</div>
        <div class="mod-meta">${t('mods.downloads', { count: fmtCount(m.downloads || 0) })}${m.author ? ' · ' + escapeHtml(m.author) : ''}</div>
      </div>
      <button class="btn-ghost mod-install${installed ? ' done' : ''}"${installed ? ' disabled' : ''}>${installed ? t('mods.installed') : t('mods.install')}</button>`;
    if (anim) staggerInto(card, idx);
    idx++;
    const icon = card.querySelector('.mod-icon');
    if (icon) {
      icon.onerror = () => {
        const fb = document.createElement('div');
        fb.className = 'mod-icon mod-icon-fallback';
        icon.replaceWith(fb);
      };
    }
    card.title = t('mods.openOnModrinth');
    card.onclick = () => api.shell.open('https://modrinth.com/modpack/' + encodeURIComponent(m.slug || m.id));
    if (!installed) {
      card.querySelector('.mod-install').onclick = (e) => {
        e.stopPropagation();
        installModpack(m, e.target);
      };
    }
    grid.appendChild(card);
  }
}

async function installModpack(m, btn) {
  if (state.installing) return toast(t('toast.anotherInstall'));
  btn.textContent = t('mods.select');
  const res = await api.modpacks.versions(m.id);
  btn.textContent = t('mods.install');
  if (!res.ok) return toast(res.error);
  const versions = res.versions || [];
  if (!versions.length) return toast(t('modpacks.noVersions'));
  const vSel = $('#modpack-pick-version');
  vSel.innerHTML = '';
  for (const v of versions) {
    const opt = document.createElement('option');
    opt.value = v.id;
    const mc = (v.gameVersions || []).join(', ');
    const ld = (v.loaders || []).join(', ');
    opt.textContent = `${v.name}${mc ? ' — MC ' + mc : ''}${ld ? ' [' + ld + ']' : ''}`;
    vSel.appendChild(opt);
  }
  $('#modpack-pick-title').textContent = t('modpacks.installTitle', { name: m.name });
  $('#modpack-pick-hint').textContent = t('modpacks.installHint', { count: versions.length });
  openModal('#modal-modpack-pick');
  const picked = await new Promise((resolve) => {
    modpickPending = resolve;
  });
  if (!picked) return;
  btn.textContent = t('modpacks.installing');
  state.installing = true;
  switchView('play');
  const r = await api.modpacks.install({ id: m.id, versionId: picked });
  state.installing = false;
  if (!r.ok) {
    btn.textContent = t('mods.install');
    return toast(r.error);
  }
  btn.textContent = t('mods.installed');
  btn.classList.add('done');
  toast(t('modpacks.installedPack', { name: r.result.name }));
  await loadInstalledPacks();
}

$('#btn-modpack-pick-ok').onclick = () => {
  const v = $('#modpack-pick-version').value;
  const p = modpickPending;
  modpickPending = null;
  closeModals();
  if (p) p(v || null);
};
$('#btn-modpack-pick-cancel').onclick = () => {
  const p = modpickPending;
  modpickPending = null;
  closeModals();
  if (p) p(null);
};

async function loadInstalledPacks() {
  const res = await api.modpacks.list();
  state.modpacks.installed = res.ok ? res.packs || [] : [];
  renderInstalledPacks();
  if (state.selectedPack && !state.modpacks.installed.some((p) => p.slug === state.selectedPack.slug)) {
    selectPack(null);
  } else {
    renderTabs();
  }
  restoreSelection();
  if (state.playTab === 'modpack') renderPlayPicker();
}

function renderInstalledPacks() {
  const box = $('#modpack-installed');
  if (!box) return;
  box.innerHTML = '';
  const packs = state.modpacks.installed;
  if (!packs.length) {
    box.innerHTML = `<p class="panel-hint">${t('modpacks.none')}</p>`;
    return;
  }
  const anim = takeStagger(box);
  let idx = 0;
  for (const p of packs) {
    const card = document.createElement('div');
    card.className = 'mp-item';
    card.innerHTML = `
      <div class="mod-icon-wrap">
        ${p.iconUrl ? `<img class="mod-icon" src="${escapeHtml(p.iconUrl)}" alt="" />` : '<div class="mod-icon mod-icon-fallback"></div>'}
      </div>
      <div class="mod-info">
        <div class="mod-name">${escapeHtml(p.name)}</div>
        <div class="mod-meta">MC ${escapeHtml(p.mc)}${p.loader ? ' · ' + escapeHtml(p.loader) : ''}${p.fileCount ? ' · ' + t('modpacks.files') + ': ' + p.fileCount : ' · ' + t('modpacks.empty')}</div>
        ${p.versionName ? `<div class="mod-meta">${escapeHtml(p.versionName)}</div>` : ''}
      </div>
      <div class="mp-actions">
        <button class="btn-ghost mp-play">${t('modpacks.play')}</button>
        <button class="btn-ghost mp-del">${t('modpacks.delete')}</button>
      </div>`;
    if (anim) staggerInto(card, idx);
    idx++;
    const icon = card.querySelector('.mod-icon');
    if (icon) {
      icon.onerror = () => {
        const fb = document.createElement('div');
        fb.className = 'mod-icon mod-icon-fallback';
        icon.replaceWith(fb);
      };
    }
    card.querySelector('.mp-play').onclick = async () => {
      if (state.installing) return toast(t('toast.anotherInstall'));
      if (!state.selected) return toast(t('toast.accRequired'));
      state.installing = true;
      card.querySelector('.mp-play').textContent = t('modpacks.launching');
      const r = await api.game.launch({ modpack: p.slug });
      state.installing = false;
      card.querySelector('.mp-play').textContent = t('modpacks.play');
      if (!r.ok) return toast(r.error);
      state.running = true;
      state.currentRunId = 'mp:' + p.slug;
      toast(t('modpack.launching'));
    };
    card.querySelector('.mp-del').onclick = async () => {
      const ok = await confirmDialog(t('modpacks.confirmDelete', { name: p.name }));
      if (!ok) return;
      const r = await api.modpacks.remove(p.slug);
      if (!r.ok) return toast(r.error);
      await loadInstalledPacks();
    };
    box.appendChild(card);
  }
}

/* ---------------- create pack modal ---------------- */
$('#btn-create-pack').onclick = () => {
  $('#create-pack-name').value = '';
  const mc = $('#create-pack-mc');
  mc.innerHTML = '';
  const list = state.versions.filter((v) => v.type === 'release' || v.type === 'snapshot');
  for (const v of list) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.id;
    mc.appendChild(opt);
  }
  const ld = $('#create-pack-loader');
  ld.innerHTML = '';
  for (const l of CREATE_PACK_LOADERS) {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = t(l.label);
    ld.appendChild(opt);
  }
  fillCreateLoaderVersions();
  openModal('#modal-create-pack');
};

async function fillCreateLoaderVersions() {
  const mc = $('#create-pack-mc').value;
  const loader = $('#create-pack-loader').value;
  const field = $('#create-pack-ldver-field');
  const sel = $('#create-pack-ldver');
  sel.innerHTML = '';
  if (!loader) {
    field.classList.add('hidden');
    return;
  }
  field.classList.remove('hidden');
  const res = await api.modloaders.loaders(mc);
  const def = (res.ok ? res.loaders || [] : []).find((l) => l.loader === loader);
  const versions = def && def.versions ? def.versions : [];
  if (!versions.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = t('modpacks.noLoaderVersions');
    sel.appendChild(opt);
    return;
  }
  for (const v of versions) {
    const opt = document.createElement('option');
    opt.value = v.version;
    opt.textContent = v.version + (v.stable ? '' : t('ml.unstable'));
    sel.appendChild(opt);
  }
}

$('#create-pack-mc').onchange = fillCreateLoaderVersions;
$('#create-pack-loader').onchange = fillCreateLoaderVersions;

$('#btn-create-pack-ok').onclick = async () => {
  const name = $('#create-pack-name').value.trim();
  if (!name) return toast(t('modpacks.nameRequired'));
  const mc = $('#create-pack-mc').value;
  const loader = $('#create-pack-loader').value;
  const loaderVersion = $('#create-pack-ldver').value;
  if (loader && !loaderVersion) return toast(t('modpacks.selectLoaderVersion'));
  closeModals();
  toast(t('modpacks.creating'));
  switchView('play');
  const r = await api.modpacks.create({ name, mcVersion: mc, loader, loaderVersion });
  if (!r.ok) return toast(r.error);
  toast(t('modpacks.created', { name }));
  await loadInstalledPacks();
};
$('#btn-create-pack-cancel').onclick = closeModals;

api.modpacks.onChanged(() => {
  loadInstalledPacks().catch(() => {});
});

$('#btn-modpack-search').onclick = searchModpacksReset;
$('#modpack-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchModpacksReset();
});

/* ---------------- play ---------------- */
function setPlayBusy(busy, text) {
  const btn = $('#btn-play');
  const stop = $('#btn-stop');
  const running = state.running;
  btn.disabled = busy;
  btn.classList.toggle('hidden', running);
  stop.classList.toggle('hidden', !running);
  $('#play-text').textContent = text || (running ? t('play.running') : t('play'));
}

function showPlayCard(el) {
  clearTimeout(el.dataset.hideTimer);
  delete el.dataset.hideTimer;
  el.classList.remove('leaving', 'hidden');
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
}

function hidePlayCard(el) {
  if (el.classList.contains('hidden')) return;
  el.classList.add('leaving');
  el.dataset.hideTimer = setTimeout(() => {
    el.classList.remove('leaving');
    el.classList.add('hidden');
  }, 220);
}

function showStatus(text, percent) {
  const card = $('#status-card');
  const logCard = $('#log-card');
  if (text == null && percent == null) {
    hidePlayCard(card);
    if (!state.running) hidePlayCard(logCard);
    return;
  }
  showPlayCard(card);
  $('#status-text').textContent = text;
  $('#status-pct').textContent = (percent ?? 0) + '%';
  $('#status-bar').style.width = (percent ?? 0) + '%';
}

api.versions.onProgress((p) => {
  if (p.error) {
    setPlayBusy(false, t('play'));
    state.installing = false;
    showStatus(null);
    return;
  }
  if (p.phase === 'done') {
    showStatus(t('status.done'), 100);
    setTimeout(() => showStatus(null), 1200);
    return;
  }
  const names = {
    client: t('phase.client'),
    libs: t('phase.libs'),
    natives: t('phase.natives'),
    assets: t('phase.assets'),
    loader: t('phase.loader'),
    pack: t('phase.pack'),
  };
  showStatus(`${names[p.phase] || p.phase}: ${p.name}`, p.percent);
});

$('#btn-play').onclick = async () => {
  if (state.installing || state.running) return;
  const pack = state.selectedPack;
  const version = state.selectedVersion;
  if (!pack && !version) return toast(t('chip.selectVersionOrPack'));
  if (!state.selected) return toast(t('toast.accRequired'));
  setPlayBusy(true, t('modpacks.launching'));
  showStatus(t('status.preparing'), 0);
  $('#log-output').textContent = '';
  showPlayCard($('#log-card'));
  const res = await api.game.launch({
    versionId: version ? version.id : undefined,
    versionUrl: version ? version.url : undefined,
    modpack: pack ? pack.slug : undefined,
  });
  if (!res.ok) {
    setPlayBusy(false, t('play'));
    showStatus(null);
    return toast(res.error);
  }
  state.running = true;
  state.currentRunId = pack ? 'mp:' + pack.slug : (version ? version.id : null);
  state.lastRunModpack = pack ? pack.slug : null;
  setPlayBusy(false, t('play.running'));
  showStatus(t('play.running'), 100);
};

$('#btn-stop').onclick = async () => {
  if (!state.running || !state.currentRunId) return;
  appendLog('info', t('game.stopping'));
  await api.game.stop(state.currentRunId);
};

function appendLog(level, text) {
  const out = $('#log-output');
  const line = document.createElement('div');
  if (level === 'warn') line.className = 'warn';
  line.textContent = text;
  line.style.animation = 'logLine 0.22s ease';
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}
api.game.onLog((l) => appendLog(l.level, l.text));
api.game.onExit(async (d) => {
  state.running = false;
  state.currentRunId = null;
  setPlayBusy(false, t('play'));
  appendLog('info', t('game.exit', { code: d.code }));
  if (d.code !== 0) {
    const logs = await api.game.logs({ modpack: d.modpack || undefined });
    if (logs && logs.crash) {
      appendLog('warn', '--- ' + t('log.crash') + ' ---');
      const crash = logs.crash;
      appendLog('warn', t('log.crashFile') + ': ' + crash.file);
      appendLog('warn', crash.content);
    } else if (logs && logs.log) {
      appendLog('warn', '--- ' + t('log.lastLog') + ' ---');
      appendLog('warn', logs.log);
    }
  }
  showStatus(null);
  toast(t('game.exit', { code: d.code }), d.code !== 0);
});
$('#btn-log-clear').onclick = () => ($('#log-output').textContent = '');
$('#btn-log-open').onclick = async () => {
  const res = await api.game.openLogs({ modpack: state.lastRunModpack || undefined });
  if (!res.ok) toast(res.error);
};

/* ---------------- news ---------------- */
async function loadNews(force) {
  const card = $('#news-card');
  const res = await api.news.get(force);
  if (!res.ok || !res.items || !res.items.length) {
    hidePlayCard(card);
    return;
  }
  showPlayCard(card);
  const list = $('#news-list');
  list.innerHTML = '';
  let idx = 0;
  for (const it of res.items) {
    const a = document.createElement('a');
    a.className = 'news-item';
    modalStagger(a, idx++);
    a.href = 'https://t.me/' + it.postId;
    a.onclick = (e) => {
      e.preventDefault();
      api.shell.open('https://t.me/' + it.postId);
    };
    const date = it.date ? new Date(it.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
    const dateEl = document.createElement('span');
    dateEl.className = 'news-date';
    dateEl.textContent = date;
    const textEl = document.createElement('span');
    textEl.className = 'news-text';
    textEl.textContent = it.text;
    a.appendChild(dateEl);
    a.appendChild(textEl);
    list.appendChild(a);
  }
  list.scrollTop = list.scrollHeight;
}
loadNews();

/* ---------------- settings ---------------- */
function applyStaticI18n() {
  document.documentElement.lang = window.__getLang();
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.dataset.i18n;
    if (k) el.textContent = t(k);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    const k = el.dataset.i18nPh;
    if (k) el.placeholder = t(k);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const k = el.dataset.i18nTitle;
    if (k) el.title = t(k);
  });
}

function applyLanguage() {
  const lang = state.settings.language || 'en';
  window.__setLang(lang);
  applyStaticI18n();
  renderRam();
  renderAccountChip();
  renderSelectChip();
  renderTabs();
  if (state.playTab) renderPlayPicker();
  renderBrowseHead();
  renderCategories();
  renderVersionGrid();
  const cur = state.currentView;
  if (cur === 'modpacks') initModpacksView();
  else if (BROWSE_VIEWS[cur] !== undefined) initModsView();
}

async function loadSettings() {
  state.settings = await api.settings.get();
  const s = state.settings;
  $('#ram-slider').value = s.memory;
  renderRam();
  $('#java-path').value = s.javaPath || '';
  $('#jvm-args').value = s.jvmArgs || '';
  $('#game-dir').value = s.gameDir || '';
  $('#ms-client-id').value = s.msClientId || '';
  $('#ms-redirect').value = s.msRedirectUri || '';
  populateLangSelects();
  $('#language-select').value = s.language || 'en';
  $('#chk-installed-only').setAttribute('aria-checked', !!s.versionsInstalledOnly ? 'true' : 'false');
  applyLanguage();
  applyTheme();
  renderThemeUI();
  renderJavaList();
}

$('#language-select').onchange = (e) => {
  state.settings.language = e.target.value || 'en';
  api.settings.set('language', state.settings.language);
  applyLanguage();
};

/* ---------------- agreements ---------------- */
function agreeChecked(id) {
  return $('#agree-' + id).getAttribute('aria-checked') === 'true';
}

function showAgreements() {
  $('#agree-eula').setAttribute('aria-checked', 'false');
  $('#agree-tos').setAttribute('aria-checked', 'false');
  $('#btn-agree-ok').disabled = true;
  openModal('#modal-agreements');
}

function updateAgreeOk() {
  $('#btn-agree-ok').disabled = !(agreeChecked('eula') && agreeChecked('tos'));
}

$('#modal-agreements').addEventListener('click', (e) => e.stopPropagation());
document.querySelectorAll('#modal-agreements .custom-check').forEach((b) => {
  b.onclick = () => {
    b.setAttribute('aria-checked', b.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    updateAgreeOk();
  };
});
$('#btn-agree-ok').onclick = async () => {
  const eula = agreeChecked('eula');
  const tos = agreeChecked('tos');
  if (!eula || !tos) {
    toast(t('agree.both'));
    return;
  }
  await api.agreements.accept({ eula, tos });
  state.settings.eulaAccepted = true;
  state.settings.tosAccepted = true;
  closeModals();
};
document.querySelectorAll('#modal-agreements a').forEach((a) => {
  a.onclick = (e) => {
    e.preventDefault();
    api.shell.open(a.href);
  };
});

const ACCENT_COLOR = {
  dark: '#4ade80',
  oled: '#4ade80',
  light: '#16a34a',
  aurora: '#16a34a',
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const v = parseInt(n, 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

function darkenColor(hex, factor) {
  const { r, g, b } = hexToRgb(hex);
  const d = (v) => Math.max(0, Math.min(255, Math.round(v * factor)));
  return `rgb(${d(r)}, ${d(g)}, ${d(b)})`;
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function applyTheme() {
  const theme = state.settings.theme || 'dark';
  const accent = state.settings.accent || ACCENT_COLOR[theme] || '#4ade80';
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent2', darkenColor(accent, 0.78));
  document.documentElement.style.setProperty('--accent-text', accent);
  document.documentElement.style.setProperty('--on-accent', relativeLuminance(accent) > 0.4 ? '#06210f' : '#ffffff');
  if (window.__setBgAccent) window.__setBgAccent(accent);
}

function renderThemeUI() {
  const theme = state.settings.theme || 'dark';
  document.querySelectorAll('#theme-row button').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
  const accent = (state.settings.accent || '').toLowerCase();
  document.querySelectorAll('#accent-swatches button').forEach((b) => {
    b.classList.toggle('active', b.dataset.accent.toLowerCase() === accent);
  });
  if (accent) $('#accent-picker').value = accent;
}

document.querySelectorAll('#theme-row').forEach((row) => {
  row.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-theme]');
    if (!b) return;
    state.settings.theme = b.dataset.theme;
    api.settings.set('theme', b.dataset.theme);
    applyTheme();
    renderThemeUI();
  });
});

document.querySelectorAll('#accent-swatches').forEach((row) => {
  row.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-accent]');
    if (!b) return;
    state.settings.accent = b.dataset.accent;
    api.settings.set('accent', b.dataset.accent);
    applyTheme();
    renderThemeUI();
  });
});

document.querySelectorAll('#accent-picker').forEach((pick) => {
  pick.oninput = (e) => {
    state.settings.accent = e.target.value;
    api.settings.set('accent', e.target.value);
    applyTheme();
    renderThemeUI();
  };
});

function renderRam() {
  const mb = parseInt($('#ram-slider').value, 10) || 2048;
  $('#ram-value').textContent = (mb / 1024).toFixed(mb % 1024 ? 1 : 0) + ' ' + t('gb');
  $('#ram-value').style.minWidth = mb >= 1024 * 16 ? '62px' : '62px';
}
$('#ram-slider').oninput = () => {
  renderRam();
  api.settings.set('memory', parseInt($('#ram-slider').value, 10));
};
document.querySelectorAll('.ram-presets button').forEach((b) => {
  b.onclick = () => {
    $('#ram-slider').value = b.dataset.mb;
    renderRam();
    api.settings.set('memory', parseInt(b.dataset.mb, 10));
  };
});

async function renderJavaList() {
  const box = $('#java-detect');
  const list = await api.java.list();
  if (!list || !list.length) {
    box.innerHTML = `<p class="panel-hint">${t('settings.javaNotFound')}</p>`;
    return;
  }
  box.innerHTML = '';
  for (const j of list.slice(0, 5)) {
    const item = document.createElement('div');
    item.className = 'java-item';
    item.innerHTML = `<span>${escapeHtml(j.vendor)}</span><span class="ver">${j.major}</span><span class="path">${escapeHtml(j.home)}</span>`;
    item.onclick = () => {
      state.settings.javaPath = j.bin;
      api.settings.set('javaPath', j.bin);
      $('#java-path').value = j.bin;
      toast(t('settings.javaPicked'), false);
    };
    box.appendChild(item);
  }
}
$('#btn-java-auto').onclick = async () => {
  const list = await api.java.list();
  if (!list || !list.length) {
    api.settings.set('javaPath', '');
    state.settings.javaPath = '';
    $('#java-path').value = '';
    return toast(t('settings.javaNotFound'));
  }
  state.settings.javaPath = list[0].bin;
  api.settings.set('javaPath', list[0].bin);
  $('#java-path').value = list[0].bin;
  toast(t('settings.javaPicked'), false);
};
$('#btn-java-pick').onclick = async () => {
  const j = await api.java.pick();
  if (!j) return;
  api.settings.set('javaPath', j.bin);
  state.settings.javaPath = j.bin;
  $('#java-path').value = j.bin;
  toast(t('settings.javaPicked'), false);
};
$('#btn-dir-pick').onclick = async () => {
  const dir = await api.dir.pick(t('settings.gameDirPick'));
  if (!dir) return;
  await api.settings.set('gameDir', dir);
  $('#game-dir').value = dir;
  toast(t('settings.gameDirUpdated'), false);
};
$('#ms-client-id').onchange = (e) => api.settings.set('ms.clientId', e.target.value.trim());
$('#ms-redirect').onchange = (e) => api.settings.set('ms.redirectUri', e.target.value.trim());
$('#jvm-args').onchange = (e) => api.settings.set('jvmArgs', e.target.value.trim());
document.querySelectorAll('.author-link').forEach((a) => {
  a.onclick = (e) => {
    e.preventDefault();
    api.shell.open(a.href);
  };
});
$('#btn-dir-open').onclick = async () => {
  const res = await api.dir.open();
  if (!res.ok) toast(res.error);
};
$('#btn-open-folder').onclick = async () => {
  const res = await api.dir.open();
  if (!res.ok) toast(res.error);
};
$('#ms-help').onclick = (e) => {
  e.preventDefault();
  openModal('#modal-mshelp');
};
$('#ms-help-login').onclick = (e) => {
  e.preventDefault();
  closeModals();
  openModal('#modal-mshelp');
};
$('#mshelp-azure').onclick = (e) => {
  e.preventDefault();
  api.shell.open('https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app');
};
$('#mshelp-buy').onclick = (e) => {
  e.preventDefault();
  api.shell.open('https://www.minecraft.net/store/minecraft-java-bedrock-edition-pc');
};
$('#modal-mshelp').querySelectorAll('[data-close]').forEach((b) => {
  b.onclick = closeModals;
});

/* ---------------- custom select ---------------- */
function makeSelect(sel) {
  if (sel.__cs) return;
  sel.__cs = true;

  const wrap = document.createElement('div');
  wrap.className = 'cs';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cs-btn';
  const label = document.createElement('span');
  label.className = 'cs-label';
  const arrow = document.createElement('span');
  arrow.className = 'cs-arrow';
  btn.appendChild(label);
  btn.appendChild(arrow);
  const list = document.createElement('div');
  list.className = 'cs-list hidden';
  wrap.appendChild(btn);
  sel.classList.add('cs-native');
  sel.parentNode.insertBefore(wrap, sel.nextSibling);
  document.body.appendChild(list);

  const render = () => {
    label.textContent = sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
    btn.classList.toggle('cs-disabled', sel.disabled);
    list.innerHTML = '';
    for (const o of sel.options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cs-opt' + (o.selected ? ' active' : '');
      const t = document.createElement('span');
      t.className = 'cs-opt-label';
      t.textContent = o.textContent;
      const check = document.createElement('span');
      check.className = 'cs-opt-check';
      check.textContent = '✓';
      b.appendChild(t);
      b.appendChild(check);
      b.onclick = () => {
        sel.value = o.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        close();
      };
      list.appendChild(b);
    }
  };

  const close = () => {
    list.classList.add('hidden');
    btn.classList.remove('open');
  };

  const open = () => {
    render();
    const r = btn.getBoundingClientRect();
    list.style.left = r.left + 'px';
    list.style.width = r.width + 'px';
    list.style.maxHeight = '220px';
    const estimate = Math.min(220, sel.options.length * 34 + 10);
    if (r.bottom + 5 + estimate > window.innerHeight && r.top - 5 - estimate > 0) {
      list.style.top = (r.top - 5 - estimate) + 'px';
    } else {
      list.style.top = (r.bottom + 5) + 'px';
    }
    list.classList.remove('hidden');
    btn.classList.add('open');
  };

  btn.onclick = (e) => {
    e.stopPropagation();
    const wasHidden = list.classList.contains('hidden');
    document.querySelectorAll('.cs-list').forEach((l) => l.classList.add('hidden'));
    document.querySelectorAll('.cs-btn').forEach((b) => b.classList.remove('open'));
    if (wasHidden) open();
  };
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target) && !list.contains(e.target)) close();
  }, true);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', (e) => {
    if (!list.contains(e.target)) close();
  }, true);
  sel.addEventListener('change', render);
  sel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', {
    get() {
      return valueDesc.get.call(this);
    },
    set(v) {
      valueDesc.set.call(this, v);
      render();
    },
  });
  const disabledDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'disabled');
  Object.defineProperty(sel, 'disabled', {
    get() {
      return disabledDesc.get.call(this);
    },
    set(v) {
      disabledDesc.set.call(this, v);
      btn.classList.toggle('cs-disabled', !!v);
    },
  });
  new MutationObserver(() => render()).observe(sel, { childList: true, subtree: true });

  render();
}

function initCustomSelects() {
  document.querySelectorAll('select').forEach(makeSelect);
}

/* ---------------- init ---------------- */
(async function init() {
  initCustomSelects();
  await loadSettings();
  await refreshAccounts();
  loadVersions();
  loadInstalledPacks();
  if (!state.settings.tosAccepted || !state.settings.eulaAccepted) showAgreements();
})();
