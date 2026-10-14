// ───────────────────────────── Frame renderer ─────────────────────────────
import type { Project, Scene, DialogueLine, TextOverlay } from '../types';
import { locateScene } from '../types';
import { solveScene, type SceneState, type CharState } from './scene';
import { drawBackground, terrainHeight, type Stage } from './backgrounds';
import { drawProp, PROP_REL_SIZE } from './props';
import { solve, drawStickman, clamp, easeOutBack, easeOut, type Skeleton } from './rig';

export interface HitBox { kind: 'character' | 'prop'; id: string; x: number; y: number; w: number; h: number }
export interface RenderOptions { selectedId?: string; showSafeArea?: boolean; showGuides?: boolean; hits?: HitBox[] }

export function stageFor(W: number, H: number): Stage & { charH: number } {
  const portrait = H > W * 1.2;
  const floorY = portrait ? H * 0.72 : H * 0.8;
  const charH = Math.min(H * 0.46, W * 0.62);
  return { W, H, floorY, charH };
}

function fontPx(H: number, W: number, scale = 1) { return Math.round(Math.min(H, W) * 0.045 * scale); }

const BG_PAD = 0.1, BG_SCALE = 1 + 2 * BG_PAD;
/** Ground height (fraction of stage height) at stage x, in the same space the characters live in. */
export function groundAt(scene: Scene, x: number) { return terrainHeight(scene.background, (x + BG_PAD) / BG_SCALE) * BG_SCALE; }

