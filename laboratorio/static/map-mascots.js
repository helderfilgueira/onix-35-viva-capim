/*
 * Mascotes fictícios do Viva Capim — pixel art ORIGINAL desenhada por código (sem imagens externas).
 * Autoria: equipe Onix 35 com apoio de IA (Claude Opus 5.5), criado neste repositório em 14/11/2026.
 * Não representam pessoas reais, visitantes rastreados nem lotação: são personagens decorativos.
 *
 * Sprite: 18×26 px por quadro (16×24 desenho + contorno de 1 px), 4 direções × 4 quadros.
 * Ordem das linhas da folha: 0 = frente (descendo), 1 = costas (subindo), 2 = esquerda, 3 = direita.
 */
export const MASCOTS = [
  { id: 'caio', floor: 'f0', speed: 3.1, pause: [1200, 4200],
    colors: { skin: '#8a5636', skinShade: '#6e4128', hair: '#22160f', shirt: '#c8302b', shirtShade: '#9b1f1b', pants: '#1d2026', pantsShade: '#111317', shoes: '#3a2a20' },
    build: { shoulders: 8, legW: 2, head: 1, torso: 7, legs: 9, tall: true } },
  { id: 'lia', floor: 'f0', speed: 2.6, pause: [2000, 5200],
    colors: { skin: '#94603f', skinShade: '#784a2f', hair: '#3a2414', hairLight: '#5a3a22', cap: '#1f5fbf', capShade: '#163f80', shirt: '#f2c230', shirtShade: '#c99a14', pants: '#2f3e5e', pantsShade: '#222d45', shoes: '#f1efe8' },
    build: { shoulders: 8, legW: 2, head: 3, torso: 7, legs: 7, curls: true, cap: true } },
  { id: 'bento', floor: 'f1', speed: 2.2, pause: [1500, 3800],
    colors: { skin: '#a46a43', skinShade: '#86522f', hair: '#1b130d', shirt: '#f4c63d', shirtShade: '#cf9f1c', pants: '#3c5d92', pantsShade: '#2b4470', shoes: '#5b3a1e', shoesLight: '#7a5030' },
    build: { shoulders: 10, legW: 3, head: 3, torso: 7, legs: 7, boots: true } },
];

const W = 18, H = 26, OUTLINE = '#1a120c';

