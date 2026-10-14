// ───────────────────────────── Stickman rig ─────────────────────────────
// A pose is a set of joint angles. The rig is a connected kinematic chain:
// hip → torso → neck → head; shoulders → upper arm → lower arm; hip → upper leg → lower leg.
// All angles are in radians. Arm/leg angles are measured from "straight down";
// positive = toward the character's facing direction.

import type { Character, Emotion, Accessory } from '../types';

export type Eyes = 'open' | 'closed' | 'wide' | 'squint' | 'happy' | 'angry' | 'sad' | 'dizzy';

export interface Pose {
  hipY: number;        // vertical offset of hip in body-height units (negative = lower / crouch, positive = jump)
  hipX: number;        // forward offset in body-height units (lean / lunge)
  bodyRot: number;     // rotation of whole figure around hip (for falling / lying). +ve = falls forward
  torsoLean: number;   // torso lean from vertical
  headTilt: number;    // head rotation relative to torso
  headBob: number;     // vertical head offset (fraction of head radius)
  lShoulder: number; lElbow: number;
  rShoulder: number; rElbow: number;
  lHip: number; lKnee: number;
  rHip: number; rKnee: number;
  mouth: number;       // 0 closed .. 1 wide open
  mouthShape: 'flat' | 'smile' | 'frown' | 'o' | 'grin' | 'wavy';
  eyes: Eyes;
  brow: number;        // -1 angry .. 0 .. 1 raised
  blush?: boolean;
  sweat?: boolean;
  tears?: boolean;
  anger?: boolean;     // anger mark
  question?: boolean;  // "?" above head
  exclaim?: boolean;   // "!" above head
  zzz?: boolean;
  stars?: boolean;     // dizzy stars
  musicNotes?: boolean;
}

export const IDLE: Pose = {
  hipY: 0, hipX: 0, bodyRot: 0, torsoLean: 0, headTilt: 0, headBob: 0,
  lShoulder: 0.12, lElbow: 0.1, rShoulder: -0.12, rElbow: -0.1,
  lHip: 0.06, lKnee: 0, rHip: -0.06, rKnee: 0,
  mouth: 0, mouthShape: 'flat', eyes: 'open', brow: 0,
};

export function pose(p: Partial<Pose>): Pose { return { ...IDLE, ...p }; }

export function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t: number) => t * t * t;
export const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const easeOutBounce = (x: number) => {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

const NUMERIC: (keyof Pose)[] = ['hipY', 'hipX', 'bodyRot', 'torsoLean', 'headTilt', 'headBob', 'lShoulder', 'lElbow', 'rShoulder', 'rElbow', 'lHip', 'lKnee', 'rHip', 'rKnee', 'mouth', 'brow'];

/** Smoothly interpolate two poses. Discrete fields switch at t >= 0.5. */
export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const out: any = { ...(t < 0.5 ? a : b) };
  for (const k of NUMERIC) out[k] = lerp(a[k] as number, b[k] as number, t);
  return out as Pose;
}

/** Combine a lower-body pose with an upper-body pose (used for simultaneous actions, e.g. walking while talking). */
export function layerUpper(base: Pose, upper: Pose, weight = 1): Pose {
  const keys: (keyof Pose)[] = ['lShoulder', 'lElbow', 'rShoulder', 'rElbow', 'headTilt', 'headBob', 'torsoLean', 'mouth', 'brow'];
  const out: any = { ...base };
  for (const k of keys) out[k] = lerp(base[k] as number, upper[k] as number, weight);
  if (weight >= 0.5) {
    out.mouthShape = upper.mouthShape; out.eyes = upper.eyes;
    for (const f of ['blush', 'sweat', 'tears', 'anger', 'question', 'exclaim', 'zzz', 'stars', 'musicNotes'] as const) if (upper[f]) out[f] = upper[f];
  }
  return out as Pose;
}

