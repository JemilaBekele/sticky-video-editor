// ───────────────────────────── Scene solver ─────────────────────────────
// Pure functions: (scene, time) → fully resolved state. No internal clock, so the same time
// always produces the same frame, which is what makes scrubbing and offline rendering consistent.

import type { Scene, Character, ActionClip, Emotion, DialogueLine, SceneProp, Project, SfxName } from '../types';
import { ASPECT_SIZES } from '../types';
import { ACTION_DEFS, REST_POSES, FIGHT_IMPACTS, RECOIL, fightStrike, rampIn, type ActionDef } from './actions';
import { layerUpper, withExpression, blendPose, easeInOut, easeOut, clamp, lerp, type Pose } from './rig';
import { HANDHELD, PROP_REL_SIZE } from './props';

export interface CharState {
  character: Character;
  x: number;             // 0..1 stage
  facing: 1 | -1;
  turn: number;          // facing eased through 0 while turning around
  reach?: ReachTarget;   // what the front hand is reaching for
  pose: Pose;
  visible: boolean;
  emotion?: Emotion;
  carrying?: string;     // prop id
  speaking?: DialogueLine;
  grounded: 'standing' | 'lying' | 'sitting';
}

/** Hand target in scene units: x across the stage, height above the floor as body heights + stage heights. */
export interface ReachTarget { x: number; body: number; stage: number; w: number }

export interface CameraState { zoom: number; cx: number; cy: number; shakeX: number; shakeY: number }

export interface SceneState {
  t: number;
  chars: CharState[];
  props: (SceneProp & { heldBy?: string })[];
  camera: CameraState;
  dialogue: DialogueLine[];      // active lines
  transitionProgress: number;    // 0..1 during transitionIn, 1 after
}

const OFFSTAGE_L = -0.18, OFFSTAGE_R = 1.18;
const STOP_DISTANCE = 0.13;
const PERSONAL_SPACE = 0.08;
const KNOCKBACK = 0.018;
const TURN_TIME = 0.22;

function charById(project: Project, id: string) { return project.characters.find(c => c.id === id); }
/**
 * A character's clips in time order. Someone who starts the scene asleep or seated gets a sleep / sit
 * that finished before the scene began, so every rule about resting states applies from frame one.
 */
// ── per-scene caches ──
// Scenes are never mutated (every edit creates a new scene object), so results can be cached per scene
// object. Positions and facing are queried many times per frame by other characters' moves and turns;
// without caching a busy scene costs tens of milliseconds per frame.
const caches = new WeakMap<Scene, Map<string, unknown>>();
function cached<T>(scene: Scene, key: string, compute: () => T): T {
  let m = caches.get(scene);
  if (!m) { m = new Map(); caches.set(scene, m); }
  if (m.has(key)) return m.get(key) as T;
  if (m.size > 50000) m.clear();   // scrubbing a long scene: keep memory bounded
  const v = compute(); m.set(key, v);
  return v;
}

function ownClips(scene: Scene, id: string): ActionClip[] { return cached(scene, `clips|${id}`, () => computeOwnClips(scene, id)); }
function computeOwnClips(scene: Scene, id: string): ActionClip[] {
  const clips = scene.actions.filter(a => a.characterId === id).sort((a, b) => a.start - b.start);
  const startsAs = scene.characters.find(c => c.characterId === id)?.startsAs;
  return startsAs ? [{ id: `${id}_start`, characterId: id, action: startsAs === 'lying' ? 'sleep' : 'sit', start: -10, duration: 1 }, ...clips] : clips;
}
function activeAt(c: ActionClip, t: number) { return c.start <= t && t < c.start + c.duration; }

/** Standing height of a character as a fraction of the stage width (same framing as the renderer). */
function bodyWidth(project: Project, ch?: Character) {
  const { w, h } = ASPECT_SIZES[project.settings?.aspect ?? 'landscape'];
  return (Math.min(h * 0.46, w * 0.62) / w) * (ch?.scale ?? 1);
}