/** Desenha um quadro (dir 0..3, frame 0..3) num canvas 2D, com origem (ox, oy) e escala inteira. */
export function drawMascot(ctx, mascot, dir, frame, ox = 0, oy = 0, scale = 1) {
  const grid = Array.from({ length: H }, () => Array(W).fill(null));
  const put = (x, y, c) => { if (x >= 1 && x < W - 1 && y >= 1 && y < H - 1 && c) grid[y][x] = c; };
  const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c); };
  const { colors: C, build: B } = mascot;
  const side = dir >= 2, back = dir === 1;
  const step = frame === 1 ? 1 : frame === 3 ? -1 : 0;           // perna/braço que avança
  const bob = frame === 1 || frame === 3 ? 0 : 0;                 // sem balanço vertical (evita tremor)
  const cx = 9;                                                    // centro (coluna) do desenho 16 px + contorno
  const headTop = B.head + bob, headH = 6, headW = side ? 5 : 6;
  const neck = headTop + headH, torsoTop = neck, torsoH = B.torso, hip = torsoTop + torsoH;
  const sw = side ? Math.max(4, B.shoulders - 3) : B.shoulders;   // largura do tronco
  const tx = cx - Math.floor(sw / 2);
  // Pernas
  const legH = B.legs, lw = B.legW;
  if (side) {
    const front = 1 + step, backLeg = 1 - step;                     // passada vista de lado
    rect(cx - 1 - backLeg, hip, lw, legH, C.pantsShade);
    rect(cx - 1 + front - 1, hip, lw, legH, C.pants);
    const shoeH = B.boots ? 3 : 1;
    rect(cx - 1 - backLeg, hip + legH - shoeH, lw + 1, shoeH, C.shoes);
    rect(cx - 2 + front, hip + legH - shoeH, lw + 1, shoeH, B.boots ? (C.shoesLight || C.shoes) : C.shoes);
  } else {
    const gap = B.shoulders >= 10 ? 1 : 0;
    const lx = cx - lw - gap, rx = cx + gap;
    const lLift = step === 1 ? 1 : 0, rLift = step === -1 ? 1 : 0;
    rect(lx, hip, lw, legH - lLift, C.pants); rect(rx, hip, lw, legH - rLift, C.pantsShade);
    const shoeH = B.boots ? 3 : 1;
    rect(lx, hip + legH - lLift - shoeH, lw, shoeH, B.boots ? (C.shoesLight || C.shoes) : C.shoes);
    rect(rx, hip + legH - rLift - shoeH, lw, shoeH, C.shoes);
  }
  // Tronco (camisa/casaco)
  rect(tx, torsoTop, sw, torsoH, C.shirt);
  rect(tx, torsoTop + torsoH - 1, sw, 1, C.shirtShade);
  if (mascot.id === 'lia' && !side) { rect(cx - 1, torsoTop + 1, 2, torsoH - 1, C.shirtShade); rect(tx, torsoTop, sw, 1, C.shirtShade); } // zíper/gola do casaco
  if (mascot.id === 'bento' && !side) rect(tx + 1, torsoTop + 2, sw - 2, 1, C.shirtShade);                                                   // peitoral (porte forte)
  // Braços (balançam ao caminhar)
  const armLen = torsoH - 1;
  if (side) {
    const ax = cx - 1 + (step > 0 ? 1 : step < 0 ? -1 : 0);
    rect(ax, torsoTop + 1, 2, armLen - 2, C.shirtShade); rect(ax, torsoTop + armLen - 1, 2, 2, C.skin);
  } else {
    const la = step === 1 ? -1 : step === -1 ? 1 : 0;
    rect(tx - 2, torsoTop + 1 + Math.max(0, la), 2, armLen - 2, C.shirtShade); rect(tx - 2, torsoTop + armLen - 1 + la, 2, 2, C.skin);
    rect(tx + sw, torsoTop + 1 + Math.max(0, -la), 2, armLen - 2, C.shirtShade); rect(tx + sw, torsoTop + armLen - 1 - la, 2, 2, C.skin);
  }
  // Pescoço e cabeça
  rect(cx - 1, neck - 1, 2, 1, C.skinShade);
  const hx = cx - Math.floor(headW / 2) + (side ? (dir === 2 ? -1 : 0) : 0);
  rect(hx, headTop, headW, headH, C.skin);
  rect(hx, headTop + headH - 1, headW, 1, C.skinShade);
  // Cabelo
  if (B.curls) {
    // Cachos visíveis: volume dos lados e atrás, padrão alternado em dois tons.
    for (let y = headTop - 1; y < headTop + headH + 3; y++) for (let x = hx - 2; x < hx + headW + 2; x++) {
      const outside = x < hx || x >= hx + headW || y < headTop + 1 || back;
      const faceArea = !back && x >= hx + (side ? (dir === 2 ? 0 : 2) : 1) && x < hx + headW - (side ? (dir === 2 ? 2 : 0) : 1) && y >= headTop + 2;
      if (outside && !faceArea && (y < headTop + headH + 2 || x < hx || x >= hx + headW)) put(x, y, (x + y) % 2 ? C.hair : C.hairLight);
    }
  } else {
    rect(hx, headTop, headW, 2, C.hair);
    if (back) rect(hx, headTop, headW, 4, C.hair);
    else if (side) rect(dir === 2 ? hx + headW - 2 : hx, headTop, 2, 4, C.hair);
    else { put(hx, headTop + 2, C.hair); put(hx + headW - 1, headTop + 2, C.hair); }
  }
  // Boné azul (Lia)
  if (B.cap) {
    rect(hx - 1, headTop - 1, headW + 2, 2, C.cap); rect(hx, headTop - 2, headW, 1, C.capShade);
    if (dir === 0) rect(hx - 1, headTop + 1, headW + 2, 1, C.capShade);
    if (dir === 2) rect(hx - 3, headTop, 3, 1, C.capShade);
    if (dir === 3) rect(hx + headW, headTop, 3, 1, C.capShade);
  }
  // Rosto
  if (!back) {
    const ey = headTop + 3;
    if (side) put(dir === 2 ? hx + 1 : hx + headW - 2, ey, OUTLINE);
    else { put(hx + 1, ey, OUTLINE); put(hx + headW - 2, ey, OUTLINE); put(cx - 1 + (headW % 2), ey + 2, C.skinShade); }
  }
  // Contorno de 1 px (legibilidade sobre a maquete)
  const out = grid.map(r => r.slice());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!grid[y][x]) {
    if ((grid[y - 1]?.[x]) || (grid[y + 1]?.[x]) || grid[y][x - 1] || grid[y][x + 1]) out[y][x] = OUTLINE;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (out[y][x]) { ctx.fillStyle = out[y][x]; ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale); }
}

