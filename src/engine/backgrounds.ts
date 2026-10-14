// ───────────────────────────── Procedural backgrounds ─────────────────────────────
import type { BackgroundId } from '../types';

export interface Stage { W: number; H: number; floorY: number }

const STAIR_START = 0.35, STAIR_RUN = 0.055, STAIR_RISE = 0.045, STAIR_COUNT = 12;
/** Height of the ground above the floor line at stage position x (0..1), as a fraction of stage height. */
export function terrainHeight(id: BackgroundId, x: number): number {
  // a smooth slope along the step edges, so climbing glides instead of popping up each step
  if (id === 'stairs' && x >= STAIR_START) return Math.min(STAIR_COUNT * STAIR_RISE, ((x - STAIR_START) / STAIR_RUN + 0.5) * STAIR_RISE);
  return 0;
}

const imgCache = new Map<string, HTMLImageElement | 'loading' | 'error'>();
export function getImage(url: string): HTMLImageElement | null {
  const c = imgCache.get(url);
  if (c instanceof HTMLImageElement) return c;
  if (!c) {
    imgCache.set(url, 'loading');
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => imgCache.set(url, img); img.onerror = () => imgCache.set(url, 'error');
    img.src = url;
  }
  return null;
}

/** Load every custom background image of a project, so rendered frames never show an image still loading. */
export function preloadImages(urls: (string | undefined)[]): Promise<void> {
  return Promise.all(urls.filter((u): u is string => !!u).map(url => new Promise<void>(res => {
    const c = imgCache.get(url);
    if (c instanceof HTMLImageElement || c === 'error') return res();
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { imgCache.set(url, img); res(); }; img.onerror = () => { imgCache.set(url, 'error'); res(); };
    img.src = url;
  }))).then(() => undefined);
}

function sky(ctx: CanvasRenderingContext2D, s: Stage, top: string, bottom: string) {
  const g = ctx.createLinearGradient(0, 0, 0, s.floorY); g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, s.W, s.floorY + 2);
}
function floor(ctx: CanvasRenderingContext2D, s: Stage, color: string, line?: string) {
  ctx.fillStyle = color; ctx.fillRect(0, s.floorY, s.W, s.H - s.floorY);
  if (line) { ctx.strokeStyle = line; ctx.lineWidth = Math.max(2, s.H * 0.004); ctx.beginPath(); ctx.moveTo(0, s.floorY); ctx.lineTo(s.W, s.floorY); ctx.stroke(); }
}
function wall(ctx: CanvasRenderingContext2D, s: Stage, color: string, skirting?: string) {
  ctx.fillStyle = color; ctx.fillRect(0, 0, s.W, s.floorY);
  if (skirting) { ctx.fillStyle = skirting; ctx.fillRect(0, s.floorY - s.H * 0.02, s.W, s.H * 0.02); }
}
function windowFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, glass = '#bfe3ff') {
  ctx.fillStyle = '#5c4a3a'; ctx.fillRect(x - w * 0.04, y - w * 0.04, w * 1.08, h * 1.08);
  ctx.fillStyle = glass; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#5c4a3a'; ctx.fillRect(x + w / 2 - w * 0.02, y, w * 0.04, h); ctx.fillRect(x, y + h / 2 - w * 0.02, w, w * 0.04);
}
function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2); ctx.arc(x + r * 0.9, y - r * 0.3, r * 0.8, 0, Math.PI * 2); ctx.arc(x + r * 1.8, y, r * 0.9, 0, Math.PI * 2); ctx.arc(x + r * 0.9, y + r * 0.3, r * 0.9, 0, Math.PI * 2); ctx.fill();
}
function tree(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, leaf = '#3e9b4f') {
  ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x - h * 0.05, y - h * 0.45, h * 0.1, h * 0.45);
  ctx.fillStyle = leaf; ctx.beginPath(); ctx.arc(x, y - h * 0.65, h * 0.3, 0, Math.PI * 2); ctx.arc(x - h * 0.2, y - h * 0.5, h * 0.22, 0, Math.PI * 2); ctx.arc(x + h * 0.2, y - h * 0.5, h * 0.22, 0, Math.PI * 2); ctx.fill();
}
function building(ctx: CanvasRenderingContext2D, x: number, w: number, h: number, floorY: number, color: string, winColor = '#ffe9a8', seed = 1) {
  ctx.fillStyle = color; ctx.fillRect(x, floorY - h, w, h);
  const cols = Math.max(1, Math.floor(w / (w * 0.3))), rows = Math.max(1, Math.floor(h / (h * 0.12)));
  const cw = w / (cols * 2 + 1), rh = h / (rows * 2 + 1);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lit = ((r * 7 + c * 13 + seed) % 5) !== 0;
    ctx.fillStyle = lit ? winColor : 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + cw * (2 * c + 1), floorY - h + rh * (2 * r + 1), cw, rh);
  }
}