/** A chair the character at x is on (or about to sit on). */
function chairAt(scene: Scene, x: number) { return scene.props.find(p => p.type === 'chair' && Math.abs(p.x - x) < 0.07); }

function clipParams(clip: ActionClip) { return { intensity: clip.intensity ?? 1, speed: clip.speed ?? 1, emotion: clip.emotion }; }

/** Where a clip is heading. Returns undefined for non-moving clips. */
function clipTarget(scene: Scene, project: Project, clip: ActionClip, t: number, from: number, depth: number): number | undefined {
  const def = ACTION_DEFS[clip.action];
  if (!def?.locomotion) return undefined;
  if (clip.action === 'exit') return clip.toX ?? (from < 0.5 ? OFFSTAGE_L : OFFSTAGE_R);
  if (clip.targetId) {
    const otherScene = scene.characters.find(c => c.characterId === clip.targetId);
    if (otherScene) {
      const ox = depth < 1 ? solvePosition(scene, project, clip.targetId, t, depth + 1).x : otherScene.x;
      return ox + (from < ox ? -STOP_DISTANCE : STOP_DISTANCE);
    }
    const prop = scene.props.find(p => p.id === clip.targetId);
    if (prop) return prop.x + (from < prop.x ? -0.08 : 0.08);
  }
  // default: move a bit in the facing direction
  let target = clip.toX ?? clamp(from + (clip.action === 'run' ? 0.35 : 0.25) * (from < 0.5 ? 1 : -1), 0.08, 0.92);
  // do not stop on top of someone: aim beside where they will be when this move ends
  for (const o of scene.characters) {
    if (o.characterId === clip.characterId || !o.visible) continue;
    const ox = depth < 1 ? solvePosition(scene, project, o.characterId, clip.start + clip.duration, depth + 1).x : o.x;
    if (Math.abs(target - ox) < PERSONAL_SPACE) target = ox + (from < ox ? -PERSONAL_SPACE : PERSONAL_SPACE);
  }
  return target;
}

/** Resolve stage x and facing for a character at time t. */
export function solvePosition(scene: Scene, project: Project, characterId: string, t: number, depth = 0): { x: number; facing: 1 | -1 } {
  return cached(scene, `pos|${characterId}|${t}|${depth}`, () => computePosition(scene, project, characterId, t, depth));
}
function computePosition(scene: Scene, project: Project, characterId: string, t: number, depth: number): { x: number; facing: 1 | -1 } {
  const sc = scene.characters.find(c => c.characterId === characterId);
  if (!sc) return { x: 0.5, facing: 1 };
  let x = sc.x; let facing: 1 | -1 = sc.facing;
  // own clips and the punches landing on this character, in time order
  const events: { at: number; clip?: ActionClip; by?: string }[] = ownClips(scene, characterId).map(c => ({ at: c.start, clip: c }));
  for (const a of scene.actions) if (a.action === 'fight' && a.targetId === characterId) for (const k of FIGHT_IMPACTS) events.push({ at: a.start + a.duration * k, by: a.characterId });
  events.sort((a, b) => a.at - b.at);
  for (const ev of events) {
    if (ev.at > t) break;
    if (ev.by) { // knocked back a little by each hit
      const ax = depth < 1 ? solvePosition(scene, project, ev.by, ev.at, depth + 1).x : scene.characters.find(c => c.characterId === ev.by)?.x ?? x;
      x += (x >= ax ? 1 : -1) * KNOCKBACK * easeOut(clamp((t - ev.at) / 0.2, 0, 1));
      continue;
    }
    let clip = ev.clip!;
    const def = ACTION_DEFS[clip.action];
    const prog = clamp((t - clip.start) / Math.max(0.01, clip.duration), 0, 1);
    if (def?.locomotion) {
      let from = x;
      if (clip.action === 'enter') { from = clip.facing === -1 ? OFFSTAGE_R : (sc.x < 0.5 ? OFFSTAGE_L : OFFSTAGE_R); if (clip.toX === undefined && !clip.targetId) clip = { ...clip, toX: sc.x }; }
      // a finished move stays where it ended, even if the one it walked up to moves on later
      const target = clipTarget(scene, project, clip, Math.min(t, clip.start + clip.duration), from, depth);
      if (target !== undefined) {
        const ease = clip.action === 'run' || clip.action === 'chase' ? (v: number) => v : easeInOut;
        if (Math.abs(target - from) > 0.002) facing = target > from ? 1 : -1;
        x = lerp(from, target, ease(prog));
      }
    } else if (clip.action === 'turn') {
      if (prog >= 0.5) facing = (clip.facing ?? (facing === 1 ? -1 : 1)) as 1 | -1;
    } else if (clip.targetId && ['point', 'look', 'talk', 'angry', 'shake_hands', 'fight', 'wave', 'laugh', 'surprised'].includes(clip.action)) {
      const ot = scene.characters.find(c => c.characterId === clip.targetId);
      const ox = ot ? (depth < 1 ? solvePosition(scene, project, clip.targetId, t, depth + 1).x : ot.x) : scene.props.find(p => p.id === clip.targetId)?.x;
      if (ox !== undefined && Math.abs(ox - x) > 0.01) facing = ox > x ? 1 : -1;
    } else if ((clip.action === 'pickup' || clip.action === 'open_door') && (clip.propId ?? clip.targetId)) {
      const px = scene.props.find(p => p.id === (clip.propId ?? clip.targetId))?.x;
      if (px !== undefined && Math.abs(px - x) > 0.01) facing = px > x ? 1 : -1;
    } else if (clip.facing) facing = clip.facing;
  }
  return { x: clamp(x, OFFSTAGE_L, OFFSTAGE_R), facing };
}