export function renderFrame(ctx: CanvasRenderingContext2D, project: Project, time: number, W: number, H: number, opts: RenderOptions = {}) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!project.scenes.length) { ctx.fillStyle = '#0d0f16'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#4a5272'; ctx.font = `${fontPx(H, W)}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('No scenes yet', W / 2, H / 2); return; }
  const { index, local } = locateScene(project, time);
  const scene = project.scenes[index];
  const state = solveScene(scene, project, local);

  // transition: render previous scene's last frame underneath when needed
  if (state.transitionProgress < 1 && index > 0 && scene.transitionIn !== 'fade') {
    const prev = project.scenes[index - 1];
    const off = getOffscreen(W, H);
    const octx = off.getContext('2d')!;
    renderScene(octx, project, prev, prev.duration - 0.001, W, H, {});
    ctx.drawImage(off, 0, 0);
  }

  ctx.save();
  applyTransitionClip(ctx, scene, state.transitionProgress, W, H);
  renderScene(ctx, project, scene, local, W, H, opts, state);
  ctx.restore();

  if (scene.transitionIn === 'fade' && state.transitionProgress < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - state.transitionProgress})`; ctx.fillRect(0, 0, W, H); }

  // global opening / closing titles
  const total = project.scenes.reduce((a, s) => a + s.duration, 0);
  if (project.settings.openingTitle && time < 2.2) drawTitleCard(ctx, project.settings.openingTitle, clamp(time / 0.6, 0, 1) * clamp((2.2 - time) / 0.5, 0, 1), W, H, true);
  if (project.settings.closingTitle && time > total - 2.2) drawTitleCard(ctx, project.settings.closingTitle, clamp((time - (total - 2.2)) / 0.6, 0, 1), W, H, false);

  if (opts.showSafeArea) drawSafeArea(ctx, W, H);
}

function applyTransitionClip(ctx: CanvasRenderingContext2D, scene: Scene, p: number, W: number, H: number) {
  if (p >= 1) return;
  const e = easeOut(p);
  switch (scene.transitionIn) {
    case 'slide': ctx.translate(W * (1 - e), 0); break;
    case 'wipe': ctx.beginPath(); ctx.rect(0, 0, W * e, H); ctx.clip(); break;
    case 'zoom': ctx.translate(W / 2, H / 2); ctx.scale(0.6 + 0.4 * e, 0.6 + 0.4 * e); ctx.translate(-W / 2, -H / 2); ctx.globalAlpha = e; break;
  }
}

let offscreen: HTMLCanvasElement | OffscreenCanvas | null = null;
function getOffscreen(W: number, H: number): any {
  if (!offscreen || (offscreen as any).width !== W || (offscreen as any).height !== H) {
    offscreen = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  }
  return offscreen;
}

export function renderScene(ctx: CanvasRenderingContext2D, project: Project, scene: Scene, local: number, W: number, H: number, opts: RenderOptions, state?: SceneState) {
  const st = state ?? solveScene(scene, project, local);
  const stage = stageFor(W, H);
  const { floorY, charH } = stage;
  const cam = st.camera;

  ctx.save();
  // camera transform (zoom around camera center, plus shake)
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-(cam.cx + cam.shakeX) * W, -(cam.cy + cam.shakeY) * H);

  // background drawn slightly oversized so zoom/pan never shows the void; its floor line is placed so
  // that after scaling it lands exactly where the characters stand
  ctx.save(); ctx.translate(-W * BG_PAD, -H * BG_PAD); ctx.scale(BG_SCALE, BG_SCALE);
  drawBackground(ctx, scene.background, { W, H, floorY: (floorY + H * BG_PAD) / BG_SCALE }, scene.customBackgroundUrl, local);
  ctx.restore();

  // stage props (not held)
  const skeletons = new Map<string, Skeleton>();
  for (const c of st.chars) if (c.visible) skeletons.set(c.character.id, solve(c.character, c.pose, c.x * W, floorY - groundAt(scene, c.x) * H, charH, c.turn, c.reach && { x: c.reach.x * W, y: floorY - (c.reach.stage + groundAt(scene, c.reach.x)) * H - c.reach.body * charH, w: c.reach.w }));

  const hits: HitBox[] = opts.hits ?? [];
  for (const p of st.props) {
    if (p.heldBy) continue;
    const size = charH * PROP_REL_SIZE[p.type] * p.scale;
    const px = p.x * W, py = floorY - (p.y + groundAt(scene, p.x)) * H;
    drawProp(ctx, p.type, px, py, size, { selected: opts.selectedId === p.id, label: p.label });
    const b = screenBounds(ctx, px - size * 0.5, py - size, size, size);
    hits.push({ kind: 'prop', id: p.id, ...b });
  }

  // characters, sorted so lower (closer) ones are drawn last — all on one floor line so sort by x stability
  const ordered = [...st.chars].filter(c => c.visible);
  for (const c of ordered) {
    const sk = skeletons.get(c.character.id)!;
    drawStickman(ctx, c.character, c.pose, sk, { time: local, selected: opts.selectedId === c.character.id });
    // held prop follows the front hand
    if (c.carrying) {
      const p = st.props.find(p => p.id === c.carrying);
      if (p) { const size = charH * PROP_REL_SIZE[p.type] * p.scale * 0.8; drawProp(ctx, p.type, sk.lHand[0], sk.lHand[1] + size * 0.25, size, { held: true, selected: opts.selectedId === p.id }); }
    }
    const top = sk.head[1] - sk.headR, bottom = Math.max(sk.lFoot[1], sk.rFoot[1]);
    const left = Math.min(sk.lHand[0], sk.rHand[0], sk.head[0] - sk.headR, sk.lFoot[0], sk.rFoot[0]), right = Math.max(sk.lHand[0], sk.rHand[0], sk.head[0] + sk.headR, sk.lFoot[0], sk.rFoot[0]);
    const b = screenBounds(ctx, left, top, right - left, bottom - top);
    hits.push({ kind: 'character', id: c.character.id, ...b });
  }

  // speech / thought bubbles in world space
  for (const line of st.dialogue) {
    if (line.style === 'subtitle' || line.characterId === 'narrator') continue;
    const c = st.chars.find(c => c.character.id === line.characterId);
    const sk = c && skeletons.get(c.character.id);
    if (!c || !sk) continue;
    drawBubble(ctx, line, local - line.start, sk, W, H, cam.zoom);
  }
  ctx.restore();

  // screen-space overlays
  if (project.settings.subtitles.enabled) drawSubtitles(ctx, project, st.dialogue, local, W, H);
  for (const tx of scene.texts) if (local >= tx.start && local < tx.start + tx.duration) drawTextOverlay(ctx, tx, local - tx.start, W, H);
  // character name tags for the editor
  if (opts.showGuides) {
    ctx.save(); ctx.font = `${fontPx(H, W, 0.55)}px Inter, sans-serif`; ctx.textAlign = 'center';
    for (const h of hits) if (h.kind === 'character') { const c = st.chars.find(c => c.character.id === h.id)!; ctx.fillStyle = c.character.color; ctx.fillText(c.character.name, h.x + h.w / 2, h.y - 8); }
    ctx.restore();
  }
}

function screenBounds(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const m = ctx.getTransform();
  const p1 = m.transformPoint(new DOMPoint(x, y)), p2 = m.transformPoint(new DOMPoint(x + w, y + h));
  return { x: p1.x, y: p1.y, w: p2.x - p1.x, h: p2.y - p1.y };
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/); const lines: string[] = []; let cur = '';
  for (const w of words) { const test = cur ? cur + ' ' + w : w; if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test; }
  if (cur) lines.push(cur);
  return lines;
}

function drawBubble(ctx: CanvasRenderingContext2D, line: DialogueLine, rel: number, sk: Skeleton, W: number, H: number, zoom: number) {
  const scale = 1 / zoom;
  const fs = fontPx(H, W, 0.8) * scale;
  ctx.save();
  ctx.font = `600 ${fs}px Inter, sans-serif`;
  const maxW = Math.min(W * 0.36, 420 * scale * (W / 1920) * 2.2) ;
  const lines = wrapText(ctx, line.text, maxW);
  const pad = fs * 0.6, lh = fs * 1.25;
  const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + pad * 2, bh = lines.length * lh + pad * 1.4;
  const headX = sk.head[0], headY = sk.head[1], r = sk.headR;
  let bx = headX + sk.facing * r * 1.2; if (sk.facing < 0) bx -= bw;
  bx = clamp(bx, 10, W - bw - 10);
  const by = clamp(headY - r * 2.2 - bh, 10, H);
  const pop = easeOutBack(clamp(rel / 0.25, 0, 1));
  ctx.translate(bx + bw / 2, by + bh); ctx.scale(pop, pop); ctx.translate(-(bx + bw / 2), -(by + bh));
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(2, fs * 0.08);
  if (line.style === 'thought') {
    ctx.beginPath(); ctx.ellipse(bx + bw / 2, by + bh / 2, bw / 2 + pad * 0.4, bh / 2 + pad * 0.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 3; i++) { const rr = fs * (0.35 - i * 0.09); const cx = headX + sk.facing * r * (0.9 + i * 0.25), cy = headY - r * (1.3 + i * 0.3); ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  } else {
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, fs * 0.6); ctx.fill(); ctx.stroke();
    // tail
    const tx = clamp(headX + sk.facing * r * 0.6, bx + fs, bx + bw - fs);
    ctx.beginPath(); ctx.moveTo(tx - fs * 0.5, by + bh - 1); ctx.lineTo(headX + sk.facing * r * 0.9, headY - r * 1.05); ctx.lineTo(tx + fs * 0.5, by + bh - 1); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(tx - fs * 0.5, by + bh - 1); ctx.lineTo(headX + sk.facing * r * 0.9, headY - r * 1.05); ctx.lineTo(tx + fs * 0.5, by + bh - 1); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillRect(tx - fs * 0.5 + 1, by + bh - ctx.lineWidth, fs - 2, ctx.lineWidth + 1);
  }
  ctx.fillStyle = '#111'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad * 0.7 + i * lh));
  ctx.restore();
}

function drawSubtitles(ctx: CanvasRenderingContext2D, project: Project, lines: DialogueLine[], local: number, W: number, H: number) {
  const st = project.settings.subtitles;
  const portrait = H > W * 1.2;
  const fs = fontPx(H, W, st.size * (portrait ? 1.1 : 1));
  const shown = lines.filter(l => l.style === 'subtitle' || l.characterId === 'narrator');
  if (!shown.length) return;
  ctx.save();
  ctx.font = `700 ${fs}px ${st.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  // safe area: keep clear of platform UI on vertical video
  const safeBottom = portrait ? H * 0.80 : H * 0.92, safeTop = portrait ? H * 0.16 : H * 0.08;
  let y = st.position === 'top' ? safeTop + fs : st.position === 'center' ? H / 2 : safeBottom;
  const maxW = W * (portrait ? 0.86 : 0.78);
  if (st.animation === 'words') { drawWordCaptions(ctx, st, shown[shown.length - 1], local, W, H, fs * 1.35, y); ctx.restore(); return; }
  for (const line of shown) {
    const rel = local - line.start;
    const who = line.characterId === 'narrator' ? null : project.characters.find(c => c.id === line.characterId);
    let text = line.text;
    if (st.animation === 'typewriter') text = text.slice(0, Math.ceil(rel * 28));
    const wrapped = wrapText(ctx, text, maxW);
    let alpha = 1, scale = 1;
    if (st.animation === 'pop') scale = easeOutBack(clamp(rel / 0.2, 0, 1));
    if (st.animation === 'fade') alpha = clamp(rel / 0.25, 0, 1);
    ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(W / 2, y); ctx.scale(scale, scale); ctx.translate(-W / 2, -y);
    const lh = fs * 1.2; const blockH = wrapped.length * lh + (st.showNames && who ? lh * 0.9 : 0);
    const top = st.position === 'bottom' ? y - blockH : st.position === 'top' ? y - fs : y - blockH / 2;
    let yy = top + lh;
    if (st.showNames && who) { ctx.fillStyle = who.color; ctx.font = `800 ${fs * 0.8}px ${st.font}`; ctx.lineWidth = st.outlineWidth * (fs / 48); ctx.strokeStyle = st.outline; ctx.strokeText(who.name.toUpperCase(), W / 2, yy); ctx.fillText(who.name.toUpperCase(), W / 2, yy); yy += lh * 0.9; ctx.font = `700 ${fs}px ${st.font}`; }
    for (const l of wrapped) { ctx.lineWidth = st.outlineWidth * (fs / 48); ctx.strokeStyle = st.outline; ctx.lineJoin = 'round'; ctx.strokeText(l, W / 2, yy); ctx.fillStyle = line.characterId === 'narrator' ? '#ffe9a8' : st.color; ctx.fillText(l, W / 2, yy); yy += lh; }
    ctx.restore();
    y -= blockH + fs * 0.3;
  }
  ctx.restore();
}

