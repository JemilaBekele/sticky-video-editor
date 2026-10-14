// ───────────────────────────── Procedural props ─────────────────────────────
import type { PropType } from '../types';

/** Draw a prop centered horizontally at (x, baseY) where baseY is the bottom of the object. size = nominal height in px. */
export function drawProp(ctx: CanvasRenderingContext2D, type: PropType, x: number, baseY: number, size: number, opts: { selected?: boolean; label?: string; held?: boolean; rotation?: number } = {}) {
  ctx.save();
  ctx.translate(x, baseY);
  if (opts.rotation) ctx.rotate(opts.rotation);
  const s = size;
  ctx.lineWidth = Math.max(2, s * 0.04); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (type) {
    case 'table':
      ctx.fillStyle = '#b07d4f'; ctx.fillRect(-s * 0.9, -s, s * 1.8, s * 0.1); ctx.fillRect(-s * 0.8, -s * 0.9, s * 0.1, s * 0.9); ctx.fillRect(s * 0.7, -s * 0.9, s * 0.1, s * 0.9); break;
    case 'chair':
      ctx.fillStyle = '#8a5a35'; ctx.fillRect(-s * 0.4, -s * 0.5, s * 0.8, s * 0.08); ctx.fillRect(-s * 0.4, -s, s * 0.08, s * 0.5); ctx.fillRect(-s * 0.4, -s * 0.42, s * 0.08, s * 0.42); ctx.fillRect(s * 0.32, -s * 0.42, s * 0.08, s * 0.42); ctx.fillRect(-s * 0.4, -s, s * 0.8, s * 0.07); break;
    case 'door':
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-s * 0.32, -s * 1.05, s * 0.64, s * 1.05); ctx.fillStyle = '#8b6b4a'; ctx.fillRect(-s * 0.27, -s, s * 0.54, s); ctx.fillStyle = '#f5c518'; ctx.beginPath(); ctx.arc(s * 0.17, -s * 0.5, s * 0.035, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.strokeRect(-s * 0.2, -s * 0.9, s * 0.4, s * 0.35); ctx.strokeRect(-s * 0.2, -s * 0.45, s * 0.4, s * 0.35); break;
    case 'window':
      ctx.fillStyle = '#5c4a3a'; ctx.fillRect(-s * 0.55, -s * 1.6, s * 1.1, s * 0.8); ctx.fillStyle = '#bfe3ff'; ctx.fillRect(-s * 0.5, -s * 1.55, s, s * 0.7); ctx.fillStyle = '#5c4a3a'; ctx.fillRect(-s * 0.02, -s * 1.55, s * 0.04, s * 0.7); ctx.fillRect(-s * 0.5, -s * 1.22, s, s * 0.04); break;
    case 'phone':
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.roundRect(-s * 0.12, -s * 0.45, s * 0.24, s * 0.45, s * 0.03); ctx.fill(); ctx.fillStyle = '#5aa9ff'; ctx.fillRect(-s * 0.1, -s * 0.42, s * 0.2, s * 0.37); break;
    case 'computer':
      ctx.fillStyle = '#222'; ctx.fillRect(-s * 0.45, -s * 0.75, s * 0.9, s * 0.6); ctx.fillStyle = '#5aa9ff'; ctx.fillRect(-s * 0.42, -s * 0.72, s * 0.84, s * 0.52); ctx.fillStyle = '#333'; ctx.fillRect(-s * 0.08, -s * 0.15, s * 0.16, s * 0.1); ctx.fillRect(-s * 0.3, -s * 0.06, s * 0.6, s * 0.06); break;
    case 'bag':
      ctx.fillStyle = '#8b4513'; ctx.beginPath(); ctx.roundRect(-s * 0.3, -s * 0.45, s * 0.6, s * 0.45, s * 0.06); ctx.fill(); ctx.strokeStyle = '#5a2d0c'; ctx.beginPath(); ctx.arc(0, -s * 0.45, s * 0.14, Math.PI, 0); ctx.stroke(); ctx.fillStyle = '#f5c518'; ctx.fillRect(-s * 0.05, -s * 0.3, s * 0.1, s * 0.06); break;
    case 'book':
      ctx.fillStyle = '#c0392b'; ctx.fillRect(-s * 0.25, -s * 0.36, s * 0.5, s * 0.36); ctx.fillStyle = '#fff'; ctx.fillRect(-s * 0.21, -s * 0.33, s * 0.42, s * 0.3); ctx.fillStyle = '#c0392b'; ctx.fillRect(-s * 0.03, -s * 0.36, s * 0.06, s * 0.36); break;
    case 'car':
      ctx.fillStyle = '#d7263d'; ctx.beginPath(); ctx.roundRect(-s * 1.1, -s * 0.55, s * 2.2, s * 0.4, s * 0.08); ctx.fill(); ctx.beginPath(); ctx.roundRect(-s * 0.6, -s * 0.9, s * 1.2, s * 0.4, s * 0.1); ctx.fill(); ctx.fillStyle = '#bfe3ff'; ctx.fillRect(-s * 0.5, -s * 0.85, s * 0.45, s * 0.28); ctx.fillRect(s * 0.05, -s * 0.85, s * 0.45, s * 0.28); ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-s * 0.65, -s * 0.12, s * 0.2, 0, Math.PI * 2); ctx.arc(s * 0.65, -s * 0.12, s * 0.2, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#999'; ctx.beginPath(); ctx.arc(-s * 0.65, -s * 0.12, s * 0.09, 0, Math.PI * 2); ctx.arc(s * 0.65, -s * 0.12, s * 0.09, 0, Math.PI * 2); ctx.fill(); break;
    case 'box':
      ctx.fillStyle = '#c9a068'; ctx.fillRect(-s * 0.35, -s * 0.6, s * 0.7, s * 0.6); ctx.fillStyle = '#a67c48'; ctx.fillRect(-s * 0.35, -s * 0.6, s * 0.7, s * 0.08); ctx.strokeStyle = '#8a6335'; ctx.beginPath(); ctx.moveTo(0, -s * 0.52); ctx.lineTo(0, 0); ctx.stroke(); break;
    case 'money':
      for (let i = 0; i < 3; i++) { ctx.fillStyle = '#2ecc71'; ctx.fillRect(-s * 0.3 + i * s * 0.03, -s * 0.18 - i * s * 0.05, s * 0.6, s * 0.25); ctx.strokeStyle = '#1e8449'; ctx.strokeRect(-s * 0.27 + i * s * 0.03, -s * 0.15 - i * s * 0.05, s * 0.54, s * 0.19); }
      ctx.fillStyle = '#145a32'; ctx.font = `bold ${s * 0.16}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('$', s * 0.03, -s * 0.12); break;
    case 'banana':
      ctx.strokeStyle = '#f5d100'; ctx.lineWidth = s * 0.14; ctx.beginPath(); ctx.arc(0, -s * 0.0, s * 0.35, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); ctx.strokeStyle = '#8a6b00'; ctx.lineWidth = s * 0.05; ctx.beginPath(); ctx.moveTo(s * 0.33, -s * 0.2); ctx.lineTo(s * 0.38, -s * 0.28); ctx.stroke(); break;
    case 'cup':
      ctx.fillStyle = '#fff'; ctx.fillRect(-s * 0.15, -s * 0.35, s * 0.3, s * 0.35); ctx.strokeStyle = '#999'; ctx.beginPath(); ctx.arc(s * 0.2, -s * 0.2, s * 0.08, -Math.PI / 2, Math.PI / 2); ctx.stroke(); ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-s * 0.13, -s * 0.33, s * 0.26, s * 0.06); break;
    case 'ball':
      ctx.fillStyle = '#ff6b35'; ctx.beginPath(); ctx.arc(0, -s * 0.3, s * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#222'; ctx.lineWidth = s * 0.03; ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 0.3); ctx.lineTo(s * 0.3, -s * 0.3); ctx.moveTo(0, -s * 0.6); ctx.lineTo(0, 0); ctx.stroke(); break;
    case 'sign':
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-s * 0.04, -s * 1.1, s * 0.08, s * 1.1); ctx.fillStyle = '#f5e6c8'; ctx.fillRect(-s * 0.5, -s * 1.4, s, s * 0.45); ctx.strokeStyle = '#6b4a2b'; ctx.strokeRect(-s * 0.5, -s * 1.4, s, s * 0.45);
      ctx.fillStyle = '#222'; ctx.font = `bold ${s * 0.18}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(opts.label ?? 'SIGN', 0, -s * 1.1); break;
    case 'tree':
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-s * 0.08, -s * 0.8, s * 0.16, s * 0.8); ctx.fillStyle = '#3e9b4f'; ctx.beginPath(); ctx.arc(0, -s * 1.15, s * 0.5, 0, Math.PI * 2); ctx.arc(-s * 0.35, -s * 0.9, s * 0.35, 0, Math.PI * 2); ctx.arc(s * 0.35, -s * 0.9, s * 0.35, 0, Math.PI * 2); ctx.fill(); break;
    case 'lamp':
      ctx.fillStyle = '#555'; ctx.fillRect(-s * 0.03, -s * 1.5, s * 0.06, s * 1.5); ctx.fillRect(-s * 0.2, -s * 0.04, s * 0.4, s * 0.04); ctx.fillStyle = '#f5e6a8'; ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 1.5); ctx.lineTo(s * 0.3, -s * 1.5); ctx.lineTo(s * 0.18, -s * 1.8); ctx.lineTo(-s * 0.18, -s * 1.8); ctx.closePath(); ctx.fill(); break;
    case 'wallet':
      ctx.fillStyle = '#5a3a1a'; ctx.beginPath(); ctx.roundRect(-s * 0.22, -s * 0.3, s * 0.44, s * 0.3, s * 0.04); ctx.fill(); ctx.fillStyle = '#7a5a3a'; ctx.fillRect(-s * 0.22, -s * 0.18, s * 0.44, s * 0.05); ctx.fillStyle = '#f5c518'; ctx.fillRect(s * 0.08, -s * 0.2, s * 0.08, s * 0.08); break;
    case 'trophy':
      ctx.fillStyle = '#f5c518'; ctx.beginPath(); ctx.moveTo(-s * 0.22, -s * 0.9); ctx.lineTo(s * 0.22, -s * 0.9); ctx.quadraticCurveTo(s * 0.22, -s * 0.45, 0, -s * 0.42); ctx.quadraticCurveTo(-s * 0.22, -s * 0.45, -s * 0.22, -s * 0.9); ctx.fill();
      ctx.strokeStyle = '#f5c518'; ctx.lineWidth = s * 0.04; ctx.beginPath(); ctx.arc(-s * 0.22, -s * 0.75, s * 0.09, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke(); ctx.beginPath(); ctx.arc(s * 0.22, -s * 0.75, s * 0.09, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke();
      ctx.fillStyle = '#d4a20f'; ctx.fillRect(-s * 0.04, -s * 0.43, s * 0.08, s * 0.2); ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-s * 0.18, -s * 0.23, s * 0.36, s * 0.23);
      ctx.fillStyle = '#fff7c2'; ctx.beginPath(); ctx.ellipse(-s * 0.08, -s * 0.75, s * 0.03, s * 0.1, 0, 0, Math.PI * 2); ctx.fill(); break;
    case 'dumbbell':
      ctx.fillStyle = '#555'; ctx.fillRect(-s * 0.35, -s * 0.13, s * 0.7, s * 0.06);
      ctx.fillStyle = '#222'; for (const x of [-0.38, 0.26]) { ctx.beginPath(); ctx.roundRect(s * x, -s * 0.26, s * 0.12, s * 0.26, s * 0.02); ctx.fill(); } break;
    case 'flag':
      ctx.fillStyle = '#ddd'; ctx.fillRect(-s * 0.02, -s * 1.4, s * 0.04, s * 1.4);
      ctx.fillStyle = '#e63946'; ctx.beginPath(); ctx.moveTo(s * 0.02, -s * 1.4); ctx.quadraticCurveTo(s * 0.35, -s * 1.45, s * 0.6, -s * 1.32); ctx.lineTo(s * 0.6, -s * 1.02); ctx.quadraticCurveTo(s * 0.35, -s * 1.15, s * 0.02, -s * 1.08); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `bold ${s * 0.16}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(opts.label ?? '', s * 0.3, -s * 1.17); break;
    case 'clock':
      ctx.fillStyle = '#e63946'; ctx.beginPath(); ctx.arc(-s * 0.18, -s * 0.5, s * 0.08, 0, Math.PI * 2); ctx.arc(s * 0.18, -s * 0.5, s * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#e63946'; ctx.lineWidth = s * 0.04; ctx.beginPath(); ctx.arc(0, -s * 0.28, s * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#222'; ctx.lineWidth = s * 0.025; ctx.beginPath(); ctx.moveTo(0, -s * 0.28); ctx.lineTo(0, -s * 0.42); ctx.moveTo(0, -s * 0.28); ctx.lineTo(s * 0.1, -s * 0.24); ctx.stroke();
      ctx.fillStyle = '#e63946'; ctx.fillRect(-s * 0.16, -s * 0.07, s * 0.05, s * 0.07); ctx.fillRect(s * 0.11, -s * 0.07, s * 0.05, s * 0.07); break;
    case 'bed':
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-s * 1.0, -s * 0.75, s * 0.08, s * 0.75); ctx.fillRect(s * 0.92, -s * 0.5, s * 0.08, s * 0.5); ctx.fillRect(-s * 1.0, -s * 0.32, s * 2.0, s * 0.12);
      ctx.fillStyle = '#fff'; ctx.fillRect(-s * 0.92, -s * 0.46, s * 1.84, s * 0.14); ctx.fillStyle = '#5aa9ff'; ctx.fillRect(-s * 0.45, -s * 0.48, s * 1.37, s * 0.16);
      ctx.fillStyle = '#f0f0f0'; ctx.beginPath(); ctx.roundRect(-s * 0.9, -s * 0.58, s * 0.4, s * 0.14, s * 0.05); ctx.fill(); break;
    case 'podium':
      for (const [x, h, n] of [[-0.6, 0.45, '2'], [-0.2, 0.7, '1'], [0.2, 0.3, '3']] as [number, number, string][]) {
        ctx.fillStyle = n === '1' ? '#f5c518' : n === '2' ? '#c0c0c0' : '#cd7f32'; ctx.fillRect(s * x, -s * h, s * 0.4, s * h);
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.font = `bold ${s * 0.18}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(n, s * (x + 0.2), -s * (h - 0.22));
      } break;
  }
  if (opts.selected) { ctx.setLineDash([6, 6]); ctx.strokeStyle = '#f5a524'; ctx.lineWidth = 2; const b = propBounds(type, s); ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.setLineDash([]); }
  ctx.restore();
}