/**
 * Where a character looks. Their own moves decide first; otherwise an idle character turns toward
 * whoever last spoke or last did something to them.
 */
function attentiveFacing(scene: Scene, project: Project, id: string, t: number): 1 | -1 {
  return cached(scene, `face|${id}|${t}`, () => computeFacing(scene, project, id, t));
}
function computeFacing(scene: Scene, project: Project, id: string, t: number): 1 | -1 {
  const own = solvePosition(scene, project, id, t);
  const clips = ownClips(scene, id);
  if (groundedState(clips, t) === 'lying') return own.facing;
  let ownAt = 0;
  for (const c of clips) {
    if (c.start > t) break;
    if (ACTION_DEFS[c.action]?.locomotion) ownAt = Math.max(ownAt, Math.min(t, c.start + c.duration));
    else if (c.action === 'turn' || c.targetId || c.propId || c.facing) ownAt = Math.max(ownAt, c.start);
  }
  let focus: string | undefined, focusAt = -1;
  for (const d of scene.dialogue) if (d.characterId !== id && d.characterId !== 'narrator' && d.start <= t && d.start > focusAt) { focus = d.characterId; focusAt = d.start; }
  for (const c of scene.actions) if (c.targetId === id && c.characterId !== id && c.start <= t && c.start > focusAt) { focus = c.characterId; focusAt = c.start; }
  if (!focus || focusAt <= ownAt || !scene.characters.some(c => c.characterId === focus)) return own.facing;
  const fx = solvePosition(scene, project, focus, t).x;
  return Math.abs(fx - own.x) > 0.02 ? (fx > own.x ? 1 : -1) : own.facing;
}

/** Facing as a continuous value: a change of direction is eased through 0 over TURN_TIME instead of flipping. */
function solveTurn(scene: Scene, project: Project, id: string, t: number): { facing: 1 | -1; turn: number } {
  const facing = attentiveFacing(scene, project, id, t);
  const STEP = 0.03;
  for (let back = STEP; back < TURN_TIME + STEP && t - back >= 0; back += STEP) {
    if (attentiveFacing(scene, project, id, t - back) === facing) continue;
    // the flip happened between t-back and t-back+STEP: narrow it down
    let lo = t - back, hi = lo + STEP;
    for (let i = 0; i < 4; i++) { const mid = (lo + hi) / 2; if (attentiveFacing(scene, project, id, mid) === facing) hi = mid; else lo = mid; }
    return { facing, turn: facing * (easeInOut(clamp((t - hi) / TURN_TIME, 0, 1)) * 2 - 1) };
  }
  return { facing, turn: facing };
}