export function drawBackground(ctx: CanvasRenderingContext2D, id: BackgroundId, s: Stage, customUrl?: string, time = 0) {
  const { W, H, floorY } = s;
  switch (id) {
    case 'white': ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = '#d7d7d7'; ctx.lineWidth = Math.max(2, H * 0.003); ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(W, floorY); ctx.stroke(); break;
    case 'black': ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = '#333'; ctx.lineWidth = Math.max(2, H * 0.003); ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(W, floorY); ctx.stroke(); break;
    case 'office': {
      wall(ctx, s, '#e8edf2', '#b8c2cc'); floor(ctx, s, '#8f9aa6', '#6f7a86');
      windowFrame(ctx, W * 0.1, H * 0.12, W * 0.25, H * 0.35, '#cfe8ff');
      // desks silhouette
      ctx.fillStyle = '#c9b79c'; ctx.fillRect(W * 0.55, floorY - H * 0.18, W * 0.3, H * 0.03); ctx.fillRect(W * 0.57, floorY - H * 0.15, W * 0.02, H * 0.15); ctx.fillRect(W * 0.81, floorY - H * 0.15, W * 0.02, H * 0.15);
      ctx.fillStyle = '#333'; ctx.fillRect(W * 0.62, floorY - H * 0.3, W * 0.12, H * 0.11); ctx.fillStyle = '#5aa9ff'; ctx.fillRect(W * 0.625, floorY - H * 0.295, W * 0.11, H * 0.095);
      ctx.fillStyle = '#9aa5b1'; ctx.fillRect(W * 0.9, floorY - H * 0.45, W * 0.06, H * 0.45); // cabinet
      ctx.fillStyle = '#3e9b4f'; ctx.beginPath(); ctx.arc(W * 0.46, floorY - H * 0.12, H * 0.06, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#8b5a2b'; ctx.fillRect(W * 0.44, floorY - H * 0.08, W * 0.04, H * 0.08);
      break;
    }
    case 'bedroom': {
      wall(ctx, s, '#f3dfe8', '#c9a5b8'); floor(ctx, s, '#a97c5b', '#7d5a40');
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(W * 0.6, floorY - H * 0.2, W * 0.32, H * 0.2);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(W * 0.61, floorY - H * 0.2, W * 0.3, H * 0.08); ctx.fillStyle = '#5aa9ff'; ctx.fillRect(W * 0.61, floorY - H * 0.14, W * 0.3, H * 0.1);
      ctx.fillStyle = '#fff'; ctx.fillRect(W * 0.63, floorY - H * 0.24, W * 0.08, H * 0.05);
      windowFrame(ctx, W * 0.15, H * 0.1, W * 0.2, H * 0.3, '#1b2a49');
      ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(W * 0.3, H * 0.18, H * 0.03, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c9b79c'; ctx.fillRect(W * 0.42, floorY - H * 0.14, W * 0.1, H * 0.14); ctx.fillStyle = '#f5a524'; ctx.fillRect(W * 0.455, floorY - H * 0.22, W * 0.04, H * 0.08);
      break;
    }
    case 'classroom': {
      wall(ctx, s, '#f4efe1', '#c9bd9c'); floor(ctx, s, '#c8a977', '#9e8255');
      ctx.fillStyle = '#5b3a29'; ctx.fillRect(W * 0.2, H * 0.1, W * 0.6, H * 0.36);
      ctx.fillStyle = '#2e5339'; ctx.fillRect(W * 0.215, H * 0.115, W * 0.57, H * 0.33);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `${H * 0.05}px "Comic Sans MS", cursive`; ctx.fillText('2 + 2 = 4', W * 0.25, H * 0.22); ctx.fillText('E = mc²', W * 0.55, H * 0.32);
      ctx.fillStyle = '#c9b79c'; ctx.fillRect(W * 0.05, floorY - H * 0.16, W * 0.12, H * 0.025); ctx.fillRect(W * 0.07, floorY - H * 0.14, W * 0.015, H * 0.14); ctx.fillRect(W * 0.145, floorY - H * 0.14, W * 0.015, H * 0.14);
      ctx.fillRect(W * 0.84, floorY - H * 0.16, W * 0.12, H * 0.025); ctx.fillRect(W * 0.86, floorY - H * 0.14, W * 0.015, H * 0.14); ctx.fillRect(W * 0.935, floorY - H * 0.14, W * 0.015, H * 0.14);
      break;
    }
    case 'restaurant': {
      wall(ctx, s, '#6b2d2d', '#3f1a1a'); floor(ctx, s, '#3b2a22', '#2a1d18');
      for (let i = 0; i < 4; i++) { ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(W * (0.15 + i * 0.23), H * 0.1, H * 0.035, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#222'; ctx.fillRect(W * (0.15 + i * 0.23) - 2, 0, 4, H * 0.07); }
      ctx.fillStyle = '#d4a373'; ctx.fillRect(W * 0.68, floorY - H * 0.2, W * 0.26, H * 0.03); ctx.fillRect(W * 0.8, floorY - H * 0.18, W * 0.02, H * 0.18);
      ctx.fillStyle = '#fff'; ctx.fillRect(W * 0.7, floorY - H * 0.205, W * 0.22, H * 0.012);
      ctx.fillStyle = '#c0392b'; ctx.fillRect(W * 0.72, floorY - H * 0.24, W * 0.03, H * 0.04);
      ctx.fillStyle = '#8b5a2b'; ctx.fillRect(W * 0.1, floorY - H * 0.5, W * 0.015, H * 0.5); ctx.fillStyle = '#f5f5f5'; ctx.font = `bold ${H * 0.045}px serif`; ctx.fillText('MENU', W * 0.14, H * 0.3);
      break;
    }
    case 'street': {
      sky(ctx, s, '#79c0ff', '#dff1ff'); cloud(ctx, W * 0.15, H * 0.14, H * 0.05); cloud(ctx, W * 0.7, H * 0.1, H * 0.06);
      for (let i = 0; i < 6; i++) building(ctx, W * (i * 0.17 - 0.02), W * 0.15, H * (0.3 + ((i * 37) % 5) * 0.06), floorY - H * 0.06, ['#c9a27e', '#9fb3c8', '#d7c0a8', '#b8a3c4', '#a8c4b0', '#c4b0a3'][i], '#fff8d6', i);
      ctx.fillStyle = '#9b9b9b'; ctx.fillRect(0, floorY - H * 0.06, W, H * 0.06); // sidewalk
      floor(ctx, s, '#444a52'); ctx.fillStyle = '#e9e9e9'; for (let i = 0; i < 10; i++) ctx.fillRect(W * (i * 0.11 + 0.01), floorY + (H - floorY) * 0.5, W * 0.06, H * 0.012);
      ctx.fillStyle = '#333'; ctx.fillRect(W * 0.86, floorY - H * 0.4, W * 0.008, H * 0.34); ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(W * 0.864, floorY - H * 0.41, H * 0.025, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'park': {
      sky(ctx, s, '#7fc8ff', '#eaf7ff'); cloud(ctx, W * 0.2, H * 0.15, H * 0.05); cloud(ctx, W * 0.65, H * 0.08, H * 0.04);
      ctx.fillStyle = '#ffe36b'; ctx.beginPath(); ctx.arc(W * 0.88, H * 0.14, H * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#86c66a'; ctx.beginPath(); ctx.ellipse(W * 0.3, floorY, W * 0.5, H * 0.12, 0, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#6fb354'; ctx.beginPath(); ctx.ellipse(W * 0.85, floorY, W * 0.45, H * 0.09, 0, Math.PI, 0); ctx.fill();
      floor(ctx, s, '#5faa47');
      tree(ctx, W * 0.1, floorY, H * 0.5); tree(ctx, W * 0.9, floorY, H * 0.6, '#2f8a3f'); tree(ctx, W * 0.72, floorY - H * 0.03, H * 0.35, '#4caf50');
      ctx.fillStyle = '#7a4b26'; ctx.fillRect(W * 0.4, floorY - H * 0.12, W * 0.16, H * 0.02); ctx.fillRect(W * 0.4, floorY - H * 0.18, W * 0.16, H * 0.02); ctx.fillRect(W * 0.41, floorY - H * 0.1, W * 0.01, H * 0.1); ctx.fillRect(W * 0.54, floorY - H * 0.1, W * 0.01, H * 0.1);
      break;
    }
    case 'school': {
      sky(ctx, s, '#8fd0ff', '#e3f3ff'); cloud(ctx, W * 0.75, H * 0.12, H * 0.05);
      ctx.fillStyle = '#c96f4a'; ctx.fillRect(W * 0.15, H * 0.2, W * 0.7, floorY - H * 0.2);
      ctx.fillStyle = '#7a3e2a'; ctx.beginPath(); ctx.moveTo(W * 0.12, H * 0.2); ctx.lineTo(W * 0.5, H * 0.04); ctx.lineTo(W * 0.88, H * 0.2); ctx.closePath(); ctx.fill();
      for (let i = 0; i < 4; i++) windowFrame(ctx, W * (0.2 + i * 0.165), H * 0.3, W * 0.1, H * 0.16, '#fff');
      ctx.fillStyle = '#4a2a1a'; ctx.fillRect(W * 0.45, floorY - H * 0.25, W * 0.1, H * 0.25);
      ctx.fillStyle = '#fff'; ctx.font = `bold ${H * 0.045}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('SCHOOL', W * 0.5, H * 0.26); ctx.textAlign = 'left';
      floor(ctx, s, '#9e9e9e', '#777');
      break;
    }
    case 'shop': {
      wall(ctx, s, '#f7f3ea', '#cfc6b3'); floor(ctx, s, '#d9d4c7', '#aaa');
      for (let r = 0; r < 3; r++) { ctx.fillStyle = '#8b6b4a'; ctx.fillRect(W * 0.05, H * (0.15 + r * 0.14), W * 0.4, H * 0.02); for (let i = 0; i < 6; i++) { ctx.fillStyle = ['#f5a524', '#5aa9ff', '#3ddc97', '#ff6b6b', '#c084fc', '#facc15'][(i + r) % 6]; ctx.fillRect(W * (0.07 + i * 0.065), H * (0.09 + r * 0.14), W * 0.04, H * 0.06); } }
      ctx.fillStyle = '#5c5c5c'; ctx.fillRect(W * 0.6, floorY - H * 0.22, W * 0.3, H * 0.22); ctx.fillStyle = '#eee'; ctx.fillRect(W * 0.6, floorY - H * 0.24, W * 0.3, H * 0.02);
      ctx.fillStyle = '#222'; ctx.fillRect(W * 0.66, floorY - H * 0.32, W * 0.06, H * 0.08); ctx.fillStyle = '#5aa9ff'; ctx.fillRect(W * 0.665, floorY - H * 0.315, W * 0.05, H * 0.06);
      ctx.fillStyle = '#c0392b'; ctx.font = `bold ${H * 0.06}px sans-serif`; ctx.fillText('SALE', W * 0.72, H * 0.2);
      break;
    }
    case 'city': {
      sky(ctx, s, '#1b2140', '#5b4a8a');
      for (let i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect((i * 97) % W, (i * 53) % (H * 0.4), 2, 2); }
      ctx.fillStyle = '#f2e9c8'; ctx.beginPath(); ctx.arc(W * 0.8, H * 0.15, H * 0.06, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 9; i++) building(ctx, W * (i * 0.12 - 0.03), W * 0.11, H * (0.35 + ((i * 29) % 7) * 0.05), floorY, ['#2b3150', '#343b60', '#222846'][i % 3], '#ffd86b', i);
      floor(ctx, s, '#1a1d2a', '#2d3146');
      break;
    }
    case 'stadium': {
      sky(ctx, s, '#2a3d6b', '#6c8fd1');
      ctx.fillStyle = '#3b4a6e'; ctx.fillRect(0, H * 0.25, W, floorY - H * 0.25);
      for (let r = 0; r < 5; r++) { for (let i = 0; i < 40; i++) { ctx.fillStyle = ['#ff6b6b', '#5aa9ff', '#f5a524', '#3ddc97', '#fff'][(i + r) % 5]; ctx.beginPath(); ctx.arc(W * (i / 40 + 0.012), H * (0.3 + r * 0.07), H * 0.012, 0, Math.PI * 2); ctx.fill(); } }
      for (let i = 0; i < 4; i++) { ctx.fillStyle = '#ddd'; ctx.fillRect(W * (0.1 + i * 0.26), H * 0.02, W * 0.01, H * 0.23); ctx.fillStyle = '#fffbd6'; ctx.fillRect(W * (0.07 + i * 0.26), 0, W * 0.07, H * 0.04); }
      floor(ctx, s, '#3d9a3d'); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, H * 0.005); ctx.beginPath(); ctx.moveTo(0, floorY + (H - floorY) * 0.5); ctx.lineTo(W, floorY + (H - floorY) * 0.5); ctx.stroke();
      break;
    }
    case 'landscape': {
      sky(ctx, s, '#ffb07a', '#ffe6c7'); ctx.fillStyle = '#ffd36b'; ctx.beginPath(); ctx.arc(W * 0.7, H * 0.35, H * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7a6a9a'; ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(W * 0.2, H * 0.3); ctx.lineTo(W * 0.4, floorY); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5a4d7a'; ctx.beginPath(); ctx.moveTo(W * 0.3, floorY); ctx.lineTo(W * 0.55, H * 0.22); ctx.lineTo(W * 0.85, floorY); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(W * 0.5, H * 0.3); ctx.lineTo(W * 0.55, H * 0.22); ctx.lineTo(W * 0.6, H * 0.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4b8b3b'; ctx.beginPath(); ctx.ellipse(W * 0.5, floorY, W * 0.8, H * 0.1, 0, Math.PI, 0); ctx.fill();
      floor(ctx, s, '#5faa47'); tree(ctx, W * 0.92, floorY, H * 0.45);
      break;
    }
    case 'gym': {
      wall(ctx, s, '#2b2f3a', '#1d2029'); floor(ctx, s, '#3a3f4b', '#555b6b');
      // mirror wall
      ctx.fillStyle = 'rgba(180,210,255,0.18)'; ctx.fillRect(W * 0.05, H * 0.12, W * 0.5, H * 0.42); ctx.strokeStyle = '#8892a6'; ctx.lineWidth = Math.max(2, H * 0.004); ctx.strokeRect(W * 0.05, H * 0.12, W * 0.5, H * 0.42);
      ctx.fillStyle = '#f5a524'; ctx.font = `900 ${H * 0.07}px Impact, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('NO PAIN NO GAIN', W * 0.3, H * 0.09); ctx.textAlign = 'left';
      // weight rack
      ctx.fillStyle = '#666'; ctx.fillRect(W * 0.68, floorY - H * 0.42, W * 0.012, H * 0.42); ctx.fillRect(W * 0.9, floorY - H * 0.42, W * 0.012, H * 0.42);
      for (let r = 0; r < 3; r++) { ctx.fillStyle = '#888'; ctx.fillRect(W * 0.68, floorY - H * (0.12 + r * 0.12), W * 0.232, H * 0.008); for (let i = 0; i < 4; i++) { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(W * (0.71 + i * 0.055), floorY - H * (0.14 + r * 0.12), H * (0.02 + r * 0.004), 0, Math.PI * 2); ctx.fill(); } }
      // bench
      ctx.fillStyle = '#c0392b'; ctx.fillRect(W * 0.08, floorY - H * 0.09, W * 0.18, H * 0.03); ctx.fillStyle = '#555'; ctx.fillRect(W * 0.1, floorY - H * 0.06, W * 0.01, H * 0.06); ctx.fillRect(W * 0.23, floorY - H * 0.06, W * 0.01, H * 0.06);
      break;
    }
    case 'mountain': {
      sky(ctx, s, '#4a7fd6', '#cfe6ff'); cloud(ctx, W * 0.08, H * 0.4, H * 0.05); cloud(ctx, W * 0.78, H * 0.45, H * 0.06);
      // distant peaks below the summit
      ctx.fillStyle = '#9fb3d1'; ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(W * 0.15, H * 0.55); ctx.lineTo(W * 0.32, floorY); ctx.lineTo(W * 0.62, H * 0.58); ctx.lineTo(W * 0.85, floorY); ctx.lineTo(W, H * 0.6); ctx.lineTo(W, floorY); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c9d6ea'; ctx.fillRect(0, floorY, W, H - floorY);   // mist in the valley
      // the summit the characters stand on
      ctx.fillStyle = '#6d6a75'; ctx.beginPath(); ctx.moveTo(-W * 0.05, H); ctx.lineTo(W * 0.2, floorY); ctx.lineTo(W * 0.8, floorY); ctx.lineTo(W * 1.05, H); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f4f6fb'; ctx.beginPath(); ctx.moveTo(W * 0.2, floorY); ctx.lineTo(W * 0.8, floorY); ctx.lineTo(W * 0.74, floorY + H * 0.05); ctx.lineTo(W * 0.5, floorY + H * 0.035); ctx.lineTo(W * 0.27, floorY + H * 0.06); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(W * 0.86, H * 0.14, H * 0.06, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'stairs': {
      sky(ctx, s, '#f6d365', '#fda085');
      ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(W * 0.85, H * 0.15, H * 0.08, 0, Math.PI * 2); ctx.fill();
      // a long staircase rising toward the light
      for (let i = 0; i < STAIR_COUNT; i++) {
        const x = W * (STAIR_START + i * STAIR_RUN), top = floorY - H * STAIR_RISE * (i + 1);
        ctx.fillStyle = i % 2 ? '#b7a99a' : '#c9bcae'; ctx.fillRect(x, top, W * 0.7, floorY - top);
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x, top, W * 0.7, H * 0.008);
      }
      floor(ctx, s, '#a89888', '#8a7b6c');
      break;
    }
    case 'sunrise': {
      const g = ctx.createLinearGradient(0, 0, 0, floorY); g.addColorStop(0, '#2b3a67'); g.addColorStop(0.55, '#f08a5d'); g.addColorStop(1, '#f9d56e');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, floorY + 2);
      // the sun rises slowly through the scene
      const sy = floorY - H * 0.08 - Math.min(H * 0.12, time * H * 0.012);
      ctx.fillStyle = 'rgba(255,240,180,0.35)'; ctx.beginPath(); ctx.arc(W * 0.5, sy, H * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(W * 0.5, sy, H * 0.11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3d2c4e'; ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(W * 0.18, floorY - H * 0.1); ctx.lineTo(W * 0.35, floorY); ctx.moveTo(W * 0.62, floorY); ctx.lineTo(W * 0.82, floorY - H * 0.13); ctx.lineTo(W, floorY - H * 0.05); ctx.lineTo(W, floorY); ctx.fill();
      floor(ctx, s, '#2e2238');
      break;
    }
    case 'night': {
      sky(ctx, s, '#05070f', '#1c2340');
      for (let i = 0; i < 70; i++) { const tw = 0.5 + 0.5 * Math.sin(time * 2 + i); ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.6 * tw})`; ctx.fillRect((i * 137) % W, (i * 71) % (floorY * 0.7), 2, 2); }
      ctx.fillStyle = '#f2e9c8'; ctx.beginPath(); ctx.arc(W * 0.2, H * 0.16, H * 0.06, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#05070f'; ctx.beginPath(); ctx.arc(W * 0.215, H * 0.15, H * 0.055, 0, Math.PI * 2); ctx.fill();
      floor(ctx, s, '#0d1020', '#1f2440');
      // a single street light and its pool of light
      ctx.fillStyle = 'rgba(255,220,140,0.12)'; ctx.beginPath(); ctx.moveTo(W * 0.62, floorY - H * 0.48); ctx.lineTo(W * 0.48, floorY); ctx.lineTo(W * 0.76, floorY); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#333'; ctx.fillRect(W * 0.615, floorY - H * 0.5, W * 0.01, H * 0.5); ctx.fillStyle = '#ffd98a'; ctx.beginPath(); ctx.arc(W * 0.62, floorY - H * 0.5, H * 0.022, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'rain': {
      sky(ctx, s, '#3c4552', '#6b7684');
      for (let i = 0; i < 6; i++) building(ctx, W * (i * 0.17 - 0.02), W * 0.15, H * (0.28 + ((i * 37) % 5) * 0.05), floorY, '#4b5563', '#8a94a6', i);
      floor(ctx, s, '#2d333b', '#4b5563');
      ctx.fillStyle = 'rgba(160,180,200,0.25)'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(W * (0.1 + i * 0.17), floorY + (H - floorY) * 0.4, W * 0.05, H * 0.006, 0, 0, Math.PI * 2); ctx.fill(); }
      // falling rain, driven by time so it moves in preview and export alike
      ctx.strokeStyle = 'rgba(200,215,235,0.5)'; ctx.lineWidth = Math.max(1, H * 0.002); ctx.beginPath();
      for (let i = 0; i < 160; i++) { const x = ((i * 89.3) % W) + ((time * 140) % 40), y = ((i * 53.7 + time * H * 1.4) % H); ctx.moveTo(x, y); ctx.lineTo(x - H * 0.01, y + H * 0.04); }
      ctx.stroke();
      break;
    }
    case 'stage': {
      wall(ctx, s, '#14101f'); floor(ctx, s, '#4a2b1a', '#7a4a2b');
      ctx.fillStyle = '#7a1020'; ctx.fillRect(0, 0, W * 0.12, floorY); ctx.fillRect(W * 0.88, 0, W * 0.12, floorY); ctx.fillRect(0, 0, W, H * 0.07);
      for (const x of [0.3, 0.7]) { const g = ctx.createRadialGradient(W * x, floorY, 0, W * x, floorY, H * 0.5); g.addColorStop(0, 'rgba(255,240,190,0.35)'); g.addColorStop(1, 'rgba(255,240,190,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(W * x, 0); ctx.lineTo(W * (x - 0.15), floorY); ctx.lineTo(W * (x + 0.15), floorY); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = '#f5c518'; ctx.font = `900 ${H * 0.06}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('★ AWARDS ★', W * 0.5, H * 0.2); ctx.textAlign = 'left';
      for (let i = 0; i < 30; i++) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(W * (i / 30 + 0.015), H - H * 0.03, H * 0.03, Math.PI, 0); ctx.fill(); }
      break;
    }
    case 'road': {
      sky(ctx, s, '#87b8e8', '#f7e3c3'); cloud(ctx, W * 0.15, H * 0.12, H * 0.05);
      const hz = floorY - H * 0.18;
      ctx.fillStyle = '#c9b38a'; ctx.fillRect(0, hz, W, floorY - hz);
      // a road narrowing to the horizon
      ctx.fillStyle = '#4a4a4a'; ctx.beginPath(); ctx.moveTo(W * 0.48, hz); ctx.lineTo(W * 0.52, hz); ctx.lineTo(W * 0.85, floorY); ctx.lineTo(W * 0.15, floorY); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f5d76e'; for (let i = 0; i < 6; i++) { const t0 = i / 6, t1 = t0 + 0.07, y0 = hz + (floorY - hz) * t0 ** 1.6, y1 = hz + (floorY - hz) * t1 ** 1.6; ctx.fillRect(W * 0.5 - (1 + t0 * 6), y0, 2 + t0 * 12, y1 - y0); }
      ctx.fillStyle = '#8a7b6c'; ctx.beginPath(); ctx.moveTo(0, hz); ctx.lineTo(W * 0.12, hz - H * 0.07); ctx.lineTo(W * 0.3, hz); ctx.moveTo(W * 0.66, hz); ctx.lineTo(W * 0.85, hz - H * 0.09); ctx.lineTo(W, hz); ctx.fill();
      floor(ctx, s, '#4a4a4a');
      break;
    }
    case 'custom': {
      ctx.fillStyle = '#222'; ctx.fillRect(0, 0, W, H);
      if (customUrl) { const img = getImage(customUrl); if (img) { const r = Math.max(W / img.width, H / img.height); const w = img.width * r, h = img.height * r; ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); } }
      else { ctx.fillStyle = '#888'; ctx.font = `${H * 0.04}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('No custom background image', W / 2, H / 2); ctx.textAlign = 'left'; }
      break;
    }
  }
}
