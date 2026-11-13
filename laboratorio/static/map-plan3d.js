import * as T from './vendor/three.module.js';

/*
 * Illustrative 3D miniature of the public retail plan reconstructed from the November 2026 drawing.
 * Facades, signage, glazing and interior glow are procedural ILLUSTRATIONS (no photos, no external assets).
 * Store x/z, polygons, graph nodes and route paths are used read-only. Every decorative element is
 * validated with point-in-polygon tests and placed inside its own store polygon, so corridors stay clear.
 * Stores without a surveyed polygon remain pins.
 */

const DEFAULT_ANGLE = .45, CAM_DIST = 350, CAM_HEIGHT = 300;
const FONT = '"Segoe UI", Inter, Arial, sans-serif';
const PALETTE = ['#b8cbb0', '#e0c19a', '#a9c9c7', '#c5b4cc', '#d7cc99'];
const CREAM = new T.Color('#f7f2e7'), ROOF = new T.Color('#efe9dc'), DARK = new T.Color('#1d2a25'), WHITE = new T.Color('#ffffff');
const PIN_COLOR = new T.Color('#c48a3f'), PIN_SELECTED = new T.Color('#0f7a64');
const SUN_DIR = new T.Vector3(-.6, 1, .15).normalize();

// ---------- 2D helpers on [x, z] point arrays ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function cleanPoly(points) {
  const out = [];
  for (const p of points || []) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) out.push([+p[0], +p[1]]); }
  while (out.length > 2) { const a = out[0], b = out[out.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-4) break; out.pop(); }
  return out;
}
function polyArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a / 2; }
function pointInPoly(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const t = l2 ? clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / l2, 0, 1) : 0;
  return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz);
}
function segCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(c, d, a) * o(c, d, b) < 0 && o(a, b, c) * o(a, b, d) < 0;
}
function isSimple(p) {
  const n = p.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segCross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return false;
  }
  return true;
}
// Closed Douglas–Peucker: removes CAD tracing jitter before offsetting (never used for footprints).
function simplifyPoly(p, tol) {
  if (p.length <= 4) return p;
  let far = 0, fd = -1;
  for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]); if (d > fd) { fd = d; far = i; } }
  const dp = pts => {
    const n = pts.length; if (n < 3) return pts;
    let idx = 0, md = 0;
    for (let i = 1; i < n - 1; i++) { const d = segDist(pts[i][0], pts[i][1], pts[0], pts[n - 1]); if (d > md) { md = d; idx = i; } }
    if (md <= tol) return [pts[0], pts[n - 1]];
    return dp(pts.slice(0, idx + 1)).slice(0, -1).concat(dp(pts.slice(idx)));
  };
  const out = dp(p.slice(0, far + 1)).slice(0, -1).concat(dp(p.slice(far).concat([p[0]])).slice(0, -1));
  return out.length >= 3 && isSimple(out) ? out : p;
}
// Mitred inward offset of p, validated against the reference outline ref (defaults to p):
// returns null when the result would leave ref, cross it or self-intersect.
function insetPoly(p, d, ref = p) {
  const n = p.length; if (n < 3) return null;
  const sgn = Math.sign(polyArea(p)) || 1, normals = [];
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    if (l < 1e-6) return null;
    normals.push([-dz / l * sgn, dx / l * sgn]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const n0 = normals[(i - 1 + n) % n], n1 = normals[i], k = 1 + n0[0] * n1[0] + n0[1] * n1[1];
    if (k < .25) return null;
    out.push([p[i][0] + (n0[0] + n1[0]) / k * d, p[i][1] + (n0[1] + n1[1]) / k * d]);
  }
  const m = ref.length, minGap = ref === p ? d * .8 : d * .45;
  for (const q of out) {
    if (!pointInPoly(q[0], q[1], ref)) return null;
    for (let i = 0; i < m; i++) if (segDist(q[0], q[1], ref[i], ref[(i + 1) % m]) < minGap) return null;
  }
  if (Math.sign(polyArea(out)) !== sgn || !isSimple(out)) return null;
  if (ref !== p) for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) if (segCross(out[i], out[(i + 1) % n], ref[j], ref[(j + 1) % m])) return null;
  return out;
}
const insetSmooth = (p, d) => insetPoly(p, d) || insetPoly(simplifyPoly(p, Math.min(.25, d * .55)), d, p);
function hashStr(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const angDiff = (a, b) => ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;

// ---------- three.js geometry helpers ----------
function shapeOf(points, hole) {
  const sh = new T.Shape();
  points.forEach((p, i) => i ? sh.lineTo(p[0], -p[1]) : sh.moveTo(p[0], -p[1])); sh.closePath();
  if (hole) { const h = new T.Path(); hole.forEach((p, i) => i ? h.lineTo(p[0], -p[1]) : h.moveTo(p[0], -p[1])); h.closePath(); sh.holes.push(h); }
  return sh;
}
function extrude(points, depth, hole) {
  const g = new T.ExtrudeGeometry(shapeOf(points, hole), { depth, bevelEnabled: false, steps: 1, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); return g;
}
// Bakes one colour per material group (0 = caps, 1 = sides) into vertex colours → one draw call.
function paintGroups(geo, colors) {
  const n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: n, materialIndex: 0 }];
  for (const g of groups) { const c = colors[g.materialIndex] || colors[0]; for (let k = g.start; k < Math.min(n, g.start + g.count); k++) { arr[k * 3] = c.r; arr[k * 3 + 1] = c.g; arr[k * 3 + 2] = c.b; } }
  geo.setAttribute('color', new T.BufferAttribute(arr, 3)); geo.clearGroups(); return geo;
}
// Minimal merge for position/normal(/color) geometries.
function merge(items) {
  const geos = items.map(it => it.geo.index ? it.geo.toNonIndexed() : it.geo);
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const withColor = geos.some(g => g.attributes.color);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = withColor ? new Float32Array(n * 3) : null;
  let o = 0;
  geos.forEach((g, i) => {
    const p = g.attributes.position; pos.set(p.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (col) { if (g.attributes.color) col.set(g.attributes.color.array, o * 3); else col.fill(1, o * 3, (o + p.count) * 3); }
    o += p.count; g.dispose(); if (g !== items[i].geo) items[i].geo.dispose();
  });
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3)); out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  if (col) out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.computeBoundingSphere(); return out;
}
function canvasTex(cv, aniso = 1, repeat = false) {
  const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping; return t;
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

export function createPlanScene(container, data, onSelect) {
  const scene = new T.Scene(); scene.background = new T.Color('#e7ecdf');
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6)); renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false; // static scene: shadows re-rendered on floor change only
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Maquete 3D ilustrativa da planta. Fachadas, letreiros e interiores são desenhos, não fotos. A lista de destinos oferece o mesmo conteúdo.');
  container.append(canvas);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const camera = new T.OrthographicCamera(-100, 100, 100, -100, .1, 2500);
  const owned = []; const own = x => (owned.push(x), x);

  scene.add(new T.HemisphereLight('#fffaf0', '#78866b', 1.55));
  const sun = new T.DirectionalLight('#fff0d8', 2.55); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -.0004; sun.shadow.normalBias = .06; scene.add(sun, sun.target);
  const fill = new T.DirectionalLight('#dce8ff', .55); fill.position.set(160, 120, 140); scene.add(fill);

  // ---------- procedural textures (illustrations only) ----------
  function tileTexture() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d'), r = rng(7);
    c.fillStyle = '#f5f1e6'; c.fillRect(0, 0, 128, 128);
    const cols = ['#e7e0cf', '#ddd5c2', '#ece5d6', '#d8dfcf', '#eadcc4'];
    for (let i = 0; i < 240; i++) { c.globalAlpha = .45 + r() * .5; c.fillStyle = cols[i % 5]; c.beginPath(); c.arc(r() * 128, r() * 128, .5 + r() * 1.2, 0, 7); c.fill(); }
    c.globalAlpha = 1; c.strokeStyle = '#e3dccb'; c.lineWidth = 1.5;
    for (const v of [.75, 64.75]) { c.beginPath(); c.moveTo(v, 0); c.lineTo(v, 128); c.moveTo(0, v); c.lineTo(128, v); c.stroke(); }
    const t = canvasTex(cv, aniso, true); t.repeat.set(1 / 7, 1 / 7); return t;
  }
  function interiorTexture() { // warm retail interior glow behind the glass; horizontally uniform so stretching is harmless
    const cv = document.createElement('canvas'); cv.width = 16; cv.height = 128; const c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#4a3b30'); g.addColorStop(.13, '#7d5f45'); g.addColorStop(.17, '#fff3d4'); g.addColorStop(.22, '#eeb977');
    g.addColorStop(.62, '#f5cd8c'); g.addColorStop(1, '#ffe8bd'); c.fillStyle = g; c.fillRect(0, 0, 16, 128);
    c.fillStyle = 'rgba(122,80,42,.38)'; for (const y of [50, 76]) c.fillRect(0, y, 16, 4);
    c.fillStyle = 'rgba(255,255,255,.22)'; c.fillRect(0, 104, 16, 2);
    return canvasTex(cv);
  }
  function chevronTexture() {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32; const c = cv.getContext('2d');
    c.strokeStyle = 'rgba(255,253,240,.95)'; c.lineWidth = 6; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(22, 7); c.lineTo(38, 16); c.lineTo(22, 25); c.stroke();
    const t = canvasTex(cv, aniso); t.wrapS = T.RepeatWrapping; return t;
  }
  const tileTex = own(tileTexture()), interiorTex = own(interiorTexture()), chevronTex = own(chevronTexture());

  // ---------- shared materials & geometries ----------
  const std = o => own(new T.MeshStandardMaterial(o));
  const M = {
    floorTop: std({ map: tileTex, color: '#ffffff', roughness: .92 }), floorSide: std({ color: '#cbc3ae', roughness: .95 }),
    corridor: std({ color: '#e6dec9', roughness: .96 }),
    body: std({ vertexColors: true, roughness: .84 }),
    bodySel: std({ vertexColors: true, roughness: .84, emissive: '#5d8a2c', emissiveIntensity: .3 }),
    parapet: std({ vertexColors: true, roughness: .78 }),
    glass: std({ map: interiorTex, emissive: '#ffd8a0', emissiveMap: interiorTex, emissiveIntensity: .55, roughness: .22, metalness: .05 }),
    door: std({ color: '#2e3a38', roughness: .2, metalness: .2 }),
    frame: std({ color: '#3a403b', roughness: .5, metalness: .3 }),
    canopy: std({ color: '#f8f4ea', roughness: .7 }),
    fascia: std({ color: '#ffffff', roughness: .62 }),
    plant: std({ color: '#5f8d4e', roughness: .9, flatShading: true }),
    roofUnit: std({ color: '#d9d7cf', roughness: .7, metalness: .1 }),
    skylight: std({ color: '#b6d1d6', roughness: .15, metalness: .25 }),
    mat: std({ color: '#f1dca0', roughness: .9 }),
    pin: std({ color: '#ffffff', roughness: .45 }),
    plateEdge: own(new T.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: .75 })),
    selRing: own(new T.MeshBasicMaterial({ color: '#c9ee4f', transparent: true, opacity: .95, toneMapped: false, side: T.DoubleSide, depthWrite: false })),
    selLine: own(new T.LineBasicMaterial({ color: '#7fae1f' })),
    sign: null,
  };
  const RM = {
    casing: own(new T.MeshBasicMaterial({ color: '#fffef6', transparent: true, opacity: .9, toneMapped: false, side: T.DoubleSide, depthWrite: false })),
    line: own(new T.MeshBasicMaterial({ color: '#008b75', toneMapped: false, side: T.DoubleSide })),
    ghost: own(new T.MeshBasicMaterial({ color: '#008b75', transparent: true, opacity: .3, toneMapped: false, side: T.DoubleSide, depthTest: false, depthWrite: false })),
    flow: own(new T.MeshBasicMaterial({ map: chevronTex, transparent: true, toneMapped: false, side: T.DoubleSide, depthWrite: false })),
    end: own(new T.MeshBasicMaterial({ color: '#008b75', toneMapped: false })),
    endCore: own(new T.MeshBasicMaterial({ color: '#fffef6', toneMapped: false })),
    transfer: own(new T.MeshBasicMaterial({ color: '#c48a3f', toneMapped: false, side: T.DoubleSide })),
  };
  const unitBox = own(new T.BoxGeometry(1, 1, 1)), plantGeo = own(new T.IcosahedronGeometry(1, 1));
  const pinGeo = own(merge([{ geo: new T.SphereGeometry(.46, 18, 12).translate(0, 1.22, 0) }, { geo: new T.ConeGeometry(.4, 1, 18, 1, true).rotateX(Math.PI).translate(0, .55, 0) }]));

  // ---------- data indexes ----------
  const nodeById = new Map(data.nodes.map(n => [n.id, n]));
  const corridorNodes = new Map();
  for (const e of data.edges) if (e.kind === 'corridor') for (const id of [e.from, e.to]) { const n = nodeById.get(id); if (!n) continue; if (!corridorNodes.has(n.floor_id)) corridorNodes.set(n.floor_id, new Set()); corridorNodes.get(n.floor_id).add(n); }
  function nearestCorridorNode(fid, x, z) { let best = null, bd = Infinity; for (const n of corridorNodes.get(fid) || []) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n; } } return best; }

  const roofViews = [];
  let cutaway = true;
  const floorGroups = new Map(), floorInfo = new Map(), meta = new Map(), hitObjects = [], labels = [], labelsByFloor = new Map(), signEntries = [];
  const measure = document.createElement('canvas').getContext('2d');
  const tmp = new T.Object3D();

  function addLabel(o) {
    measure.font = `600 30px ${FONT}`;
    const tw = Math.min(560, measure.measureText(o.text).width), cw = Math.ceil(tw + 70), ch = 72;
    const sp = new T.Sprite(new T.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
    sp.center.set(.5, -.12); sp.renderOrder = 20; sp.visible = false; sp.position.set(o.x, o.y, o.z);
    floorGroups.get(o.floor).add(sp);
    const l = { ...o, sprite: sp, cw, ch, aspect: cw / ch, tex: null }; labels.push(l); return l;
  }
  function paintLabel(cv, l, style) {
    cv.width = l.cw; cv.height = l.ch; const c = cv.getContext('2d');
    const S = { store: ['#fffef9', '#173c32', 'rgba(23,60,50,.16)'], pin: ['#fff6e6', '#6b4a17', 'rgba(150,100,30,.3)'], anchor: ['#173c32', '#fffef9', 'rgba(0,0,0,0)'], selected: ['#d9f57c', '#173c32', '#173c32'] }[style] || ['#fffef9', '#173c32', '#ccc'];
    c.shadowColor = 'rgba(23,60,50,.22)'; c.shadowBlur = 6; c.shadowOffsetY = 2;
    roundRect(c, 4, 3, l.cw - 8, 60, 18); c.fillStyle = S[0]; c.fill();
    c.shadowColor = 'transparent'; c.lineWidth = style === 'selected' ? 3 : 2; c.strokeStyle = S[2]; c.stroke();
    c.beginPath(); c.arc(30, 33, 8.5, 0, 7); c.fillStyle = style === 'anchor' ? '#d9f57c' : style === 'pin' ? '#c48a3f' : l.color || '#5a8a6f'; c.fill();
    c.lineWidth = 2.5; c.strokeStyle = style === 'anchor' ? '#173c32' : '#fffef9'; c.stroke();
    c.font = `600 30px ${FONT}`; c.fillStyle = S[1]; c.textBaseline = 'middle'; c.fillText(l.text, 48, 34, l.cw - 60);
  }
  function ensureLabel(l) {
    if (l.tex) return;
    const cv = document.createElement('canvas'); paintLabel(cv, l, l.kind);
    l.tex = canvasTex(cv); l.sprite.material.map = l.tex; l.sprite.material.needsUpdate = true;
  }

  // ---------- floor construction ----------
  function buildBase(f, g, info) {
    const { plate, bounds: b } = info;
    const geo = extrude(plate, 1.2); geo.translate(0, -1.2, 0);
    const slab = new T.Mesh(geo, [M.floorTop, M.floorSide]); slab.receiveShadow = true; g.add(slab);
    g.add(new T.LineLoop(new T.BufferGeometry().setFromPoints(plate.map(p => new T.Vector3(p[0], .012, p[1]))), M.plateEdge));
    // Miniature "table" with a soft contact shadow under the slab (procedural canvas, no assets).
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ, margin = Math.max(w, d) * .14;
    const x0 = b.minX - margin, x1 = b.maxX + margin, z0 = b.minZ - margin, z1 = b.maxZ + margin;
    const cw = 512, chh = Math.max(64, Math.round(512 * (z1 - z0) / (x1 - x0)));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = chh; const c = cv.getContext('2d');
    const OFF = 4000; c.shadowColor = 'rgba(38,58,40,.42)'; c.shadowBlur = 22; c.shadowOffsetX = OFF;
    c.beginPath(); plate.forEach((p, i) => { const X = (p[0] + 1.6 - x0) / (x1 - x0) * cw - OFF, Y = (p[1] - z0) / (z1 - z0) * chh; i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.closePath(); c.fillStyle = '#000'; c.fill();
    const shadowTex = own(canvasTex(cv));
    const sh = new T.Mesh(new T.PlaneGeometry(x1 - x0, z1 - z0), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.set((x0 + x1) / 2, -1.23, (z0 + z1) / 2); g.add(sh);
    const gc = document.createElement('canvas'); gc.width = gc.height = 128; const gx = gc.getContext('2d');
    const grad = gx.createRadialGradient(64, 64, 6, 64, 64, 64); grad.addColorStop(0, '#f2f5ec'); grad.addColorStop(1, '#e7ecdf'); gx.fillStyle = grad; gx.fillRect(0, 0, 128, 128);
    const size = Math.max(w, d) * 3.2;
    const ground = new T.Mesh(new T.PlaneGeometry(size, size), new T.MeshBasicMaterial({ map: own(canvasTex(gc)), toneMapped: false }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(info.cx, -1.26, info.cz); g.add(ground);
  }
  function buildCorridors(f, g, info) {
    const parts = [], used = new Set(), cw = info.corridorW;
    for (const e of data.edges) {
      if (e.kind !== 'corridor') continue;
      const a = nodeById.get(e.from), b = nodeById.get(e.to);
      if (a?.floor_id !== f.id || b?.floor_id !== f.id) continue;
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz); if (len < .001) continue;
      const geo = new T.BoxGeometry(cw, .05, len); geo.rotateY(Math.atan2(dx, dz)); geo.translate((a.x + b.x) / 2, .025, (a.z + b.z) / 2);
      parts.push({ geo }); used.add(a); used.add(b);
    }
    for (const n of used) parts.push({ geo: new T.CylinderGeometry(cw / 2, cw / 2, .05, 18).translate(n.x, .025, n.z) });
    if (parts.length) { const m = new T.Mesh(merge(parts), M.corridor); m.receiveShadow = true; g.add(m); }
  }
  function pickFacade(poly, door, sgn) {
    let best = null; const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1.6) continue;
      const sc = segDist(door.x, door.z, a, b) - Math.min(L, 10) * .12; if (!best || sc < best.sc) best = { i, sc, L };
    }
    if (!best) return null;
    const a = poly[best.i], b = poly[(best.i + 1) % n], ux = (b[0] - a[0]) / best.L, uz = (b[1] - a[1]) / best.L;
    return { i: best.i, a, L: best.L, ux, uz, nx: -uz * sgn, nz: ux * sgn, ud: clamp((door.x - a[0]) * ux + (door.z - a[1]) * uz, 0, best.L) };
  }
  // Storefront: glazing + mullions + door + canopy + fascia sign, all inside the recessed strip of the polygon.
  function facadeDecor(s, fac, poly, h, fascia, inst, signs) {
    const { a, L, ux, uz, nx, nz, r } = fac;
    const P = (u, w) => [a[0] + ux * u + nx * w, a[1] + uz * u + nz * w];
    const inside = u => [.03, r * .5, r + .12].every(w => { const p = P(u, w); return pointInPoly(p[0], p[1], poly); });
    const m = Math.min(.45, L * .12); let s0 = m, s1 = L - m;
    if (L > 17) { const W = Math.min(15, L - 2 * m), c = clamp(fac.ud, m + W / 2, L - m - W / 2); s0 = c - W / 2; s1 = c + W / 2; }
    for (let k = 0; k < 40 && s1 - s0 > 1.2 && !inside(s0); k++) s0 += .25;
    for (let k = 0; k < 40 && s1 - s0 > 1.2 && !inside(s1); k++) s1 -= .25;
    if (s1 - s0 < 1.2) return false;
    for (let u = s0; u <= s1; u += .5) if (!inside(u)) return false;
    const rot = Math.atan2(-uz, ux), span = s1 - s0, uc = (s0 + s1) / 2;
    const gH = Math.min(h * .64, 2.7), fy0 = gH + .1, fh = clamp(h - gH - .32, .34, h > 4 ? 1.05 : .6);
    const box = (list, u, w, y, len, th, ht, c) => { const p = P(u, w); list.push({ x: p[0], y, z: p[1], sx: len, sy: ht, sz: th, r: rot, c }); };
    box(inst.glass, uc, r - .025, (.05 + gH) / 2, span, .05, gH - .05);
    const dw = Math.min(1.3, span * .34), du = clamp(fac.ud, s0 + dw / 2 + .15, s1 - dw / 2 - .15), dH = gH * .78;
    box(inst.door, du, r - .055, .03 + dH / 2, dw, .03, dH);
    const cnt = Math.max(1, Math.round(span / 1.3));
    for (let k = 0; k <= cnt; k++) { const u = s0 + span * k / cnt; if (Math.abs(u - du) < dw / 2 + .12) continue; box(inst.frame, u, r - .07, (.05 + gH) / 2, .07, .08, gH - .05); }
    for (const u of [du - dw / 2, du + dw / 2]) box(inst.frame, u, r - .075, (.03 + dH) / 2 + .02, .08, .09, dH);
    box(inst.frame, uc, r - .07, dH + .06, span, .08, .06);           // transom
    box(inst.frame, uc, r - .07, gH, span, .09, .08);                 // header
    const kl = du - dw / 2 - s0, kr = s1 - du - dw / 2;                // kick plates beside the door
    if (kl > .05) box(inst.frame, s0 + kl / 2, r - .07, .1, kl, .09, .14);
    if (kr > .05) box(inst.frame, s1 - kr / 2, r - .07, .1, kr, .09, .14);
    box(inst.canopy, uc, (r + .03) / 2, gH + .08, span, r - .03, .06);
    box(inst.fascia, uc, r - .09, fy0 + fh / 2, span, .12, fh, fascia);
    if (span > 3.6) for (const u of [s0 + .24, s1 - .24]) { if (Math.abs(u - du) < dw / 2 + .3) continue; const p = P(u, .16); inst.plant.push({ x: p[0], y: .15, z: p[1], sx: .12, sy: .15, sz: .12, r: 0 }); }
    const A = 256 / 48, sh = Math.min(fh * .72, span * .84 / A), sw = sh * A;
    if (sw > .55) { const c = P(uc, r - .152); signs.push({ index: signEntries.push({ text: s.name, color: fascia }) - 1, x: c[0], y: fy0 + fh / 2, z: c[1], nx, nz, sw, sh }); }
    return true;
  }
  function roofDecor(s, inner, h, area, inst) {
    if (!inner || area < 30) return;
    const R = rng(hashStr(s.id));
    let best = 0, rot = 0; const n = inner.length;
    for (let i = 0; i < n; i++) { const a = inner[i], b = inner[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > best) { best = L; rot = Math.atan2(-(b[1] - a[1]), b[0] - a[0]); } }
    const X = [Math.cos(rot), -Math.sin(rot)], Z = [Math.sin(rot), Math.cos(rot)];
    const fits = (cx, cz, hx, hz) => [[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([i, j]) => pointInPoly(cx + X[0] * hx * i + Z[0] * hz * j, cz + X[1] * hx * i + Z[1] * hz * j, inner));
    const xs = inner.map(p => p[0]), zs = inner.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const placed = [];
    if (area >= 380) { // anchor-scale roofs: skylight bands along the main axis
      const proj = inner.map(p => (p[0] - s.x) * X[0] + (p[1] - s.z) * X[1]), len = (Math.max(...proj) - Math.min(...proj)) * .42;
      for (const k of [-1, 0, 1]) { const cx = s.x + Z[0] * k * 2.6, cz = s.z + Z[1] * k * 2.6; if (len > 2 && fits(cx, cz, len / 2 + .1, .55)) { inst.skylight.push({ x: cx, y: h + .045, z: cz, sx: len, sy: .09, sz: .9, r: rot }); for (let t = -.5; t <= .5; t += .25) placed.push([cx + X[0] * len * t, cz + X[1] * len * t, 1.2]); } }
    }
    const want = Math.min(6, 1 + Math.floor(area / 150));
    let units = 0;
    for (let tries = 0; tries < want * 12 && units < want; tries++) {
      const sx = .6 + R() * .7, sz = .45 + R() * .45, sy = .32 + R() * .28, cx = minX + R() * (maxX - minX), cz = minZ + R() * (maxZ - minZ);
      if (!fits(cx, cz, sx / 2 + .1, sz / 2 + .1)) continue;
      if (placed.some(q => Math.hypot(q[0] - cx, q[1] - cz) < (q[2] + Math.max(sx, sz)) * .75)) continue;
      placed.push([cx, cz, Math.max(sx, sz)]); units++;
      inst.roofUnit.push({ x: cx, y: h + sy / 2, z: cz, sx, sy, sz, r: rot });
    }
  }
  function buildStore(s, i, f, g, inst, parapets, signs, pins) {
    const color = new T.Color(s.color || PALETTE[i % 5]);
    const poly = cleanPoly(s.polygon);
    const doorNode = nodeById.get(s.node_id);
    const door = doorNode && doorNode.floor_id === f.id ? doorNode : nearestCorridorNode(f.id, s.x, s.z);
    if (poly.length < 3) {
      pins.push(s);
      meta.set(s.id, { id: s.id, name: s.name, floor: f.id, kind: 'pin', x: s.x, z: s.z, top: 1.7, color, pts: [[s.x - 5, 0, s.z - 5], [s.x + 5, 0, s.z + 5], [s.x - 5, 0, s.z + 5], [s.x + 5, 3, s.z - 5]] });
      addLabel({ id: s.id, floor: f.id, kind: 'pin', text: `${s.name} · conferir`, x: s.x, y: 2, z: s.z, area: 0 });
      return;
    }
    const area = Math.abs(polyArea(poly)), sgn = Math.sign(polyArea(poly)) || 1;
    const h = area > 700 ? 5.2 : area > 250 ? 4.1 : area > 90 ? 3.4 : 2.8;
    let body = poly, fac = door ? pickFacade(poly, door, sgn) : null;
    if (fac) { // Recess only the centre of the edge; retain the original corners.
      const r=.32, margin=Math.min(.35,fac.L*.12), P=(u,w)=>[fac.a[0]+fac.ux*u+fac.nx*w,fac.a[1]+fac.uz*u+fac.nz*w];
      const q0=P(margin,r), q1=P(fac.L-margin,r);
      if(pointInPoly(q0[0],q0[1],poly)&&pointInPoly(q1[0],q1[1],poly)){
        const moved=[];poly.forEach((p,k)=>{moved.push(p.slice());if(k===fac.i)moved.push(P(margin,0),q0,q1,P(fac.L-margin,0));});
        if(isSimple(moved)){body=moved;fac.r=r;}else fac=null;
      }else fac=null;
    }
    const fascia = color.clone().lerp(DARK, .42);
    if (fac && !facadeDecor(s, fac, poly, h, fascia, inst, signs)) { body = poly; fac = null; }
    const inner = insetSmooth(body, clamp(Math.sqrt(area) * .03, .18, .42));
    const wall = color.clone().lerp(CREAM, .52), roof = color.clone().lerp(ROOF, inner ? .3 : .12), crown = color.clone().lerp(DARK, .1);
    // Dollhouse view: floor and side walls preserve the exact footprint; roof is independently switchable.
    const shell = extrude(body, h), caps = shell.groups.find(q => q.materialIndex === 0);
    if (caps) for (let k = caps.start; k < caps.start + caps.count; k++) if (shell.attributes.position.getY(k) > h * .5) shell.attributes.position.setY(k, .075);
    shell.attributes.position.needsUpdate = true;
    const mesh = new T.Mesh(paintGroups(shell, [color.clone().lerp(CREAM,.9), wall]), M.body);
    const roofGeo = new T.ShapeGeometry(shapeOf(body)); roofGeo.rotateX(-Math.PI/2);
    const roofMesh = new T.Mesh(roofGeo, own(new T.MeshStandardMaterial({color:roof,roughness:.85,side:T.DoubleSide})));
    roofMesh.position.y=h; roofMesh.visible=!cutaway; roofMesh.receiveShadow=true; roofMesh.userData.store=s.id; g.add(roofMesh); roofViews.push(roofMesh); hitObjects.push(roofMesh);
    // Fictional retail fittings, always contained in the shop. Never used for routing.
    const xs=body.map(p=>p[0]), zs=body.map(p=>p[1]), minX=Math.min(...xs), maxX=Math.max(...xs), minZ=Math.min(...zs), maxZ=Math.max(...zs);
    const spacing=Math.max(3.4,Math.sqrt(area/34)), food=s.floor_id==='f1', rr=rng(hashStr(s.id));
    const fits=(x,z,w,d)=>[[0,0],[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].every(([a,b])=>pointInPoly(x+a,z+b,body)&&body.every((q,k)=>segDist(x+a,z+b,q,body[(k+1)%body.length])>.7));
    for(let x=minX+spacing*.7;x<maxX-spacing*.3;x+=spacing) for(let z=minZ+spacing*.7;z<maxZ-spacing*.3;z+=spacing){
      const w=food?1.4:spacing*.55,d=food?1.4:Math.min(1.7,spacing*.28); if(!fits(x,z,w,d)||rr()<.18)continue;
      if(doorNode&&Math.hypot(x-doorNode.x,z-doorNode.z)<4)continue;
      inst.fittings.push({x,y:food?.8:.68,z,sx:w,sy:food?.14:1.2,sz:d,r:0,c:new T.Color(food?'#ae8057':'#d7c5a7')});
      if(food){for(const dx of [-1,1])inst.fittings.push({x:x+dx*.9,y:.4,z,sx:.35,sy:.7,sz:.45,r:0,c:color});}
      else {for(let j=0;j<3;j++)inst.fittings.push({x:x-w*.32+j*w*.32,y:1.38,z,sx:w*.22,sy:.2+rr()*.3,sz:d*.7,r:0,c:new T.Color(['#db6d4c','#467b8b','#d9b84d','#ede1cb'][Math.floor(rr()*4)])});}
    }
    mesh.castShadow = mesh.receiveShadow = true; mesh.userData.store = s.id; g.add(mesh); hitObjects.push(mesh);
    let top = h;
    if (inner) { const pg = extrude(body, .36, inner); pg.translate(0, h, 0); parapets.push({ geo: paintGroups(pg, [crown.clone().lerp(WHITE, .14), crown]) }); top = h + .36; }
    roofDecor(s, inner, h, area, inst);
    if (doorNode && doorNode.floor_id === f.id) inst.mat.push({ x: doorNode.x, y: .065, z: doorNode.z, sx: .8, sy: .03, sz: .8, r: fac ? Math.atan2(-fac.uz, fac.ux) : 0 });
    const pts = []; for (const p of body) pts.push([p[0], 0, p[1]], [p[0], top + 1.5, p[1]]);
    meta.set(s.id, { id: s.id, name: s.name, floor: f.id, kind: 'poly', x: s.x, z: s.z, top, body, mesh, color, pts, facadeAngle: door ? Math.atan2(door.x-s.x,door.z-s.z) : DEFAULT_ANGLE });
    addLabel({ id: s.id, floor: f.id, kind: 'store', text: s.name, color: '#' + color.getHexString(), featured: Boolean(s.featured), x: s.x, y: top + .3, z: s.z, area });
  }
  function instanced(g, geo, mat, items, { cast = false, receive = false, colors = false } = {}) {
    if (!items.length) return null;
    const m = new T.InstancedMesh(geo, mat, items.length);
    items.forEach((it, i) => { tmp.position.set(it.x, it.y, it.z); tmp.rotation.set(0, it.r || 0, 0); tmp.scale.set(it.sx, it.sy, it.sz); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); if (colors) m.setColorAt(i, it.c); });
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = cast; m.receiveShadow = receive; m.computeBoundingSphere(); g.add(m); return m;
  }

  for (const f of data.floors) {
    const g = new T.Group(); floorGroups.set(f.id, g); scene.add(g);
    const b = f.bounds, plate = cleanPoly(f.floorplate || [[b.minX - 5, b.minZ - 5], [b.maxX + 5, b.minZ - 5], [b.maxX + 5, b.maxZ + 5], [b.minX - 5, b.maxZ + 5]]);
    const diag = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ);
    const info = { plate, bounds: b, diag, cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, routeW: clamp(diag * .0027, .4, 1.15), corridorW: clamp(diag * .0052, .8, 2.3), signs: [], pins: null };
    floorInfo.set(f.id, info);
    buildBase(f, g, info); buildCorridors(f, g, info);
    const inst = { glass: [], door: [], frame: [], canopy: [], fascia: [], plant: [], roofUnit: [], skylight: [], mat: [], fittings: [] }, parapets = [], pins = [];
    data.stores.filter(s => s.floor_id === f.id).forEach((s, i) => buildStore(s, i, f, g, inst, parapets, info.signs, pins));
    if (parapets.length) { const pm = new T.Mesh(merge(parapets), M.parapet); pm.castShadow = pm.receiveShadow = true; g.add(pm); }
    instanced(g, unitBox, M.glass, inst.glass); instanced(g, unitBox, M.door, inst.door); instanced(g, unitBox, M.frame, inst.frame);
    instanced(g, unitBox, M.canopy, inst.canopy, { cast: true, receive: true }); instanced(g, unitBox, M.fascia, inst.fascia, { colors: true });
    instanced(g, plantGeo, M.plant, inst.plant); const units=instanced(g, unitBox, M.roofUnit, inst.roofUnit, { cast: true, receive: true }); if(units){units.visible=!cutaway;roofViews.push(units);}
    const sky=instanced(g, unitBox, M.skylight, inst.skylight); if(sky){sky.visible=!cutaway;roofViews.push(sky);} instanced(g, unitBox, M.mat, inst.mat); instanced(g, unitBox, M.fascia, inst.fittings, {colors:true,receive:true});
    if (pins.length) {
      const pm = instanced(g, pinGeo, M.pin, pins.map(s => ({ x: s.x, y: 0, z: s.z, sx: 1, sy: 1, sz: 1, r: 0, c: PIN_COLOR })), { cast: true, colors: true });
      pm.userData.ids = pins.map(s => s.id); hitObjects.push(pm); info.pins = pm;
      pins.forEach((s, k) => Object.assign(meta.get(s.id), { pinMesh: pm, pinIndex: k }));
    }
    for (const a of data.anchors) { const n = nodeById.get(a.node_id); if (n?.floor_id === f.id) addLabel({ id: 'anchor:' + a.node_id, floor: f.id, kind: 'anchor', text: a.short_label || a.label, x: n.x, y: .6, z: n.z, area: 0 }); }
    const rank = l => l.kind === 'anchor' ? 0 : l.featured ? 1 : l.kind === 'store' ? 2 : 3;
    labelsByFloor.set(f.id, labels.filter(l => l.floor === f.id).sort((p, q) => rank(p) - rank(q) || q.area - p.area));
  }
  // Facade sign atlas: one texture, one merged quad mesh per floor.
  if (signEntries.length) {
    const cols = 4, cw = 256, chh = 48, rows = Math.ceil(signEntries.length / cols), W = cols * cw, H = rows * chh;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
    signEntries.forEach((e, i) => {
      const x = (i % cols) * cw, y = Math.floor(i / cols) * chh;
      c.fillStyle = e.color.getStyle(); c.fillRect(x, y, cw, chh);
      c.fillStyle = 'rgba(255,255,255,.16)'; c.fillRect(x, y + 3, cw, 2);
      c.font = `700 24px ${FONT}`; c.fillStyle = '#fff4dc'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(e.text).toUpperCase(), x + cw / 2, y + chh / 2 + 1, cw - 22);
    });
    M.sign = own(new T.MeshBasicMaterial({ map: own(canvasTex(cv, aniso)), toneMapped: false, side: T.DoubleSide }));
    for (const [fid, info] of floorInfo) {
      if (!info.signs.length) continue;
      const pos = [], uv = [];
      for (const s of info.signs) {
        const col = s.index % cols, row = Math.floor(s.index / cols);
        const u0 = (col * cw + 3) / W, u1 = ((col + 1) * cw - 3) / W, vt = 1 - (row * chh + 3) / H, vb = 1 - ((row + 1) * chh - 3) / H;
        const rx = -s.nz * s.sw / 2, rz = s.nx * s.sw / 2, y0 = s.y - s.sh / 2, y1 = s.y + s.sh / 2;
        const BL = [s.x - rx, y0, s.z - rz], BR = [s.x + rx, y0, s.z + rz], TR = [s.x + rx, y1, s.z + rz], TL = [s.x - rx, y1, s.z - rz];
        pos.push(...BL, ...BR, ...TR, ...BL, ...TR, ...TL); uv.push(u0, vb, u1, vb, u1, vt, u0, vb, u1, vt, u0, vt);
      }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geo.computeBoundingSphere();
      floorGroups.get(fid).add(new T.Mesh(geo, M.sign));
    }
  }

  // ---------- origin, selection and route overlays ----------
  const marker = new T.Mesh(new T.SphereGeometry(.7, 20, 14), new T.MeshStandardMaterial({ color: '#2265dc', emissive: '#1641a0', emissiveIntensity: .25 })); scene.add(marker);
  const ring = new T.Mesh(new T.RingGeometry(1, 1.5, 40), new T.MeshBasicMaterial({ color: '#2265dc', side: T.DoubleSide, transparent: true, opacity: .85, toneMapped: false })); ring.rotation.x = -Math.PI / 2; scene.add(ring);
  const routeGroup = new T.Group(); scene.add(routeGroup);
  const selGroup = new T.Group(); scene.add(selGroup);
  const selLabel = { cw: 10, ch: 72, aspect: 1, sprite: new T.Sprite(new T.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true, toneMapped: false })), canvas: document.createElement('canvas'), tex: null, x: 0, y: 0, z: 0, floor: null };
  selLabel.sprite.center.set(.5, -.12); selLabel.sprite.renderOrder = 21; selLabel.sprite.visible = false; scene.add(selLabel.sprite);

  let floor = data.floors[0].id, selected = null, route = [], origin = null, disposed = false, initialized = false;
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const view = { x: 0, z: 0, size: 50, angle: DEFAULT_ANGLE };
  let mode = { type: 'overview' }, anim = null, lastPin = null;

  function targetOf(id) {
    const m = meta.get(id); if (m) return m;
    const p = (data.places || []).find(q => q.id === id), n = p && nodeById.get(p.node_id); if (!n) return null;
    return { id, name: p.name, floor: n.floor_id, kind: 'place', x: n.x, z: n.z, top: .3, pts: [[n.x - 7, 0, n.z - 7], [n.x + 7, 0, n.z + 7], [n.x - 7, 0, n.z + 7], [n.x + 7, 2, n.z - 7]] };
  }
  function freeGroup(group) { for (const child of [...group.children]) { group.remove(child); child.traverse(o => o.geometry?.dispose()); } }
  function updateSelectionVisuals() {
    for (const m of meta.values()) if (m.mesh) m.mesh.material = m.id === selected ? M.bodySel : M.body;
    const setPin = (m, on) => { tmp.position.set(m.x, 0, m.z); tmp.rotation.set(0, 0, 0); tmp.scale.setScalar(on ? 1.5 : 1); tmp.updateMatrix(); m.pinMesh.setMatrixAt(m.pinIndex, tmp.matrix); m.pinMesh.setColorAt(m.pinIndex, on ? PIN_SELECTED : PIN_COLOR); m.pinMesh.instanceMatrix.needsUpdate = true; m.pinMesh.instanceColor.needsUpdate = true; m.pinMesh.computeBoundingSphere(); };
    if (lastPin && lastPin.id !== selected) { setPin(lastPin, false); lastPin = null; }
    freeGroup(selGroup); selLabel.sprite.visible = false; selLabel.floor = null;
    const t = selected != null && targetOf(selected); if (!t) return;
    if (t.kind === 'pin' && t.pinMesh) { setPin(t, true); lastPin = t; }
    if (t.kind === 'poly') {
      const inner = insetSmooth(t.body, .3);
      if (inner) { const geo = new T.ShapeGeometry(shapeOf(t.body, inner)); geo.rotateX(-Math.PI / 2); const m = new T.Mesh(geo, M.selRing); m.position.y = t.top + .02; m.renderOrder = 2; selGroup.add(m); }
      else selGroup.add(new T.LineLoop(new T.BufferGeometry().setFromPoints(t.body.map(p => new T.Vector3(p[0], t.top + .03, p[1]))), M.selLine));
    } else { const m = new T.Mesh(new T.RingGeometry(1.4, 1.9, 40), M.selRing); m.rotation.x = -Math.PI / 2; m.position.set(t.x, .09, t.z); selGroup.add(m); }
    selGroup.visible = t.floor === floor;
    Object.assign(selLabel, { text: t.kind === 'pin' ? `${t.name} · conferir` : t.name, color: t.color ? '#' + t.color.getHexString() : '#d9f57c', x: t.x, y: t.top + (t.kind === 'pin' ? .9 : .3), z: t.z, floor: t.floor });
    measure.font = `600 30px ${FONT}`; selLabel.cw = Math.ceil(Math.min(560, measure.measureText(selLabel.text).width) + 70); selLabel.aspect = selLabel.cw / selLabel.ch;
    paintLabel(selLabel.canvas, selLabel, 'selected');
    selLabel.tex?.dispose(); selLabel.tex = canvasTex(selLabel.canvas); selLabel.sprite.material.map = selLabel.tex; selLabel.sprite.material.needsUpdate = true;
    selLabel.sprite.position.set(selLabel.x, selLabel.y, selLabel.z);
  }
  function routePts() { return route.filter(p => p && p.floor_id === floor); }
  function drawRoute() {
    freeGroup(routeGroup);
    const info = floorInfo.get(floor), w = info.routeW, spacing = w * 2.6, segs = [];
    let d = 0;
    for (let i = 1; i < route.length; i++) { const a = route[i - 1], b = route[i]; if (a.floor_id === floor && b.floor_id === floor) { const l = Math.hypot(b.x - a.x, b.z - a.z); if (l > 1e-4) { segs.push([a.x, a.z, b.x, b.z, d]); d += l; } } }
    if (!segs.length) return;
    const ribbon = (width, y, joints) => {
      const pos = [], uv = [];
      for (const [ax, az, bx, bz, d0] of segs) {
        const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz), px = -dz / l * width / 2, pz = dx / l * width / 2, u0 = d0 / spacing, u1 = (d0 + l) / spacing;
        pos.push(ax + px, y, az + pz, bx + px, y, bz + pz, bx - px, y, bz - pz, ax + px, y, az + pz, bx - px, y, bz - pz, ax - px, y, az - pz);
        uv.push(u0, 1, u1, 1, u1, 0, u0, 1, u1, 0, u0, 0);
        if (joints) for (const [cx, cz] of [[ax, az], [bx, bz]]) for (let k = 0; k < 14; k++) {
          const t0 = k / 14 * Math.PI * 2, t1 = (k + 1) / 14 * Math.PI * 2, r = width / 2;
          pos.push(cx, y, cz, cx + Math.cos(t0) * r, y, cz + Math.sin(t0) * r, cx + Math.cos(t1) * r, y, cz + Math.sin(t1) * r); uv.push(0, .5, 0, .5, 0, .5);
        }
      }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geo.computeBoundingSphere(); return geo;
    };
    const add = (geo, mat, order) => { const m = new T.Mesh(geo, mat); m.renderOrder = order; routeGroup.add(m); return m; };
    add(ribbon(w * 1.75, .1, true), RM.casing, 1);
    add(ribbon(w, .13, true), RM.line, 3);
    add(ribbon(w, .13, true), RM.ghost, 4);   // faint x-ray so the path stays readable behind buildings
    add(ribbon(w * .78, .16, false), RM.flow, 5);
    const last = route[route.length - 1];
    if (last?.floor_id === floor) {
      const e = add(new T.CylinderGeometry(w * 1.5, w * 1.5, .1, 28), RM.end, 6); e.position.set(last.x, .2, last.z);
      const c = add(new T.CylinderGeometry(w * .65, w * .65, .12, 20), RM.endCore, 7); c.position.set(last.x, .22, last.z);
    }
    for (let i = 1; i < route.length; i++) { const a = route[i - 1], b = route[i]; if (a.floor_id !== b.floor_id) for (const p of [a, b]) if (p.floor_id === floor) { const t = add(new T.RingGeometry(w * 1.2, w * 1.8, 32), RM.transfer, 6); t.rotation.x = -Math.PI / 2; t.position.set(p.x, .2, p.z); } }
  }
  function updateOrigin() { marker.visible = ring.visible = Boolean(origin && origin.floor_id === floor); if (origin) { marker.position.set(origin.x, .85, origin.z); ring.position.set(origin.x, .2, origin.z); } }

  // ---------- camera: fit, animate, interact ----------
  function aspect() { const w = container.clientWidth, h = container.clientHeight; return w > 0 && h > 0 ? w / h : 1; }
  function basis(a) {
    const zA = new T.Vector3(Math.sin(a) * CAM_DIST, CAM_HEIGHT, Math.cos(a) * CAM_DIST).normalize();
    const x = new T.Vector3(zA.z, 0, -zA.x).normalize(), y = new T.Vector3().crossVectors(zA, x), f = new T.Vector3(Math.sin(a), 0, Math.cos(a));
    return { x, y, f, fy: f.dot(y) };
  }
  function fit(pts, a, pad, minSize, maxSize) {
    const B = basis(a); let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) { const u = p[0] * B.x.x + p[2] * B.x.z, v = p[0] * B.y.x + p[1] * B.y.y + p[2] * B.y.z; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, t = cv / B.fy;
    return { x: cu * B.x.x + t * B.f.x, z: cu * B.x.z + t * B.f.z, size: clamp(Math.max((v1 - v0) / 2, (u1 - u0) / 2 / aspect()) * pad, minSize, maxSize), angle: a };
  }
  function overviewGoal(a) { const pts = []; for (const p of floorInfo.get(floor).plate) pts.push([p[0], 0, p[1]], [p[0], 3, p[1]]); return fit(pts, a, 1.05, 18, Infinity); }
  function goalFor(m) {
    const a = m.angle ?? (anim ? anim.to.angle : view.angle), ov = overviewGoal(a);
    if (m.type === 'overview') return ov;
    if (m.type === 'store') { const t = targetOf(m.id); if (!t || t.floor !== floor) return null; return fit(t.pts, t.facadeAngle ?? a, 1.9, ov.size * .095, ov.size * .9); }
    if (m.type === 'route') {
      const rp = routePts(); if (rp.length < 2) return null;
      const pts = rp.map(p => [p.x, 0, p.z]); const t = selected != null && targetOf(selected); if (t && t.floor === floor) pts.push(...t.pts);
      return fit(pts, a, 1.15, ov.size * .16, ov.size * 1.05);
    }
    return null;
  }
  function applyView() {
    const asp = aspect(); camera.left = -view.size * asp; camera.right = view.size * asp; camera.top = view.size; camera.bottom = -view.size; camera.zoom = 1;
    camera.position.set(view.x + Math.sin(view.angle) * CAM_DIST, CAM_HEIGHT, view.z + Math.cos(view.angle) * CAM_DIST);
    camera.lookAt(view.x, 0, view.z); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }
  const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < b.size * .01 && Math.abs(Math.log(a.size / b.size)) < .01 && Math.abs(angDiff(a.angle, b.angle)) < .002;
  const canAnimate = () => !reduced && !container.hidden && !document.hidden && container.clientWidth > 0;
  function go(m, instant = false) {
    mode = m; const gl = goalFor(m); if (!gl) return;
    if (near(anim ? anim.to : view, gl)) return;            // same target already reached / in flight → no restart, no oscillation
    if (instant || !canAnimate()) { anim = null; Object.assign(view, gl); applyView(); return; }
    const from = { ...view }, dist = Math.hypot(gl.x - from.x, gl.z - from.z), ref = Math.max(from.size, gl.size);
    const effort = Math.min(1, dist / (ref * 2.5) + Math.abs(Math.log(gl.size / from.size)) / 2.5 + Math.abs(angDiff(from.angle, gl.angle)) / Math.PI);
    anim = { from, to: gl, start: performance.now(), dur: 650 + 250 * effort, bump: Math.min(.4, Math.max(0, dist / ref - 1) * .16) };
  }
  function stepAnim(now) {
    if (!anim) return;
    const k = clamp((now - anim.start) / anim.dur, 0, 1), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2, f = anim.from, t = anim.to;
    view.x = f.x + (t.x - f.x) * e; view.z = f.z + (t.z - f.z) * e; view.angle = f.angle + angDiff(f.angle, t.angle) * e;
    view.size = Math.exp(Math.log(f.size) + (Math.log(t.size) - Math.log(f.size)) * e) * (1 + anim.bump * Math.sin(Math.PI * e));
    if (k >= 1) { Object.assign(view, t); anim = null; }
    applyView();
  }
  function finishAnim() { if (anim) { Object.assign(view, anim.to); anim = null; applyView(); } }
  function cancelAnim() { if (anim) { anim = null; mode = { type: 'free' }; } }
  function clampView() { const b = floorInfo.get(floor).bounds, mx = (b.maxX - b.minX) * .15, mz = (b.maxZ - b.minZ) * .15; view.x = clamp(view.x, b.minX - mx, b.maxX + mx); view.z = clamp(view.z, b.minZ - mz, b.maxZ + mz); }
  function zoomAt(cx, cy, newSize) {
    const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return;
    const px = (cx - r.left) / r.width * 2 - 1, py = 1 - (cy - r.top) / r.height * 2, ov = overviewGoal(view.angle).size;
    newSize = clamp(newSize, Math.max(3, ov * .045), ov * 1.6);
    const B = basis(view.angle), asp = r.width / r.height, ds = view.size - newSize;
    view.x += ds * (px * asp * B.x.x + py / B.fy * B.f.x); view.z += ds * (px * asp * B.x.z + py / B.fy * B.f.z); view.size = newSize;
    mode = { type: 'free' }; clampView(); applyView();
  }
  function panBy(dx, dy) {
    const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return;
    const B = basis(view.angle), du = dx / r.width * 2 * view.size * (r.width / r.height), dv = -dy / r.height * 2 * view.size;
    view.x -= du * B.x.x + dv / B.fy * B.f.x; view.z -= du * B.x.z + dv / B.fy * B.f.z; mode = { type: 'free' }; clampView(); applyView();
  }
  function fitShadow() {
    const info = floorInfo.get(floor), r = info.diag / 2 + 8, c = new T.Vector3(info.cx, 0, info.cz);
    sun.target.position.copy(c); sun.position.copy(c).addScaledVector(SUN_DIR, 500); sun.target.updateMatrixWorld();
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 10, far: 1100 }); sun.shadow.camera.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
  }
  function resize() {
    renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    if (anim) { const gl = goalFor(mode); if (gl) anim.to = gl; } else if (mode.type !== 'free') { const gl = goalFor(mode); if (gl) Object.assign(view, gl); }
    applyView();
  }

  const ray = new T.Raycaster(), pointer = new T.Vector2();
  function pick(e) { const r = canvas.getBoundingClientRect(); pointer.set((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2); ray.setFromCamera(pointer, camera); return ray.intersectObjects(hitObjects.filter(m => m.visible && m.parent.visible), false)[0]; }
  const idOfHit = h => h.object.isInstancedMesh ? h.object.userData.ids?.[h.instanceId] : h.object.userData.store;
  const pointers = new Map(); let drag = null, pinch = null;
  canvas.addEventListener('pointerdown', e => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, size: view.size }; drag = null; cancelAnim(); return; }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, angle: view.angle, pan: e.button === 1 || e.button === 2 || e.shiftKey, moved: false };
  });
  canvas.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) { const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (d > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.size * pinch.d / d); return; }
    if (drag && drag.id === e.pointerId) {
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      if (!drag.moved) { drag.moved = true; cancelAnim(); }
      if (drag.pan) panBy(e.clientX - drag.lx, e.clientY - drag.ly);
      else { view.angle = drag.angle + (e.clientX - drag.x) * .003; if (mode.type === 'overview') { mode = { type: 'overview', angle: view.angle }; Object.assign(view, overviewGoal(view.angle)); } applyView(); }
      drag.lx = e.clientX; drag.ly = e.clientY; canvas.style.cursor = 'grabbing'; return;
    }
    if (e.pointerType === 'mouse' && !pointers.size) canvas.style.cursor = pick(e) ? 'pointer' : 'grab';
  });
  const endPointer = e => {
    const click = e.type === 'pointerup' && drag && drag.id === e.pointerId && !drag.moved && !pinch;
    pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null;
    if (!drag || drag.id === e.pointerId) drag = null;
    canvas.style.cursor = 'grab';
    if (click) { const h = pick(e), id = h && idOfHit(h); if (id) onSelect(id); }
  };
  canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); cancelAnim(); const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1); zoomAt(e.clientX, e.clientY, view.size * Math.exp(clamp(dy, -240, 240) * .0012)); }, { passive: false });

  // ---------- accessible overlay inside the container ----------
  const prevPosition = container.style.position; const fixPosition = getComputedStyle(container).position === 'static';
  if (fixPosition) container.style.position = 'relative';
  const overlay = document.createElement('div');
  Object.assign(overlay.style, { position: 'absolute', top: '52px', right: '16px', zIndex: '2', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', pointerEvents: 'none' });
  const overviewBtn = document.createElement('button');
  overviewBtn.type = 'button'; overviewBtn.textContent = 'Visão geral'; overviewBtn.title = 'Restaurar a visão geral do pavimento';
  Object.assign(overviewBtn.style, { pointerEvents: 'auto', padding: '8px 14px', borderRadius: '10px', border: '1px solid #d3dac7', background: 'rgba(255,254,249,.94)', color: '#173c32', fontSize: '11px', fontWeight: '650', boxShadow: '0 4px 14px rgba(23,60,50,.12)', cursor: 'pointer' });
  overviewBtn.addEventListener('click', () => go({ type: 'overview', angle: DEFAULT_ANGLE }));
  const note = document.createElement('span'); note.textContent = 'Maquete ilustrativa · não é foto';
  Object.assign(note.style, { fontSize: '9px', color: '#5a6855', background: 'rgba(255,254,249,.75)', padding: '4px 8px', borderRadius: '20px' });
  const interiorBtn=document.createElement('button'); interiorBtn.type='button'; interiorBtn.textContent='Mostrar coberturas'; interiorBtn.setAttribute('aria-pressed','true'); interiorBtn.style.cssText=overviewBtn.style.cssText;
  interiorBtn.addEventListener('click',()=>{cutaway=!cutaway;for(const o of roofViews)o.visible=!cutaway;interiorBtn.textContent=cutaway?'Mostrar coberturas':'Ver interiores';interiorBtn.setAttribute('aria-pressed',String(cutaway));});
  overlay.append(overviewBtn, interiorBtn, note); container.append(overlay);

  // ---------- floor switching ----------
  function setFloor(id) {
    if (!floorGroups.has(id)) return;
    const changed = id !== floor || !initialized; floor = id;
    for (const [k, g] of floorGroups) g.visible = k === id;
    drawRoute(); updateOrigin(); selGroup.visible = selLabel.floor === floor;
    if (changed) { // floor change resets the view instantly (route, then selected store, else overview)
      fitShadow(); anim = null; initialized = true;
      const t = selected != null && targetOf(selected);
      mode = routePts().length >= 2 ? { type: 'route' } : t && t.floor === id ? { type: 'store', id: selected } : { type: 'overview', angle: view.angle };
      Object.assign(view, goalFor(mode) || overviewGoal(view.angle)); applyView();
    }
  }
  function selectStore(id) {
    const next = id ?? null;
    if (next !== selected) { selected = next; updateSelectionVisuals(); }
    if (selected == null) { go({ type: 'overview', angle: DEFAULT_ANGLE }); return; }
    const t = targetOf(selected); if (t && t.floor === floor) go({ type: 'store', id: selected });
  }

  // ---------- labels with collision avoidance ----------
  const v3 = new T.Vector3();
  function updateLabels() {
    const W = container.clientWidth, H = container.clientHeight; if (!W || !H) return;
    const wpp = 2 * view.size / H, px = W < 520 ? 20 : 23, occupied = [], ov = overviewGoal(view.angle).size, zoomed = view.size < ov * .42;
    const place = (l, sprite, force) => {
      v3.set(l.x, l.y, l.z).project(camera);
      const x = (v3.x + 1) * W / 2, y = (1 - v3.y) * H / 2, w = px * l.aspect, rect = [x - w / 2, y - px * 1.12, x + w / 2, y - px * .12];
      if (rect[2] < 0 || rect[0] > W || rect[3] < 0 || rect[1] > H) return false;
      if (!force && occupied.some(r => rect[0] < r[2] + 4 && rect[2] > r[0] - 4 && rect[1] < r[3] + 3 && rect[3] > r[1] - 3)) return false;
      occupied.push(rect); sprite.scale.set(wpp * px * l.aspect, wpp * px, 1); sprite.visible = true; return true;
    };
    selLabel.sprite.visible = false;
    if (selLabel.floor === floor && selLabel.tex) place(selLabel, selLabel.sprite, true);
    let shown = 0;
    for (const l of labelsByFloor.get(floor) || []) {
      l.sprite.visible = false;
      if (shown >= 48 || l.id === selected || l.kind === 'pin') continue;
      if (l.kind === 'store' && !l.featured && !zoomed) continue;
      if (place(l, l.sprite, false)) { ensureLabel(l); shown++; }
    }
  }

  const ro = new ResizeObserver(resize); ro.observe(container);
  setFloor(floor); resize();
  let raf = 0, count = 0, total = 0, last = 0;
  function tick(t) {
    if (disposed) return; raf = requestAnimationFrame(tick);
    if (container.hidden || document.hidden) { last = 0; finishAnim(); return; }
    if (last) { total += t - last; count++; } last = t;
    stepAnim(performance.now());
    if (!reduced) { ring.scale.setScalar(1 + Math.sin(t * .002) * .06); chevronTex.offset.x = -((t / 900) % 1); M.selRing.opacity = .72 + Math.sin(t * .004) * .23; }
    updateLabels(); renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(tick);

  return {
    setFloor, selectStore,
    setRoute(p) { route = Array.isArray(p) ? p.filter(Boolean) : []; drawRoute(); if (routePts().length >= 2) go({ type: 'route' }); else if (mode.type === 'route') mode = { type: 'free' }; },
    setOrigin(n) { origin = n; updateOrigin(); },
    setReducedMotion(v) { reduced = Boolean(v); ring.scale.setScalar(1); chevronTex.offset.x = 0; M.selRing.opacity = .95; if (reduced) finishAnim(); },
    getMetrics() { return { fps: total ? Math.round(count * 1000 / total) : 0, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles }; },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect(); overlay.remove(); if (fixPosition) container.style.position = prevPosition;
      scene.traverse(o => { o.geometry?.dispose(); if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m.map?.dispose(); m.dispose(); } if (o.isInstancedMesh) o.dispose(); });
      for (const x of owned) x.dispose?.(); for (const l of labels) l.tex?.dispose(); selLabel.tex?.dispose();
      renderer.dispose(); canvas.remove();
    },
  };
}