/** How hard a character is being hit right now (0..1), from punches thrown at them. */
function hitAmount(scene: Scene, id: string, t: number) {
  let w = 0;
  for (const a of scene.actions) if (a.action === 'fight' && a.targetId === id) for (const k of FIGHT_IMPACTS) { const d = t - (a.start + a.duration * k); if (d >= 0 && d < 0.4) w = Math.max(w, d < 0.05 ? d / 0.05 : 1 - (d - 0.05) / 0.35); }
  return w;
}

function groundedState(clips: ActionClip[], t: number): 'standing' | 'lying' | 'sitting' {
  let st: 'standing' | 'lying' | 'sitting' = 'standing';
  for (const c of clips) {
    const def = ACTION_DEFS[c.action];
    if (c.start + c.duration * 0.6 <= t && def?.leaves) st = def.leaves;
    else if (c.start <= t && def?.locomotion) st = 'standing';
  }
  return st;
}

function currentEmotion(scene: Scene, clips: ActionClip[], characterId: string, t: number): Emotion | undefined {
  const sc = scene.characters.find(c => c.characterId === characterId);
  let e: Emotion | undefined = sc?.initialEmotion;
  // clip emotions and dialogue tones both set the mood; the most recent one wins
  let at = -Infinity;
  for (const c of clips) if (c.start <= t && c.emotion && c.start >= at) { e = c.emotion; at = c.start; }
  for (const d of scene.dialogue) if (d.characterId === characterId && d.start <= t && d.tone && d.start >= at) { e = d.tone; at = d.start; }
  return e;
}

function mouthFor(line: DialogueLine, t: number): number {
  const rel = t - line.start;
  if (rel < 0 || rel > line.duration - 0.15) return 0;
  // Deterministic pseudo-syllable pattern from text
  const i = Math.floor(rel * 9);
  const ch = line.text.charCodeAt(i % Math.max(1, line.text.length)) || 32;
  if (ch === 32 || ch === 44 || ch === 46) return 0.05;
  const vowel = /[aeiouAEIOU]/.test(String.fromCharCode(ch));
  return (vowel ? 0.85 : 0.4) * (0.7 + 0.3 * Math.abs(Math.sin(rel * 23)));
}