/** Folha 4×4 (colunas = quadros, linhas = direções). */
export function spriteSheet(mascot, scale = 1) {
  const c = document.createElement('canvas'); c.width = W * 4 * scale; c.height = H * 4 * scale;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  for (let d = 0; d < 4; d++) for (let f = 0; f < 4; f++) drawMascot(ctx, mascot, d, f, f * W * scale, d * H * scale, scale);
  return c;
}
export const SPRITE = { W, H };

/* ---------------- Passeio no mapa 3D (usado por map-plan3d.js) ---------------- */
/**
 * ctx: { T, floorGroups, nodes, edges, camera, getPixelWorld():number, isReduced():bool, own(x) }
 * Caminham SOMENTE por arestas kind==='corridor' do próprio piso (sem entradas de loja nem conexões verticais).
 */
export function attachMascots(ctx) {
  const { T } = ctx;
  const byId = new Map(ctx.nodes.map(n => [n.id, n]));
  const adj = new Map();
  for (const e of ctx.edges) {
    if (e.kind !== 'corridor' || e.blocked) continue;
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b || a.floor_id !== b.floor_id) continue;            // nunca cruza pisos
    const d = e.distance || Math.hypot(a.x - b.x, a.z - b.z);
    (adj.get(a.id) || adj.set(a.id, []).get(a.id)).push([b.id, d]);
    if (e.bidirectional !== false) (adj.get(b.id) || adj.set(b.id, []).get(b.id)).push([a.id, d]);
  }
  // Maior componente conectado de cada piso: garante destinos alcançáveis.
  const component = floor => {
    const seen = new Set(); let best = [];
    for (const id of adj.keys()) {
      if (seen.has(id) || byId.get(id).floor_id !== floor) continue;
      const comp = [], stack = [id]; seen.add(id);
      while (stack.length) { const v = stack.pop(); comp.push(v); for (const [w] of adj.get(v) || []) if (!seen.has(w)) { seen.add(w); stack.push(w); } }
      if (comp.length > best.length) best = comp;
    }
    return best;
  };
  const path = (from, to) => {
    const dist = new Map([[from, 0]]), prev = new Map(), open = new Set([from]);
    while (open.size) {
      let u = null, best = Infinity; for (const v of open) { const dv = dist.get(v); if (dv < best) { best = dv; u = v; } }
      open.delete(u); if (u === to) break;
      for (const [w, d] of adj.get(u) || []) { const nd = best + d; if (nd < (dist.get(w) ?? Infinity)) { dist.set(w, nd); prev.set(w, u); open.add(w); } }
    }
    if (!dist.has(to)) return [from];
    const out = [to]; while (out[0] !== from) out.unshift(prev.get(out[0])); return out;
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const v1 = new T.Vector3(), v2 = new T.Vector3();
  const walkers = [];
  for (const m of MASCOTS) {
    const group = ctx.floorGroups.get(m.floor); const nodesOnFloor = component(m.floor);
    if (!group || nodesOnFloor.length < 2) continue;
    const sheet = spriteSheet(m, 1);
    const tex = ctx.own(new T.CanvasTexture(sheet));
    tex.magFilter = T.NearestFilter; tex.minFilter = T.NearestFilter; tex.generateMipmaps = false; tex.colorSpace = T.SRGBColorSpace;
    tex.repeat.set(1 / 4, 1 / 4);
    const mat = ctx.own(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false }));
    const sprite = new T.Sprite(mat); sprite.center.set(0.5, 0); sprite.renderOrder = 15; sprite.userData.mascot = m.id;
    const start = nodesOnFloor[Math.floor(Math.random() * nodesOnFloor.length)], n0 = byId.get(start);
    sprite.position.set(n0.x, 0.06, n0.z); group.add(sprite);
    walkers.push({ m, sprite, tex, nodes: nodesOnFloor, route: [start], seg: 0, t: 0, wait: rnd(...m.pause), dir: 0, frame: 0, anim: Math.random() * 1000, bounce: 0 });
  }
  const setFrame = w => { w.tex.offset.set(w.frame / 4, 1 - (w.dir + 1) / 4); };
  const newRoute = w => {
    const here = w.route[w.route.length - 1];
    for (let i = 0; i < 6; i++) {
      const to = w.nodes[Math.floor(Math.random() * w.nodes.length)];
      if (to === here) continue;
      const p = path(here, to); if (p.length >= 2) { w.route = p.slice(0, 18); w.seg = 0; w.t = 0; return; } // trechos curtos: mais paradas
    }
  };
  function tick(dt) {
    dt = Math.min(dt, 0.1);                                          // após aba oculta, não "teleporta"
    const reduced = ctx.isReduced(), px = ctx.getPixelWorld(), size = 44 * px;
    for (const w of walkers) {
      const s = w.sprite;
      s.scale.set(size * (W / H), size, 1);
      if (w.bounce > 0) { w.bounce = Math.max(0, w.bounce - dt); s.position.y = 0.06 + Math.sin((1 - w.bounce / 0.5) * Math.PI) * size * 0.35; }
      if (reduced) { w.frame = 0; w.dir = 0; setFrame(w); continue; } // movimento reduzido: parados, de frente
      if (w.wait > 0 || w.route.length < 2) {
        w.wait -= dt * 1000; w.frame = 0; setFrame(w);
        if (w.wait <= 0) { newRoute(w); w.wait = 0; }
        continue;
      }
      const a = byId.get(w.route[w.seg]), b = byId.get(w.route[w.seg + 1]);
      const len = Math.max(0.01, Math.hypot(b.x - a.x, b.z - a.z));
      w.t += (w.m.speed * dt) / len;
      if (w.t >= 1) {
        w.seg++; w.t = 0;
        if (w.seg >= w.route.length - 1) { w.route = [w.route[w.route.length - 1]]; w.wait = rnd(...w.m.pause); s.position.set(b.x, s.position.y, b.z); continue; }
        continue;
      }
      const x = a.x + (b.x - a.x) * w.t, z = a.z + (b.z - a.z) * w.t;
      // Direção na TELA (depende do giro da câmera): compara a projeção do ponto atual e do próximo.
      v1.set(x, 0, z).project(ctx.camera); v2.set(b.x, 0, b.z).project(ctx.camera);
      const dx = v2.x - v1.x, dy = v2.y - v1.y;
      w.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : (dy > 0 ? 1 : 0);
      w.anim += dt * 1000; w.frame = Math.floor(w.anim / (150 + w.m.speed * 10)) % 4;
      s.position.x = x; s.position.z = z; setFrame(w);
    }
  }
  /** Raycast exclusivo dos mascotes (chamado só quando o clique não atingiu loja). */
  function pick(raycaster) {
    const visible = walkers.filter(w => w.sprite.parent?.visible).map(w => w.sprite);
    const hit = raycaster.intersectObjects(visible, false)[0];
    return hit ? hit.object.userData.mascot : null;
  }
  function bounce(id) { if (ctx.isReduced()) return; const w = walkers.find(x => x.m.id === id); if (w) w.bounce = 0.5; } // movimento reduzido: sem pulo
  function floorOf(id) { return walkers.find(x => x.m.id === id)?.m.floor || null; }
  function dispose() { for (const w of walkers) w.sprite.parent?.remove(w.sprite); walkers.length = 0; }
  return { tick, pick, bounce, floorOf, dispose, count: () => walkers.length };
}