/** Keyframe sequence: [time 0..1, pose][] → interpolated pose at t */
export function keyframes(frames: [number, Pose][], t: number, ease: (x: number) => number = easeInOut): Pose {
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 0; i < frames.length - 1; i++) {
    const [t0, p0] = frames[i], [t1, p1] = frames[i + 1];
    if (t >= t0 && t <= t1) return blendPose(p0, p1, ease((t - t0) / Math.max(1e-6, t1 - t0)));
  }
  return frames[frames.length - 1][1];
}

// Facial expression presets, applied on top of body poses.
export function expression(e: Emotion | undefined, intensity = 1): Partial<Pose> {
  switch (e) {
    case 'happy': return { mouthShape: 'smile', mouth: 0.2 * intensity, eyes: 'happy', brow: 0.3 };
    case 'sad': return { mouthShape: 'frown', mouth: 0.1, eyes: 'sad', brow: 0.5, tears: intensity > 1.2 };
    case 'angry': return { mouthShape: 'frown', mouth: 0.4 * intensity, eyes: 'angry', brow: -1, anger: true };
    case 'surprised': return { mouthShape: 'o', mouth: 0.9, eyes: 'wide', brow: 1, exclaim: intensity > 0.8 };
    case 'confused': return { mouthShape: 'wavy', mouth: 0.1, eyes: 'squint', brow: 0.4, question: true };
    case 'scared': return { mouthShape: 'o', mouth: 0.7, eyes: 'wide', brow: 0.9, sweat: true };
    case 'smug': return { mouthShape: 'grin', mouth: 0.15, eyes: 'squint', brow: -0.2 };
    case 'embarrassed': return { mouthShape: 'flat', mouth: 0.05, eyes: 'squint', brow: 0.6, blush: true, sweat: true };
    default: return { mouthShape: 'flat', mouth: 0, eyes: 'open', brow: 0 };
  }
}

export function withExpression(p: Pose, e: Emotion | undefined, intensity = 1): Pose { return { ...p, ...expression(e, intensity) }; }

// ───────────────────────────── Forward kinematics ─────────────────────────────

export interface Skeleton {
  hip: [number, number]; neck: [number, number]; head: [number, number]; headR: number;
  lShoulder: [number, number]; lElbow: [number, number]; lHand: [number, number];
  rShoulder: [number, number]; rElbow: [number, number]; rHand: [number, number];
  lKnee: [number, number]; lFoot: [number, number]; rKnee: [number, number]; rFoot: [number, number];
  facing: 1 | -1; height: number; rot: number;
  turn: number;        // -1..1, passes through 0 while the character turns around
}

/** Point (px) the front hand should reach for, with a blend weight 0..1. */
export interface Reach { x: number; y: number; w: number }

type Pt = [number, number];

/**
 * Compute joint positions. (x, groundY) = where the feet rest when standing. height = standing height in px.
 * `facing` may be fractional (-1..1) mid-turn. Feet are kept in contact with the ground, and `reach`
 * pulls the front hand to a target with two-bone IK.
 */