export function solvePose(scene: Scene, project: Project, characterId: string, t: number, allowRamp = true): Pose {
  const clips = ownClips(scene, characterId);
  const emotion = currentEmotion(scene, clips, characterId, t);
  const grounded = groundedState(clips, t);
  const active = clips.filter(c => activeAt(c, t));
  const full = active.filter(c => ACTION_DEFS[c.action]?.mask === 'full').pop();
  // a handshake offered to this character is returned
  const upper = active.filter(c => ACTION_DEFS[c.action]?.mask === 'upper').pop()
    ?? (full ? undefined : scene.actions.find(a => a.action === 'shake_hands' && a.targetId === characterId && activeAt(a, t)));
  const here = () => solvePosition(scene, project, characterId, t).x;
  const seat = grounded === 'sitting' || full?.action === 'sit' || full?.action === 'getup' ? !!chairAt(scene, here()) : false;

  let base: Pose;
  if (full) {
    const def = ACTION_DEFS[full.action];
    const rel = t - full.start;
    const params = { ...clipParams(full), emotion: full.emotion ?? emotion, seat, from: groundedState(clips, full.start - 0.001) };
    if (def.locomotion) { // legs follow the ground actually covered
      const ch = charById(project, characterId), DT = 0.04, x = here();
      const bw = bodyWidth(project, ch) * ((ch ? ch.proportions.upperLeg + ch.proportions.lowerLeg : 0.4) / 0.4);   // gaits assume a 0.4 leg
      Object.assign(params, { travel: Math.abs(x - solvePosition(scene, project, characterId, full.start).x) / bw, pace: Math.abs(x - solvePosition(scene, project, characterId, Math.max(full.start, t - DT)).x) / DT / bw });
    }
    base = def.fn(clamp(rel / full.duration, 0, 1), rel, params);
    if (allowRamp && rel < 0.18) base = rampIn(solvePose(scene, project, characterId, full.start - 0.001, false), base, rel);
  } else {
    // someone who went to sleep stays asleep, not knocked out
    const asleep = grounded === 'lying' && clips.filter(c => ACTION_DEFS[c.action]?.leaves && c.start <= t).pop()?.action === 'sleep';
    base = REST_POSES[grounded](t, emotion, seat, asleep);
    if (allowRamp) {
      // ramp out of the last full-body clip
      const last = clips.filter(c => ACTION_DEFS[c.action]?.mask === 'full' && c.start + c.duration <= t).pop();
      if (last && t - (last.start + last.duration) < 0.25 && !ACTION_DEFS[last.action].leaves) {
        base = rampIn(solvePose(scene, project, characterId, last.start + last.duration - 0.001, false), base, t - (last.start + last.duration), 0.25);
      }
    }
  }
  if (grounded === 'lying' && !full) return base;

  let result = base;
  if (upper) {
    const def = ACTION_DEFS[upper.action];
    const rel = t - upper.start;
    let up = def.fn(clamp(rel / upper.duration, 0, 1), rel, { ...clipParams(upper), emotion: upper.emotion ?? emotion });
    const w = clamp(rel / 0.15, 0, 1) * clamp((upper.duration - rel) / 0.2, 0, 1);
    result = layerUpper(base, up, easeOut(w));
  } else if (!full && emotion) {
    result = withExpression(base, emotion);
  }

  // thrown back by a punch
  const hit = grounded === 'lying' ? 0 : hitAmount(scene, characterId, t);
  if (hit > 0) result = blendPose(result, RECOIL, easeOut(hit));

  // speaking → mouth sync and a light talking gesture if idle
  const line = scene.dialogue.find(d => d.characterId === characterId && d.start <= t && t < d.start + d.duration);
  if (line) {
    if (!upper && (!full || ACTION_DEFS[full.action].locomotion)) {
      const talk = ACTION_DEFS.talk.fn(0, t - line.start, { intensity: 1, speed: 1, emotion: line.tone ?? emotion });
      result = layerUpper(result, talk, 0.6);
    }
    result = { ...result, mouth: Math.max(result.mouth * 0.3, mouthFor(line, t)) };
    if (result.mouthShape === 'flat' || result.mouthShape === 'o') result.mouthShape = line.tone === 'happy' ? 'smile' : line.tone === 'angry' || line.tone === 'sad' ? 'frown' : 'flat';
  }
  return result;
}