const WORDS_PER_CAPTION = 3;
/**
 * Short-form style captions: a few words at a time, the word being spoken highlighted and popped.
 * Word timing is spread over the line by word length, which follows the voice closely enough.
 */
function drawWordCaptions(ctx: CanvasRenderingContext2D, st: Project['settings']['subtitles'], line: DialogueLine, local: number, W: number, H: number, fs: number, anchorY: number) {
  const words = line.text.split(/\s+/).filter(Boolean);
  if (!words.length) return;
  const weights = words.map(w => 1 + w.replace(/[^A-Za-z0-9]/g, '').length * 0.35);
  const total = weights.reduce((a, b) => a + b, 0), speak = Math.max(0.3, line.duration - 0.3);
  let acc = 0, idx = words.length - 1;
  const rel = local - line.start;
  for (let i = 0; i < words.length; i++) { acc += weights[i]; if (rel < (acc / total) * speak) { idx = i; break; } }
  const from = Math.floor(idx / WORDS_PER_CAPTION) * WORDS_PER_CAPTION, chunk = words.slice(from, from + WORDS_PER_CAPTION);
  const wordStart = (i: number) => (weights.slice(0, i).reduce((a, b) => a + b, 0) / total) * speak;

  let size = fs;
  const measure = () => { ctx.font = `900 ${size}px ${st.font}`; return chunk.map(w => ctx.measureText(w.toUpperCase()).width); };
  let widths = measure(); const gap = () => size * 0.3;
  const maxW = W * 0.88;
  while (widths.reduce((a, b) => a + b, 0) + gap() * (chunk.length - 1) > maxW && size > fs * 0.4) { size *= 0.9; widths = measure(); }
  const lineW = widths.reduce((a, b) => a + b, 0) + gap() * (chunk.length - 1);
  const y = st.position === 'bottom' ? anchorY - size * 0.6 : anchorY;
  let x = W / 2 - lineW / 2;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  chunk.forEach((w, k) => {
    const i = from + k, active = i === idx;
    const pop = active ? 1 + 0.18 * (1 - easeOut(clamp((rel - wordStart(i)) / 0.15, 0, 1))) : 1;
    ctx.save();
    ctx.translate(x + widths[k] / 2, y); ctx.scale(active ? pop * 1.08 : 1, active ? pop * 1.08 : 1); ctx.translate(-(x + widths[k] / 2), -y);
    ctx.lineWidth = Math.max(4, size * 0.16); ctx.strokeStyle = st.outline; ctx.strokeText(w.toUpperCase(), x, y);
    ctx.fillStyle = active ? '#ffe36b' : i > idx ? 'rgba(255,255,255,0.55)' : st.color;
    ctx.fillText(w.toUpperCase(), x, y);
    ctx.restore();
    x += widths[k] + gap();
  });
}