export function propBounds(type: PropType, s: number) {
  const map: Partial<Record<PropType, [number, number, number, number]>> = {
    table: [-0.95, -1.05, 1.9, 1.1], chair: [-0.45, -1.05, 0.9, 1.1], door: [-0.37, -1.1, 0.74, 1.15], window: [-0.6, -1.65, 1.2, 0.9], phone: [-0.17, -0.5, 0.34, 0.55],
    computer: [-0.5, -0.8, 1, 0.85], bag: [-0.35, -0.65, 0.7, 0.7], book: [-0.3, -0.4, 0.6, 0.45], car: [-1.15, -0.95, 2.3, 1], box: [-0.4, -0.65, 0.8, 0.7], money: [-0.35, -0.35, 0.7, 0.45],
    banana: [-0.4, -0.45, 0.8, 0.5], cup: [-0.2, -0.4, 0.5, 0.45], ball: [-0.35, -0.65, 0.7, 0.7], sign: [-0.55, -1.45, 1.1, 1.5], tree: [-0.75, -1.7, 1.5, 1.75], lamp: [-0.35, -1.85, 0.7, 1.9], wallet: [-0.27, -0.35, 0.54, 0.4],
    trophy: [-0.35, -0.95, 0.7, 1], dumbbell: [-0.42, -0.3, 0.84, 0.35], flag: [-0.05, -1.45, 0.7, 1.5], clock: [-0.3, -0.6, 0.6, 0.65], bed: [-1.05, -0.8, 2.1, 0.85], podium: [-0.65, -0.75, 0.9, 0.8],
  };
  const [x, y, w, h] = map[type] ?? [-0.5, -1, 1, 1];
  return { x: x * s, y: y * s, w: w * s, h: h * s };
}

/** Props that can be carried in a hand. */
export const HANDHELD: PropType[] = ['phone', 'bag', 'book', 'money', 'banana', 'cup', 'ball', 'wallet', 'box', 'trophy', 'dumbbell', 'clock'];
/** Relative size of props compared to character height. */
export const PROP_REL_SIZE: Record<PropType, number> = {
  table: 0.55, chair: 0.6, door: 1.0, window: 0.6, phone: 0.35, computer: 0.5, bag: 0.45, book: 0.35, car: 0.6, box: 0.5, money: 0.3,
  banana: 0.3, cup: 0.3, ball: 0.4, sign: 0.75, tree: 1.0, lamp: 0.75, wallet: 0.3,
  trophy: 0.45, dumbbell: 0.35, flag: 0.8, clock: 0.3, bed: 0.55, podium: 0.6,
};