/** What the front hand reaches for: a partner's hand, a prop on the floor, or the thing being pointed at. */
function solveReach(scene: Scene, project: Project, id: string, t: number, x: number): ReachTarget | undefined {
  const fade = (c: ActionClip, inAt: number, inEnd: number, outAt: number, outEnd: number) => { const p = (t - c.start) / c.duration; return easeInOut(clamp((p - inAt) / (inEnd - inAt), 0, 1)) * (1 - easeInOut(clamp((p - outAt) / (outEnd - outAt), 0, 1))); };
  const headHeight = (cid: string) => ({ standing: 0.86, sitting: 0.55, lying: 0.08 })[groundedState(ownClips(scene, cid), t)] * (charById(project, cid)?.scale ?? 1);
  for (const c of scene.actions) {
    if (!activeAt(c, t)) continue;
    const mine = c.characterId === id;
    if (c.action === 'shake_hands' && c.targetId && (mine || c.targetId === id)) {
      const other = mine ? c.targetId : c.characterId;
      if (!scene.characters.some(s => s.characterId === other)) continue;
      const ox = solvePosition(scene, project, other, t).x, p = (t - c.start) / c.duration;
      return { x: (x + ox) / 2, body: 0.5 + (p > 0.3 && p < 0.88 ? Math.sin((t - c.start) * 9) * 0.02 : 0), stage: 0, w: fade(c, 0.12, 0.3, 0.88, 1) };
    }
    if (!mine) continue;
    // punches are thrown at the opponent's head
    if (c.action === 'fight' && c.targetId && scene.characters.some(s => s.characterId === c.targetId)) return { x: solvePosition(scene, project, c.targetId, t).x, body: headHeight(c.targetId) * 0.92, stage: 0, w: fightStrike((t - c.start) / c.duration).front ** 2 };
    const prop = scene.props.find(p => p.id === (c.propId ?? c.targetId));
    if (c.action === 'pickup' && prop) return { x: prop.x, body: PROP_REL_SIZE[prop.type] * prop.scale * 0.3, stage: prop.y, w: fade(c, 0.15, 0.4, 0.5, 0.7) };
    if (c.action === 'point' && c.targetId) {
      if (prop) return { x: prop.x, body: PROP_REL_SIZE[prop.type] * prop.scale * 0.6, stage: prop.y, w: fade(c, 0, 0.2, 0.9, 1) };
      if (scene.characters.some(s => s.characterId === c.targetId)) return { x: solvePosition(scene, project, c.targetId, t).x, body: headHeight(c.targetId), stage: 0, w: fade(c, 0, 0.2, 0.9, 1) };
    }
  }
  return undefined;
}

function carriedProp(scene: Scene, characterId: string, t: number): string | undefined {
  let carrying: string | undefined;
  for (const c of scene.actions.filter(a => a.characterId === characterId).sort((a, b) => a.start - b.start)) {
    if (c.start > t) break;
    if (c.action === 'pickup' && (c.propId || c.targetId) && t >= c.start + c.duration * 0.55) {
      const id = c.propId ?? c.targetId!;
      const p = scene.props.find(p => p.id === id);
      if (p && HANDHELD.includes(p.type)) carrying = id;
    }
    if ((c.action === 'fall' || c.action === 'slip') && t >= c.start + c.duration * 0.6) carrying = undefined;
  }
  return carrying;
}

export function solveCamera(scene: Scene, project: Project, t: number, chars: CharState[]): CameraState {
  const cam = scene.camera;
  const shotZoom = { wide: 1, medium: 1.35, closeup: 1.9 }[cam.shot];
  let zoom = shotZoom;
  const focus = chars.find(c => c.character.id === cam.focusCharacterId) ?? chars.find(c => c.visible);
  let cx = 0.5;
  let cy = cam.shot === 'closeup' ? 0.42 : cam.shot === 'medium' ? 0.5 : 0.55;
  const startAt = cam.startAt ?? 0, intensity = cam.intensity ?? 1;
  const prog = clamp((t - startAt) / Math.max(0.3, Math.min(2.5, scene.duration - startAt)), 0, 1);
  switch (cam.move) {
    case 'zoom_in': zoom = lerp(shotZoom, shotZoom * (1 + 0.5 * intensity), easeInOut(prog)); if (focus) cx = lerp(0.5, focus.x, easeInOut(prog)); break;
    case 'zoom_out': zoom = lerp(shotZoom * (1 + 0.5 * intensity), shotZoom, easeInOut(prog)); break;
    case 'pan_left': zoom = Math.max(zoom, 1.25); cx = lerp(0.62, 0.38, easeInOut(t / scene.duration)); break;
    case 'pan_right': zoom = Math.max(zoom, 1.25); cx = lerp(0.38, 0.62, easeInOut(t / scene.duration)); break;
    case 'track': zoom = Math.max(zoom, 1.2); if (focus) cx = focus.x; break;
  }
  if (cam.shot !== 'wide' && cam.move === 'static' && focus) cx = focus.x;
  // keep the camera from showing beyond the stage edges
  const half = 0.5 / zoom;
  cx = clamp(cx, half, 1 - half);
  cy = clamp(cy, half, 1 - half);
  // impact shake
  let shakeX = 0, shakeY = 0;
  for (const c of scene.actions) {
    const def: ActionDef | undefined = ACTION_DEFS[c.action];
    if (def?.cameraHint !== 'shake') continue;
    for (const k of c.action === 'fight' ? FIGHT_IMPACTS : [0.62]) {
      const d = t - (c.start + c.duration * k);
      if (d >= 0 && d < 0.4) { const a = (1 - d / 0.4) * 0.012; shakeX += Math.sin(d * 90) * a; shakeY += Math.cos(d * 70) * a; }
    }
  }
  return { zoom, cx, cy, shakeX, shakeY };
}