export function solve(ch: Character, p: Pose, x: number, groundY: number, height: number, facing: number, reach?: Reach): Skeleton {
  const pr = ch.proportions;
  const H = height * ch.scale;
  const legLen = (pr.upperLeg + pr.lowerLeg) * H;
  const torso = pr.torso * H;
  const headR = pr.headRadius * H;
  const f: 1 | -1 = facing < 0 ? -1 : 1;

  // hip position (before body rotation)
  const hx = x + p.hipX * H * f;
  const hy = groundY - legLen - p.hipY * H;

  const rot = p.bodyRot * f;
  const R = (px: number, py: number): [number, number] => {
    // rotate point about hip
    const dx = px - hx, dy = py - hy;
    const c = Math.cos(rot), s = Math.sin(rot);
    return [hx + dx * c - dy * s, hy + dx * s + dy * c];
  };

  // torso
  const tl = p.torsoLean * f;
  const neck: [number, number] = [hx + Math.sin(tl) * torso, hy - Math.cos(tl) * torso];
  const ht = tl + p.headTilt * f;
  const headC: [number, number] = [neck[0] + Math.sin(ht) * headR * (1.05 + p.headBob * 0.3), neck[1] - Math.cos(ht) * headR * (1.05 + p.headBob * 0.3)];

  // arms from shoulder (slightly below neck)
  const sh: [number, number] = [neck[0] - Math.sin(tl) * headR * 0.15, neck[1] + Math.cos(tl) * headR * 0.15];
  const limb = (origin: [number, number], a1: number, l1: number, a2: number, l2: number): [[number, number], [number, number]] => {
    const A1 = a1 * f + tl; // arm angle relative to torso
    const e: [number, number] = [origin[0] + Math.sin(A1) * l1, origin[1] + Math.cos(A1) * l1];
    const A2 = A1 + a2 * f;
    const h: [number, number] = [e[0] + Math.sin(A2) * l2, e[1] + Math.cos(A2) * l2];
    return [e, h];
  };
  const [lE, lH] = limb(sh, p.lShoulder, pr.upperArm * H, p.lElbow, pr.lowerArm * H);
  const [rE, rH] = limb(sh, p.rShoulder, pr.upperArm * H, p.rElbow, pr.lowerArm * H);

  const leg = (a1: number, a2: number): [[number, number], [number, number]] => {
    const A1 = a1 * f;
    const k: [number, number] = [hx + Math.sin(A1) * pr.upperLeg * H, hy + Math.cos(A1) * pr.upperLeg * H];
    const A2 = A1 + a2 * f;
    const ft: [number, number] = [k[0] + Math.sin(A2) * pr.lowerLeg * H, k[1] + Math.cos(A2) * pr.lowerLeg * H];
    return [k, ft];
  };
  const [lK, lF] = leg(p.lHip, p.lKnee);
  const [rK, rF] = leg(p.rHip, p.rKnee);

  const sk: Skeleton = {
    hip: [hx, hy], neck: R(...neck), head: R(...headC), headR,
    lShoulder: R(...sh), lElbow: R(...lE), lHand: R(...lH),
    rShoulder: R(...sh), rElbow: R(...rE), rHand: R(...rH),
    lKnee: R(...lK), lFoot: R(...lF), rKnee: R(...rK), rFoot: R(...rF),
    facing: f, height: H, rot, turn: clamp(facing, -1, 1),
  };
  const joints: Pt[] = [sk.hip, sk.neck, sk.head, sk.lShoulder, sk.lElbow, sk.lHand, sk.rShoulder, sk.rElbow, sk.rHand, sk.lKnee, sk.lFoot, sk.rKnee, sk.rFoot];

  // ground contact: feet never sink below the floor, and a planted foot carries the body
  // (released smoothly as the feet leave the ground for a jump)
  const upright = clamp(1 - Math.abs(p.bodyRot) / 0.3, 0, 1);
  if (upright > 0) {
    const gap = groundY - Math.max(sk.lFoot[1], sk.rFoot[1]);
    const dy = (gap < 0 ? gap : gap * clamp((0.2 * H - gap) / (0.12 * H), 0, 1)) * upright;
    for (const j of joints) j[1] += dy;
  }

  // two-bone IK: pull the front hand to the reach target
  if (reach && reach.w > 0) {
    const l1 = pr.upperArm * H, l2 = pr.lowerArm * H, s = sk.lShoulder;
    const dx = reach.x - s[0], dy = reach.y - s[1], d = Math.hypot(dx, dy) || 1;
    const dd = clamp(d, Math.abs(l1 - l2) + 1, l1 + l2 - 0.5);
    const a = Math.atan2(dx, dy);
    const a1 = a - (dx >= 0 ? 1 : -1) * Math.acos(clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1));   // elbow sags down
    const w = clamp(reach.w, 0, 1);
    sk.lElbow[0] = lerp(sk.lElbow[0], s[0] + Math.sin(a1) * l1, w); sk.lElbow[1] = lerp(sk.lElbow[1], s[1] + Math.cos(a1) * l1, w);
    sk.lHand[0] = lerp(sk.lHand[0], s[0] + dx / d * dd, w); sk.lHand[1] = lerp(sk.lHand[1], s[1] + dy / d * dd, w);
  }

  // turning around: the figure narrows toward the hip line as it passes through the front view
  if (Math.abs(sk.turn) < 1) { const k = Math.max(0.12, Math.abs(sk.turn)); for (const j of joints) j[0] = sk.hip[0] + (j[0] - sk.hip[0]) * k; }
  return sk;
}