function drawTextOverlay(ctx: CanvasRenderingContext2D, tx: TextOverlay, rel: number, W: number, H: number) {
  const fs = fontPx(H, W, tx.size);
  ctx.save();
  ctx.font = `800 ${fs}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let x = tx.x * W, y = tx.y * H, scale = 1, alpha = 1, text = tx.text;
  const inT = clamp(rel / 0.3, 0, 1), outT = clamp((tx.duration - rel) / 0.3, 0, 1);
  switch (tx.animation) {
    case 'pop': scale = easeOutBack(inT) * (0.8 + 0.2 * outT); alpha = outT; break;
    case 'slide': x += (1 - easeOut(inT)) * W * 0.3; alpha = inT * outT; break;
    case 'typewriter': text = text.slice(0, Math.ceil(rel * 20)); break;
    case 'shake': x += Math.sin(rel * 60) * fs * 0.1 * outT; y += Math.cos(rel * 50) * fs * 0.08 * outT; break;
    default: alpha = inT * outT;
  }
  ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.scale(scale, scale);
  if (tx.kind === 'sfx_text') { ctx.rotate(-0.12); ctx.lineWidth = fs * 0.18; ctx.strokeStyle = '#111'; ctx.strokeText(text, 0, 0); ctx.fillStyle = tx.color; ctx.fillText(text, 0, 0); }
  else { ctx.lineWidth = fs * 0.1; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(text, 0, 0); ctx.fillStyle = tx.color; ctx.fillText(text, 0, 0); }
  ctx.restore();
}

function drawTitleCard(ctx: CanvasRenderingContext2D, text: string, alpha: number, W: number, H: number, opening: boolean) {
  ctx.save();
  ctx.globalAlpha = alpha; ctx.fillStyle = 'rgba(7,8,12,0.92)'; ctx.fillRect(0, 0, W, H);
  const fs = fontPx(H, W, 1.8);
  ctx.font = `900 ${fs}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f5a524';
  const lines = wrapText(ctx, text, W * 0.8);
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * fs * 1.2));
  ctx.font = `500 ${fs * 0.35}px Inter, sans-serif`; ctx.fillStyle = '#aab1c9'; ctx.fillText(opening ? 'A STICKY MOTION AI ANIMATION' : 'MADE WITH STICKY MOTION AI', W / 2, H / 2 + fs * 1.1 + fs * 0.6 * (lines.length - 1));
  ctx.restore();
}

function drawSafeArea(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const portrait = H > W * 1.2;
  ctx.save(); ctx.setLineDash([8, 8]); ctx.strokeStyle = 'rgba(245,165,36,0.6)'; ctx.lineWidth = 2;
  if (portrait) ctx.strokeRect(W * 0.06, H * 0.14, W * 0.88, H * 0.68); else ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
  ctx.restore();
}

export function thumbnail(project: Project, time = 0.6, w = 320): string {
  const aspect = project.settings.aspect; const h = aspect === 'landscape' ? Math.round(w * 9 / 16) : aspect === 'portrait' ? Math.round(w * 16 / 9) : w;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  renderFrame(c.getContext('2d')!, project, Math.min(time, Math.max(0, project.scenes.reduce((a, s) => a + s.duration, 0) - 0.1)), w, h);
  return c.toDataURL('image/jpeg', 0.7);
}

export { solveScene };
export type { CharState };