export function solveScene(scene: Scene, project: Project, t: number): SceneState {
  const chars: CharState[] = [];
  for (const sc of scene.characters) {
    const ch = charById(project, sc.characterId);
    if (!ch) continue;
    const clips = ownClips(scene, sc.characterId);
    const { x } = solvePosition(scene, project, sc.characterId, t);
    const { facing, turn } = solveTurn(scene, project, sc.characterId, t);
    const pose = solvePose(scene, project, sc.characterId, t);
    const grounded = groundedState(clips, t);
    // walk every enter / exit in order: someone can leave and come back
    const moves = clips.filter(c => c.action === 'enter' || c.action === 'exit');
    let visible = sc.visible && moves[0]?.action !== 'enter';
    for (const m of moves) {
      if (m.start > t) break;
      visible = m.action === 'enter' || t <= m.start + m.duration;
    }
    if (x < -0.12 || x > 1.12) visible = visible && moves.length > 0;
    chars.push({ character: ch, x, facing, turn, reach: solveReach(scene, project, sc.characterId, t, x), pose, visible, emotion: currentEmotion(scene, clips, sc.characterId, t), carrying: carriedProp(scene, sc.characterId, t), speaking: scene.dialogue.find(d => d.characterId === sc.characterId && d.start <= t && t < d.start + d.duration), grounded });
  }
  const props = scene.props.map(p => ({ ...p, heldBy: chars.find(c => c.carrying === p.id)?.character.id }));
  const camera = solveCamera(scene, project, t, chars);
  const dialogue = scene.dialogue.filter(d => d.start <= t && t < d.start + d.duration);
  const trDur = scene.transitionIn === 'cut' ? 0 : 0.5;
  return { t, chars, props, camera, dialogue, transitionProgress: trDur ? clamp(t / trDur, 0, 1) : 1 };
}

/** All sound-effect events in a project with absolute times (explicit cues + action-implied ones). */
export function collectSfx(project: Project): { name: SfxName; at: number; volume: number }[] {
  const out: { name: SfxName; at: number; volume: number }[] = [];
  let offset = 0;
  for (const s of project.scenes) {
    // sounds belong to their scene: a clip that overruns the scene must not play over the next one
    const inScene = (at: number) => at <= s.duration;
    for (const c of s.sfx) if (inScene(c.start)) out.push({ name: c.name, at: offset + c.start, volume: c.volume });
    for (const a of s.actions) {
      const def = ACTION_DEFS[a.action];
      for (const h of def?.sfx ?? []) {
        if (def.locomotion) { for (let k = 0; k < a.duration && inScene(a.start + k); k += a.action === 'run' || a.action === 'chase' ? 0.28 : 0.46) out.push({ name: 'footsteps', at: offset + a.start + k, volume: 0.4 }); }
        else if (inScene(a.start + h.at * a.duration)) out.push({ name: h.name as SfxName, at: offset + a.start + h.at * a.duration, volume: 0.8 });
      }
    }
    offset += s.duration;
  }
  return out.sort((a, b) => a.at - b.at);
}