// ───────────────────────────── Drawing ─────────────────────────────

export function drawStickman(ctx: CanvasRenderingContext2D, ch: Character, p: Pose, sk: Skeleton, opts: { time: number; selected?: boolean; alpha?: number } = { time: 0 }) {
  const lw = ch.lineWidth * (sk.height / 420);
  ctx.save();
  const alpha = ctx.globalAlpha * (opts.alpha ?? 1);   // keep any fade already applied (scene transitions)
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = ch.color; ctx.lineWidth = lw;

  // shadow
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  const gy = Math.max(sk.lFoot[1], sk.rFoot[1]);
  ctx.beginPath(); ctx.ellipse(sk.hip[0], gy + lw, sk.height * 0.16 * (1 - Math.abs(p.hipY) * 0.5), lw * 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  const seg = (a: [number, number], b: [number, number]) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };

  // back limbs first (the "far" side)
  ctx.globalAlpha *= 0.85;
  seg(sk.hip, sk.rKnee); seg(sk.rKnee, sk.rFoot);
  seg(sk.rShoulder, sk.rElbow); seg(sk.rElbow, sk.rHand);
  ctx.globalAlpha = alpha;
  // torso
  seg(sk.hip, sk.neck);
  // front limbs
  seg(sk.hip, sk.lKnee); seg(sk.lKnee, sk.lFoot);
  seg(sk.lShoulder, sk.lElbow); seg(sk.lElbow, sk.lHand);

  // head
  const [hx, hy] = sk.head, r = sk.headR;
  ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2);
  ctx.fillStyle = ch.headColor ?? 'rgba(0,0,0,0)';
  if (ch.headColor) ctx.fill();
  ctx.stroke();

  if (ch.face) drawFace(ctx, ch, p, sk, opts.time);
  drawAccessories(ctx, ch, sk, p);
  drawEffects(ctx, ch, p, sk, opts.time);

  if (opts.selected) {
    ctx.setLineDash([6, 6]); ctx.strokeStyle = '#f5a524'; ctx.lineWidth = 2;
    const top = hy - r - 10, bottom = gy + 10, left = Math.min(sk.lHand[0], sk.rHand[0], sk.lFoot[0], sk.rFoot[0], hx - r) - 10, right = Math.max(sk.lHand[0], sk.rHand[0], sk.lFoot[0], sk.rFoot[0], hx + r) + 10;
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawFace(ctx: CanvasRenderingContext2D, ch: Character, p: Pose, sk: Skeleton, time: number) {
  const [hx, hy] = sk.head, r = sk.headR, f = sk.facing;
  const lw = Math.max(1.2, ch.lineWidth * (sk.height / 420) * 0.55);
  ctx.save();
  ctx.translate(hx, hy); ctx.rotate(sk.rot + (p.torsoLean + p.headTilt) * f);
  ctx.strokeStyle = ch.color; ctx.fillStyle = ch.color; ctx.lineWidth = lw;
  // face positioned toward facing direction (slides across the head mid-turn)
  const ex = sk.turn * r * 0.42, ey = -r * 0.15, eyeGap = r * 0.33;
  const eyes: [number, number][] = [[ex - f * eyeGap * 0.5, ey], [ex + f * eyeGap * 0.55, ey]];
  const blink = (Math.sin(time * 1.7 + ch.id.length) > 0.985);
  for (const [exx, eyy] of eyes) {
    ctx.beginPath();
    const er = r * 0.09;
    switch (p.eyes) {
      case 'closed': ctx.moveTo(exx - er * 1.4, eyy); ctx.lineTo(exx + er * 1.4, eyy); ctx.stroke(); break;
      case 'happy': ctx.arc(exx, eyy + er, er * 1.5, Math.PI, 0); ctx.stroke(); break;
      case 'sad': ctx.arc(exx, eyy - er, er * 1.5, 0, Math.PI); ctx.stroke(); break;
      case 'wide': ctx.arc(exx, eyy, er * 1.9, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(exx, eyy, er * 0.7, 0, Math.PI * 2); ctx.fill(); break;
      case 'squint': ctx.moveTo(exx - er * 1.4, eyy - er * 0.4); ctx.lineTo(exx + er * 1.4, eyy + er * 0.2); ctx.stroke(); break;
      case 'angry': ctx.arc(exx, eyy, er * 1.1, 0, Math.PI * 2); ctx.fill(); break;
      case 'dizzy': { ctx.lineWidth = lw * 0.8; for (let a = 0; a < Math.PI * 4; a += 0.3) { const rr = er * 1.6 * a / (Math.PI * 4); ctx.lineTo(exx + Math.cos(a) * rr, eyy + Math.sin(a) * rr); } ctx.stroke(); break; }
      default: if (blink) { ctx.moveTo(exx - er * 1.3, eyy); ctx.lineTo(exx + er * 1.3, eyy); ctx.stroke(); } else { ctx.arc(exx, eyy, er * 1.1, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  // brows
  if (Math.abs(p.brow) > 0.05 || p.eyes === 'angry') {
    ctx.lineWidth = lw * 1.1;
    for (let i = 0; i < 2; i++) {
      const [exx, eyy] = eyes[i];
      const by = eyy - r * 0.22 - p.brow * r * 0.08;
      const tilt = (p.brow < 0 ? 1 : -0.4) * (i === 0 ? 1 : -1) * f * r * 0.06 * Math.abs(p.brow);
      ctx.beginPath(); ctx.moveTo(exx - r * 0.12, by - tilt); ctx.lineTo(exx + r * 0.12, by + tilt); ctx.stroke();
    }
  }
  // mouth
  const mx = ex * 0.85, my = r * 0.38, mw = r * 0.34;
  ctx.lineWidth = lw;
  ctx.beginPath();
  const open = p.mouth;
  switch (p.mouthShape) {
    case 'smile': ctx.arc(mx, my - mw * 0.2, mw * 0.75, 0.15 * Math.PI, 0.85 * Math.PI); break;
    case 'grin': ctx.arc(mx, my - mw * 0.3, mw * 0.9, 0.05 * Math.PI, 0.95 * Math.PI); break;
    case 'frown': ctx.arc(mx, my + mw * 0.6, mw * 0.7, 1.15 * Math.PI, 1.85 * Math.PI); break;
    case 'o': ctx.ellipse(mx, my, mw * 0.3 + open * mw * 0.2, mw * 0.3 + open * mw * 0.5, 0, 0, Math.PI * 2); break;
    case 'wavy': ctx.moveTo(mx - mw * 0.6, my); ctx.quadraticCurveTo(mx - mw * 0.3, my - mw * 0.4, mx, my); ctx.quadraticCurveTo(mx + mw * 0.3, my + mw * 0.4, mx + mw * 0.6, my); break;
    default: ctx.moveTo(mx - mw * 0.55, my); ctx.lineTo(mx + mw * 0.55, my);
  }
  ctx.stroke();
  if (open > 0.08 && p.mouthShape !== 'o') {
    // talking: open mouth as filled ellipse under the mouth line
    ctx.beginPath(); ctx.ellipse(mx, my + open * mw * 0.35, mw * 0.5, open * mw * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = ch.color; ctx.globalAlpha *= 0.9; ctx.fill();
  }
  if (p.blush) { ctx.fillStyle = 'rgba(255,100,120,0.55)'; ctx.beginPath(); ctx.ellipse(mx - f * r * 0.3, my - r * 0.05, r * 0.16, r * 0.09, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function drawAccessories(ctx: CanvasRenderingContext2D, ch: Character, sk: Skeleton, p: Pose) {
  if (!ch.accessories.length) return;
  const [hx, hy] = sk.head, r = sk.headR, f = sk.facing;
  const lw = ch.lineWidth * (sk.height / 420);
  ctx.save();
  ctx.translate(hx, hy); ctx.rotate(sk.rot + (p.torsoLean + p.headTilt) * f);
  for (const a of ch.accessories as Accessory[]) {
    switch (a) {
      case 'sunglasses': {
        ctx.fillStyle = '#111'; ctx.strokeStyle = '#111'; ctx.lineWidth = lw * 0.5;
        const ey = -r * 0.15, ex = f * r * 0.42;
        ctx.beginPath(); ctx.roundRect(ex - f * r * 0.55 - (f < 0 ? r * 0.44 : 0) , ey - r * 0.16, r * 0.44, r * 0.3, r * 0.08); ctx.fill();
        ctx.beginPath(); ctx.roundRect(ex + f * r * 0.1 - (f < 0 ? r * 0.44 : 0), ey - r * 0.16, r * 0.44, r * 0.3, r * 0.08); ctx.fill();
        ctx.beginPath(); ctx.moveTo(ex - f * r * 0.55, ey); ctx.lineTo(-f * r, ey - r * 0.05); ctx.stroke();
        break;
      }
      case 'glasses': {
        ctx.strokeStyle = ch.color; ctx.lineWidth = lw * 0.45; const ey = -r * 0.15, ex = f * r * 0.42;
        ctx.beginPath(); ctx.arc(ex - f * r * 0.2, ey, r * 0.2, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(ex + f * r * 0.25, ey, r * 0.2, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'hat': ctx.fillStyle = '#2b2b2b'; ctx.fillRect(-r * 1.2, -r * 0.95, r * 2.4, r * 0.18); ctx.fillRect(-r * 0.7, -r * 1.7, r * 1.4, r * 0.8); break;
      case 'cap': ctx.fillStyle = '#d33'; ctx.beginPath(); ctx.arc(0, -r * 0.35, r * 0.95, Math.PI, 0); ctx.fill(); ctx.fillRect(f > 0 ? 0 : -r * 1.6, -r * 0.45, r * 1.6, r * 0.16); break;
      case 'crown': ctx.fillStyle = '#f5c518'; ctx.beginPath(); ctx.moveTo(-r * 0.8, -r * 0.85); ctx.lineTo(-r * 0.8, -r * 1.5); ctx.lineTo(-r * 0.4, -r * 1.15); ctx.lineTo(0, -r * 1.6); ctx.lineTo(r * 0.4, -r * 1.15); ctx.lineTo(r * 0.8, -r * 1.5); ctx.lineTo(r * 0.8, -r * 0.85); ctx.closePath(); ctx.fill(); break;
      case 'bow': ctx.fillStyle = '#ff5fa2'; ctx.beginPath(); ctx.moveTo(-f * r * 0.6, -r * 0.9); ctx.lineTo(-f * r * 1.1, -r * 1.25); ctx.lineTo(-f * r * 1.1, -r * 0.55); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(-f * r * 0.6, -r * 0.9); ctx.lineTo(-f * r * 0.1, -r * 1.25); ctx.lineTo(-f * r * 0.1, -r * 0.55); ctx.closePath(); ctx.fill(); break;
      case 'headphones': ctx.strokeStyle = '#333'; ctx.lineWidth = lw * 0.9; ctx.beginPath(); ctx.arc(0, 0, r * 1.1, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(-r * 1.02, r * 0.05, r * 0.28, 0, Math.PI * 2); ctx.arc(r * 1.02, r * 0.05, r * 0.28, 0, Math.PI * 2); ctx.fill(); break;
      case 'scarf': case 'tie': {
        ctx.restore(); ctx.save();
        const [nx, ny] = sk.neck;
        ctx.fillStyle = a === 'tie' ? '#c0392b' : '#2e86de';
        if (a === 'tie') { ctx.beginPath(); ctx.moveTo(nx, ny + r * 0.2); ctx.lineTo(nx - r * 0.2, ny + r * 0.5); ctx.lineTo(nx, ny + r * 1.6); ctx.lineTo(nx + r * 0.2, ny + r * 0.5); ctx.closePath(); ctx.fill(); }
        else { ctx.lineWidth = lw * 1.6; ctx.strokeStyle = '#2e86de'; ctx.beginPath(); ctx.moveTo(nx - r * 0.6, ny + r * 0.1); ctx.lineTo(nx + r * 0.6, ny + r * 0.1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(nx - f * r * 0.3, ny + r * 0.1); ctx.lineTo(nx - f * r * 0.5, ny + r * 1.1); ctx.stroke(); }
        ctx.restore(); ctx.save(); ctx.translate(hx, hy); ctx.rotate(sk.rot + (p.torsoLean + p.headTilt) * f);
        break;
      }
    }
  }
  ctx.restore();
}

function drawEffects(ctx: CanvasRenderingContext2D, ch: Character, p: Pose, sk: Skeleton, time: number) {
  const [hx, hy] = sk.head, r = sk.headR, f = sk.facing;
  const fs = r * 1.1;
  ctx.save();
  ctx.font = `bold ${fs}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const bob = Math.sin(time * 4) * r * 0.1;
  if (p.question) { ctx.fillStyle = '#5aa9ff'; ctx.fillText('?', hx + f * r * 0.9, hy - r * 1.7 + bob); }
  if (p.exclaim) { ctx.fillStyle = '#ff6b6b'; ctx.fillText('!', hx + f * r * 0.9, hy - r * 1.7 - bob); }
  if (p.zzz) { ctx.fillStyle = '#aab1c9'; ctx.fillText('z', hx + r * 1.2, hy - r * 1.2 + bob); ctx.font = `bold ${fs * 0.7}px Inter`; ctx.fillText('z', hx + r * 1.7, hy - r * 1.8 - bob); }
  if (p.musicNotes) { ctx.fillStyle = '#c084fc'; ctx.fillText('♪', hx - r * 1.4, hy - r * 1.3 + bob); ctx.fillText('♫', hx + r * 1.5, hy - r * 1.6 - bob); }
  if (p.anger) {
    ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = Math.max(2, r * 0.1); const ax = hx - f * r * 0.9, ay = hy - r * 0.9;
    ctx.beginPath(); ctx.moveTo(ax - r * 0.25, ay); ctx.lineTo(ax + r * 0.25, ay); ctx.moveTo(ax, ay - r * 0.25); ctx.lineTo(ax, ay + r * 0.25); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ax - r * 0.18, ay - r * 0.18); ctx.lineTo(ax + r * 0.18, ay + r * 0.18); ctx.moveTo(ax + r * 0.18, ay - r * 0.18); ctx.lineTo(ax - r * 0.18, ay + r * 0.18); ctx.stroke();
  }
  if (p.sweat) { ctx.fillStyle = '#5ad1ff'; const sx = hx - f * r * 0.85, sy = hy - r * 0.5 + (time * 40) % (r * 0.6); ctx.beginPath(); ctx.moveTo(sx, sy - r * 0.2); ctx.quadraticCurveTo(sx + r * 0.15, sy + r * 0.1, sx, sy + r * 0.15); ctx.quadraticCurveTo(sx - r * 0.15, sy + r * 0.1, sx, sy - r * 0.2); ctx.fill(); }
  if (p.tears) { ctx.fillStyle = '#5ad1ff'; for (let i = 0; i < 2; i++) { const tx = hx + f * r * (0.25 + i * 0.35), ty = hy + r * 0.05 + ((time * 60 + i * 20) % (r * 0.9)); ctx.beginPath(); ctx.arc(tx, ty, r * 0.07, 0, Math.PI * 2); ctx.fill(); } }
  if (p.stars) { ctx.fillStyle = '#f5c518'; for (let i = 0; i < 3; i++) { const a = time * 3 + i * 2.1; ctx.fillText('★', hx + Math.cos(a) * r * 1.3, hy - r * 1.3 + Math.sin(a) * r * 0.3); } }
  ctx.restore();
}
