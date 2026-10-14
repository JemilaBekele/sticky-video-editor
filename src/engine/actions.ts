// ───────────────────────────── Action library ─────────────────────────────
// Each action maps (normalized time, seconds elapsed, params) → Pose.
// `mask` tells the scene solver whether this action owns the whole body or only the upper body,
// which makes simultaneous actions (walk + talk, run + point) possible.

import type { ActionName, Emotion } from '../types';
import { IDLE, pose, keyframes, blendPose, easeInOut, easeOut, easeIn, easeOutBounce, clamp, withExpression, type Pose } from './rig';

export interface ActionParams {
  intensity: number; speed: number; emotion?: Emotion;
  /** locomotion: distance covered so far and current pace, in body heights (per second). Omitted in previews. */
  travel?: number; pace?: number;
  /** sitting: true when there is a chair under the character */
  seat?: boolean;
  /** resting state the character was in when the action started */
  from?: 'standing' | 'lying' | 'sitting';
}
export interface ActionDef {
  mask: 'full' | 'upper';
  /** does this action move the character across the stage? */
  locomotion?: boolean;
  /** resting state the character is left in after the action ends */
  leaves?: 'standing' | 'lying' | 'sitting';
  /** generate the pose */
  fn: (t: number, sec: number, p: ActionParams) => Pose;
  sfx?: { name: string; at: number }[];
  cameraHint?: 'zoom_in' | 'track' | 'shake';
}

const TWO_PI = Math.PI * 2;
/** Moments (fraction of the clip) at which a fight lands its hits. Sound, camera shake and the target's recoil all use these. */
export const FIGHT_IMPACTS = [0.25, 0.55, 0.85];
/** How far each fist is thrown (0..1) at clip progress t: wind up before each impact, snap out on it, recover after. */
export const fightStrike = (t: number) => {
  const hit = (i: number) => { const d = (t - FIGHT_IMPACTS[i]) / 0.09; return d < 0 ? clamp(1 + d / 1.4, 0, 1) ** 3 : clamp(1 - d / 1.6, 0, 1); };
  return { front: Math.max(hit(0), hit(2)), back: hit(1) };
};
const sin = Math.sin, cos = Math.cos;

const breathe = (sec: number, amp = 1): Partial<Pose> => ({ headBob: sin(sec * 2.2) * 0.08 * amp, torsoLean: sin(sec * 2.2) * 0.012 * amp, hipY: sin(sec * 2.2) * 0.004 * amp });

export const STAND = (sec: number, e?: Emotion) => withExpression(pose({ ...IDLE, ...breathe(sec) }), e);

/**
 * One leg of a step cycle. For the first `duty` of the cycle the foot is on the ground and travels back
 * at a constant speed, which cancels the body's forward motion so the foot stays put; then the leg
 * swings forward with the knee bent. `reach` = how far the thigh swings (radians).
 */
const stepLeg = (phase: number, reach: number, duty: number, lift: number) => {
  const c = (((phase / TWO_PI) % 1) + 1) % 1;
  if (c < duty) return { hip: Math.asin(sin(reach) * (1 - (2 * c) / duty)), knee: 0 };
  const u = (c - duty) / (1 - duty);
  return { hip: Math.asin(-sin(reach) * cos(Math.PI * u)), knee: -lift * sin(Math.PI * Math.pow(u, 0.8)) };
};
/** Body heights covered by one full step cycle (for a leg 0.4 body heights long). */
const strideLength = (reach: number, duty: number) => (0.8 * sin(reach)) / duty;

const WALK_REACH = 0.55, RUN_REACH = 0.95, RUN_DUTY = 0.36;

const walkCycle = (phase: number, amp: number): Pose => {
  const l = stepLeg(phase, WALK_REACH * amp, 0.5, 0.9 * amp), r = stepLeg(phase + Math.PI, WALK_REACH * amp, 0.5, 0.9 * amp), swing = cos(phase);
  return pose({ lHip: l.hip, lKnee: l.knee, rHip: r.hip, rKnee: r.knee, lShoulder: -swing * 0.5 * amp, lElbow: 0.5 * amp, rShoulder: swing * 0.5 * amp, rElbow: 0.5 * amp, torsoLean: 0.08 * amp, headTilt: -0.04 });
};

const runCycle = (phase: number, amp: number): Pose => {
  const reach = Math.min(1.3, RUN_REACH * amp);
  const l = stepLeg(phase, reach, RUN_DUTY, 1.7), r = stepLeg(phase + Math.PI, reach, RUN_DUTY, 1.7), swing = cos(phase);
  // both feet are off the ground between strides
  const c = (((phase / Math.PI) % 1) + 1) % 1, flight = c > RUN_DUTY * 2 ? sin((Math.PI * (c - RUN_DUTY * 2)) / (1 - RUN_DUTY * 2)) : 0;
  return pose({ lHip: l.hip, lKnee: l.knee, rHip: r.hip, rKnee: r.knee, lShoulder: -swing * 0.9 * amp, lElbow: 1.5, rShoulder: swing * 0.9 * amp, rElbow: 1.5, hipY: flight * 0.1, torsoLean: 0.3 * amp, headTilt: -0.1 });
};

/**
 * Leg phase for a locomotion cycle. In a scene it is driven by the distance actually travelled, so feet
 * do not slide and the legs settle when the character slows down; previews fall back to a time-based cycle.
 * `cycle` = body heights covered by one full cycle (two steps).
 */
const gait = (p: ActionParams, sec: number, cycle: number, rate: number) => p.travel === undefined
  ? { phase: sec * rate * p.speed, moving: 1 }
  : { phase: (p.travel / cycle) * TWO_PI, moving: clamp((p.pace ?? 0) / 0.12, 0, 1) };

const LYING: Pose = pose({ bodyRot: Math.PI / 2, hipY: -0.33, lShoulder: 1.2, rShoulder: 2.2, lElbow: 0.3, rElbow: -0.4, lHip: 0.1, rHip: -0.1, lKnee: 0.3, rKnee: 0.2, eyes: 'dizzy', mouthShape: 'wavy', stars: true });
// on a chair: thighs forward, feet on the floor, hands on the lap
const SITTING: Pose = pose({ hipY: -0.09, lHip: 1.1, rHip: 1.0, lKnee: -1.1, rKnee: -1.0, lShoulder: 0.5, lElbow: 0.9, rShoulder: 0.4, rElbow: 1.0, torsoLean: 0.04 });
// on the floor: legs out in front, leaning back on the hands
const SITTING_GROUND: Pose = pose({ hipY: -0.34, torsoLean: -0.14, lHip: 1.5, lKnee: 0, rHip: 1.75, rKnee: -0.6, lShoulder: -0.55, lElbow: -0.15, rShoulder: -0.65, rElbow: -0.1 });
const sitPose = (seat?: boolean) => (seat ? SITTING : SITTING_GROUND);
/** Thrown back by a hit. */
export const RECOIL: Pose = pose({ hipX: -0.07, torsoLean: -0.5, headTilt: -0.4, lShoulder: 2.2, lElbow: -0.8, rShoulder: 1.9, rElbow: 0.9, lHip: 0.35, rHip: -0.3, lKnee: -0.3, eyes: 'closed', mouthShape: 'o', mouth: 0.9, brow: 0.8, stars: true });

export const ACTION_DEFS: Record<ActionName, ActionDef> = {
  stand: { mask: 'full', fn: (_t, sec, p) => STAND(sec, p.emotion) },

  walk: {
    mask: 'full', locomotion: true, sfx: [{ name: 'footsteps', at: 0 }],
    fn: (_t, sec, p) => { const amp = clamp(p.intensity, 0.5, 1.4), g = gait(p, sec, strideLength(WALK_REACH * amp, 0.5), 6.5); return withExpression(blendPose(STAND(sec), walkCycle(g.phase, amp), g.moving), p.emotion); },
  },
  run: {
    mask: 'full', locomotion: true, cameraHint: 'track', sfx: [{ name: 'footsteps', at: 0 }],
    fn: (_t, sec, p) => { const amp = clamp(p.intensity, 0.6, 1.3), g = gait(p, sec, strideLength(RUN_REACH * amp, RUN_DUTY), 11); return withExpression(blendPose(STAND(sec), runCycle(g.phase, amp), g.moving), p.emotion); },
  },
  chase: {
    mask: 'full', locomotion: true, cameraHint: 'track', sfx: [{ name: 'footsteps', at: 0 }],
    fn: (_t, sec, p) => { const g = gait(p, sec, strideLength(RUN_REACH * 1.2, RUN_DUTY), 12); return withExpression(blendPose(STAND(sec), { ...runCycle(g.phase, 1.2), lShoulder: 2.4 + sin(sec * 12) * 0.2, lElbow: 0.2, rShoulder: 2.2 + cos(sec * 12) * 0.2, rElbow: 0.3, torsoLean: 0.42 }, g.moving), p.emotion ?? 'angry', 1.2); },
  },
  sneak: {
    mask: 'full', locomotion: true,
    fn: (_t, sec, p) => withExpression({ ...walkCycle(gait(p, sec, strideLength(WALK_REACH * 0.6, 0.5), 3.2).phase, 0.6), hipY: -0.06, torsoLean: 0.35, headTilt: -0.15, lShoulder: 0.9, lElbow: 1.6, rShoulder: 0.7, rElbow: 1.7, eyes: 'squint', sweat: true, mouthShape: 'flat' }, undefined),
  },
  enter: { mask: 'full', locomotion: true, fn: (_t, sec, p) => { const g = gait(p, sec, strideLength(WALK_REACH, 0.5), 6.5); return withExpression(blendPose(STAND(sec), walkCycle(g.phase, 1), g.moving), p.emotion); } },
  exit: { mask: 'full', locomotion: true, fn: (_t, sec, p) => { const g = gait(p, sec, strideLength(WALK_REACH, 0.5), 6.5); return withExpression(blendPose(STAND(sec), walkCycle(g.phase, 1), g.moving), p.emotion); } },

  jump: {
    mask: 'full', sfx: [{ name: 'boing', at: 0.2 }],
    fn: (t, _s, p) => {
      const crouch = pose({ hipY: -0.12, lHip: 0.7, rHip: 0.6, lKnee: -1.3, rKnee: -1.2, lShoulder: -0.8, rShoulder: -0.9, torsoLean: 0.3 });
      const air = pose({ hipY: 0.35 * p.intensity, lHip: 0.4, rHip: -0.4, lKnee: -0.9, rKnee: -0.6, lShoulder: 2.9, rShoulder: 2.7, lElbow: 0.1, rElbow: -0.1, mouthShape: 'smile', mouth: 0.3, eyes: 'happy' });
      const land = pose({ hipY: -0.1, lHip: 0.6, rHip: 0.5, lKnee: -1.1, rKnee: -1, lShoulder: 0.6, rShoulder: 0.5 });
      return keyframes([[0, STAND(0)], [0.22, crouch], [0.5, air], [0.8, land], [1, STAND(0)]], t, t < 0.5 ? easeOut : easeIn);
    },
  },
  sit: { mask: 'full', leaves: 'sitting', fn: (t, sec, p) => { const s = sitPose(p.seat); return withExpression(keyframes([[0, STAND(0)], [0.5, s], [1, { ...s, torsoLean: s.torsoLean + sin(sec * 2.2) * 0.008 }]], Math.min(1, t * 1.6)), p.emotion); } },

  fall: {
    mask: 'full', leaves: 'lying', cameraHint: 'shake', sfx: [{ name: 'whoosh', at: 0.1 }, { name: 'impact', at: 0.55 }],
    fn: (t) => {
      const wobble = pose({ torsoLean: -0.3, lShoulder: 2.6, rShoulder: 2.4, lElbow: 0.2, rElbow: -0.3, lHip: 0.3, rHip: -0.4, eyes: 'wide', mouthShape: 'o', mouth: 0.8 });
      const mid = pose({ bodyRot: -Math.PI / 4, hipY: -0.1, lShoulder: 2.8, rShoulder: 2.8, lHip: 0.5, rHip: -0.2, eyes: 'wide', mouthShape: 'o', mouth: 1 });
      const down = { ...LYING, bodyRot: -Math.PI / 2 };
      return keyframes([[0, STAND(0)], [0.25, wobble], [0.55, mid], [0.7, down], [1, down]], t, easeIn);
    },
  },
  slip: {
    mask: 'full', leaves: 'lying', cameraHint: 'shake', sfx: [{ name: 'slip', at: 0.05 }, { name: 'whoosh', at: 0.3 }, { name: 'impact', at: 0.62 }],
    fn: (t) => {
      const kick = pose({ hipY: -0.05, lHip: 1.5, lKnee: 0.1, rHip: -0.4, rKnee: 0.2, lShoulder: -2.6, rShoulder: -2.4, lElbow: -0.3, rElbow: 0.2, torsoLean: -0.35, eyes: 'wide', mouthShape: 'o', mouth: 1, exclaim: true });
      const air = pose({ hipY: 0.12, bodyRot: -0.9, lHip: 1.2, rHip: 0.6, lKnee: 0.5, rKnee: 0.4, lShoulder: -2.9, rShoulder: -2.9, eyes: 'wide', mouthShape: 'o', mouth: 1 });
      const thud = { ...LYING, bodyRot: -Math.PI / 2, hipY: -0.33 };
      return keyframes([[0, STAND(0)], [0.18, kick], [0.45, air], [0.62, thud], [0.75, { ...thud, hipY: -0.29 }], [0.85, thud], [1, thud]], t, t < 0.62 ? easeIn : easeOutBounce);
    },
  },
  getup: {
    mask: 'full', leaves: 'standing',
    fn: (t, _s, p) => {
      const kneel = pose({ hipY: -0.22, lHip: 1.3, lKnee: -1.5, rHip: -0.6, rKnee: 1.3, torsoLean: 0.4, lShoulder: 1.2, lElbow: -0.3, rShoulder: 0.9, rElbow: 0.5, eyes: 'squint' });
      const rub = pose({ lShoulder: 2.4, lElbow: 1.6, rShoulder: -0.3, torsoLean: -0.05, headTilt: 0.2, eyes: 'squint', mouthShape: 'frown' });
      if (p.from === 'standing') return STAND(0, p.emotion);
      if (p.from === 'sitting') return keyframes([[0, sitPose(p.seat)], [0.55, pose({ hipY: -0.1, torsoLean: 0.45, lHip: 0.9, rHip: 0.8, lKnee: -1.2, rKnee: -1.1, lShoulder: 0.6, rShoulder: 0.5 })], [1, STAND(0, p.emotion)]], t);
      return keyframes([[0, LYING], [0.4, kneel], [0.75, rub], [1, STAND(0, p.emotion)]], t);
    },
  },

  wave: {
    mask: 'upper',
    fn: (t, sec, p) => {
      const up = pose({ lShoulder: 2.9, lElbow: -0.8 + sin(sec * 10 * p.speed) * 0.5, headTilt: 0.1, ...breathe(sec) });
      return withExpression(keyframes([[0, STAND(sec)], [0.15, up], [0.85, up], [1, STAND(sec)]], t), p.emotion ?? 'happy');
    },
  },
  point: {
    mask: 'upper', cameraHint: 'zoom_in',
    fn: (t, sec, p) => {
      const pt = pose({ lShoulder: 1.55, lElbow: 0, rShoulder: -0.3, rElbow: -0.2, torsoLean: 0.12, headTilt: 0.05, ...breathe(sec, 0.4) });
      return withExpression(keyframes([[0, STAND(sec)], [0.2, pt], [1, pt]], t, easeOut), p.emotion ?? 'angry', p.intensity);
    },
  },
  clap: {
    mask: 'upper', sfx: [{ name: 'ding', at: 0 }],
    fn: (_t, sec, p) => {
      const c = (sin(sec * 14 * p.speed) + 1) / 2;
      return withExpression(pose({ lShoulder: 1.4 - c * 0.25, lElbow: 1.5 - c * 0.5, rShoulder: 1.4 + c * 0.25, rElbow: 1.5 + c * 0.5, headBob: c * 0.1 }), p.emotion ?? 'happy');
    },
  },
  dance: {
    mask: 'full',
    fn: (_t, sec, p) => {
      const ph = sec * 7 * p.speed;
      return withExpression(pose({
        hipY: Math.abs(sin(ph)) * 0.05, hipX: sin(ph / 2) * 0.05, torsoLean: sin(ph) * 0.15, headTilt: sin(ph + 1) * 0.25,
        lShoulder: 2.4 + sin(ph) * 0.6, lElbow: -0.9 + cos(ph) * 0.5, rShoulder: 2.2 + cos(ph) * 0.6, rElbow: 0.9 + sin(ph) * 0.5,
        lHip: sin(ph) * 0.4, rHip: -sin(ph) * 0.4, lKnee: Math.max(0, -sin(ph)) * 0.8, rKnee: Math.max(0, sin(ph)) * 0.8, musicNotes: true,
      }), p.emotion ?? 'happy');
    },
  },
  laugh: {
    mask: 'upper', sfx: [{ name: 'laugh_track', at: 0.1 }],
    fn: (_t, sec, p) => {
      const ph = sec * 12 * p.speed; const sh = sin(ph) * 0.06;
      return pose({ torsoLean: -0.15 + sh, headTilt: -0.25 + sh * 2, headBob: Math.abs(sin(ph)) * 0.3, lShoulder: 1.3, lElbow: 1.9 + sh, rShoulder: 2.6, rElbow: 0.5, mouthShape: 'grin', mouth: 0.5 + Math.abs(sin(ph)) * 0.5, eyes: 'closed', brow: 0.3 });
    },
  },
  cry: {
    mask: 'upper',
    fn: (_t, sec) => {
      const ph = sec * 6;
      return pose({ torsoLean: 0.15, headTilt: 0.25 + sin(ph) * 0.03, lShoulder: 0.9, lElbow: 2.4, rShoulder: 1.0, rElbow: 2.3, mouthShape: 'frown', mouth: 0.4 + Math.abs(sin(ph)) * 0.3, eyes: 'closed', brow: 0.9, tears: true });
    },
  },
  surprised: {
    mask: 'upper', cameraHint: 'zoom_in', sfx: [{ name: 'gasp', at: 0 }],
    fn: (t, sec, p) => {
      const jolt = pose({ torsoLean: -0.25, headTilt: -0.1, lShoulder: 2.3, lElbow: -1.2, rShoulder: 2.1, rElbow: 1.2, eyes: 'wide', mouthShape: 'o', mouth: 1, brow: 1, exclaim: true, hipY: 0.03 * p.intensity });
      const hold = { ...jolt, hipY: 0, torsoLean: -0.15, ...breathe(sec, 0.3) };
      return keyframes([[0, STAND(sec)], [0.12, jolt], [0.4, hold], [1, hold]], t, easeOut);
    },
  },
  confused: {
    mask: 'upper',
    fn: (_t, sec) => pose({ headTilt: 0.3 + sin(sec * 2) * 0.05, lShoulder: 1.6, lElbow: 1.9, rShoulder: -0.3, rElbow: -0.1, torsoLean: 0.05, mouthShape: 'wavy', eyes: 'squint', brow: 0.5, question: true, ...breathe(sec) }),
  },
  angry: {
    mask: 'upper', cameraHint: 'zoom_in',
    fn: (_t, sec, p) => {
      const sh = sin(sec * 30) * 0.02 * p.intensity;
      return pose({ torsoLean: 0.15 + sh, headTilt: -0.05, lShoulder: -0.6, lElbow: -2.2, rShoulder: -0.5, rElbow: 2.2, mouthShape: 'frown', mouth: 0.6, eyes: 'angry', brow: -1, anger: true, hipX: sh });
    },
  },
  talk: {
    mask: 'upper',
    fn: (_t, sec, p) => {
      const ph = sec * 2.5 * p.speed;
      const base = pose({ lShoulder: 0.8 + sin(ph) * 0.4, lElbow: 1.3 + cos(ph * 1.3) * 0.4, rShoulder: -0.3 + sin(ph + 2) * 0.2, rElbow: -0.3 - cos(ph) * 0.3, headTilt: sin(ph * 0.7) * 0.06, headBob: sin(ph * 3) * 0.08, torsoLean: 0.04 });
      return withExpression(base, p.emotion);
    },
  },
  shake_hands: {
    mask: 'upper',
    fn: (t, sec) => {
      const reach = pose({ lShoulder: 1.3, lElbow: 0.25 + sin(sec * 9) * 0.15 * (t > 0.3 ? 1 : 0), torsoLean: 0.1, headBob: sin(sec * 9) * 0.05, mouthShape: 'smile', eyes: 'happy' });
      return keyframes([[0, STAND(sec)], [0.3, reach], [0.9, reach], [1, STAND(sec, 'happy')]], t);
    },
  },
  fight: {
    mask: 'full', cameraHint: 'shake', sfx: [{ name: 'impact', at: 0.25 }, { name: 'impact', at: 0.55 }, { name: 'impact', at: 0.85 }],
    fn: (t, sec, p) => {
      const { front, back } = fightStrike(t), any = Math.max(front, back), bob = sin(sec * 9 * p.speed) * 0.015;
      return pose({ hipY: -0.05 + bob, hipX: any * 0.1 * p.intensity, torsoLean: 0.22 + any * 0.2, headTilt: -0.05,
        lShoulder: 1.45 + front * 0.15, lElbow: 2.5 - front * 2.5, rShoulder: 1.15 + back * 0.45, rElbow: 2.4 - back * 2.4,
        lHip: 0.5 + any * 0.15, rHip: -0.4, lKnee: -0.5, rKnee: 0.4, eyes: 'angry', brow: -1, mouthShape: 'frown', mouth: 0.4 + any * 0.4, anger: true });
    },
  },
  pickup: {
    mask: 'full',
    fn: (t, sec, p) => {
      const bend = pose({ hipY: -0.08, torsoLean: 1.0, headTilt: -0.4, lShoulder: 0.6, lElbow: 0.1, rShoulder: -0.8, rElbow: 0.2, lHip: 0.5, rHip: -0.3, lKnee: -0.5, rKnee: 0.1 });
      const hold = pose({ lShoulder: 1.2, lElbow: 1.5, rShoulder: -0.2, torsoLean: 0.02, headTilt: 0.15, ...breathe(sec, 0.3) });
      return withExpression(keyframes([[0, STAND(sec)], [0.4, bend], [0.75, hold], [1, hold]], t), p.emotion);
    },
  },
  open_door: {
    mask: 'upper', sfx: [{ name: 'door', at: 0.45 }],
    fn: (t, sec, p) => {
      const reach = pose({ lShoulder: 1.4, lElbow: 0.1, torsoLean: 0.12 });
      const pull = pose({ lShoulder: 0.9, lElbow: 1.1, torsoLean: -0.05 });
      return withExpression(keyframes([[0, STAND(sec)], [0.35, reach], [0.7, pull], [1, STAND(sec)]], t), p.emotion);
    },
  },
  turn: { mask: 'full', fn: (t, sec, p) => withExpression(pose({ ...IDLE, ...breathe(sec), torsoLean: sin(t * Math.PI) * 0.1, lHip: sin(t * Math.PI) * 0.3 }), p.emotion) },
  celebrate: {
    mask: 'full', sfx: [{ name: 'cheer', at: 0.1 }],
    fn: (t, sec, p) => {
      const ph = sec * 9 * p.speed;
      return withExpression(pose({ hipY: Math.abs(sin(ph)) * 0.3 * p.intensity, lShoulder: 2.9 + sin(ph) * 0.2, lElbow: -0.3, rShoulder: 2.8 - sin(ph) * 0.2, rElbow: 0.3, lHip: 0.3, rHip: -0.3, lKnee: -0.4 * Math.abs(sin(ph)), rKnee: -0.4 * Math.abs(cos(ph)), headTilt: sin(ph) * 0.15 }), 'happy', 1.3);
    },
  },
  react: {
    mask: 'upper', cameraHint: 'zoom_in',
    fn: (t, sec, p) => {
      const jolt = pose({ torsoLean: -0.3, hipY: 0.04, lShoulder: 1.9, lElbow: -1.4, rShoulder: 1.7, rElbow: 1.4, eyes: 'wide', mouthShape: 'o', mouth: 0.9, brow: 1 });
      return withExpression(keyframes([[0, STAND(sec)], [0.15, jolt], [0.5, { ...jolt, hipY: 0, torsoLean: -0.15 }], [1, STAND(sec)]], t, easeOut), p.emotion ?? 'surprised');
    },
  },
  freeze: {
    mask: 'full',
    fn: (_t, sec, p) => pose({ torsoLean: -0.08, lShoulder: 0.4, lElbow: 0.2, rShoulder: -0.4, rElbow: -0.2, eyes: 'wide', mouthShape: 'flat', brow: 0.8, sweat: true, blush: p.emotion === 'embarrassed', hipX: sin(sec * 40) * 0.003 }),
  },
  think: {
    mask: 'upper',
    fn: (_t, sec) => pose({ lShoulder: 1.0, lElbow: 2.5, rShoulder: -0.2, rElbow: -0.1, headTilt: 0.18, torsoLean: -0.02, eyes: 'squint', mouthShape: 'flat', brow: 0.3, ...breathe(sec) }),
  },
  nod: { mask: 'upper', fn: (_t, sec, p) => withExpression(pose({ headTilt: 0.18 + sin(sec * 8) * 0.18, ...breathe(sec) }), p.emotion ?? 'happy') },
  shrug: {
    mask: 'upper',
    fn: (t, sec) => {
      const up = pose({ lShoulder: 1.1, lElbow: 2.6, rShoulder: -1.1, rElbow: -2.6, headTilt: 0.2, headBob: -0.2, mouthShape: 'wavy', eyes: 'squint', brow: 0.7 });
      return keyframes([[0, STAND(sec)], [0.3, up], [0.7, up], [1, STAND(sec)]], t);
    },
  },
  facepalm: {
    mask: 'upper',
    fn: (t, sec) => {
      const slap = pose({ lShoulder: 1.1, lElbow: 2.9, headTilt: 0.35, torsoLean: 0.12, eyes: 'closed', mouthShape: 'frown', brow: 0.6 });
      return keyframes([[0, STAND(sec)], [0.3, slap], [1, slap]], t, easeOut);
    },
  },
  look: { mask: 'upper', fn: (_t, sec, p) => withExpression(pose({ headTilt: 0.12, ...breathe(sec) }), p.emotion) },

  pushup: {
    mask: 'full',
    fn: (t, sec, p) => {
      const rep = (1 - cos(sec * 4 * p.speed)) / 2;
      return withExpression(keyframes([[0, STAND(0)], [0.15, plank(0)], [0.9, plank(rep)], [1, STAND(0)]], t, easeInOut), p.emotion ?? 'angry', 0.6);
    },
  },
  lift: {
    mask: 'full', sfx: [{ name: 'impact', at: 0.95 }],
    fn: (t, sec, p) => {
      // squat to grab, press overhead, repeat
      const rep = (1 - cos(sec * 2.6 * p.speed)) / 2;
      const press = pose({ hipY: -0.04 * (1 - rep), lHip: 0.3 * (1 - rep), rHip: -0.2 * (1 - rep), lKnee: -0.4 * (1 - rep), rKnee: 0.3 * (1 - rep), lShoulder: 1.6 + rep * 1.4, lElbow: 1.6 * (1 - rep), rShoulder: 1.5 + rep * 1.45, rElbow: 1.6 * (1 - rep), torsoLean: -0.05, eyes: 'squint', brow: -0.6, mouthShape: 'frown', mouth: 0.3 * rep, sweat: true });
      return withExpression(keyframes([[0, STAND(0)], [0.1, press], [0.92, press], [1, STAND(0)]], t), p.emotion);
    },
  },
  kneel: {
    mask: 'full', leaves: 'standing',
    fn: (t, sec, p) => {
      const down = pose({ hipY: -0.2, lHip: 1.4, lKnee: -1.4, rHip: -0.05, rKnee: -1.5, torsoLean: 0.25 + sin(sec * 1.5) * 0.02, headTilt: 0.4, lShoulder: 0.3, lElbow: 0.4, rShoulder: 0.2, rElbow: 0.3, eyes: 'closed', brow: 0.6 });
      return withExpression(keyframes([[0, STAND(0)], [0.25, down], [0.85, down], [1, STAND(0)]], t), p.emotion ?? 'sad');
    },
  },
  sleep: {
    mask: 'full', leaves: 'lying',
    fn: (t, sec) => keyframes([[0, STAND(0)], [0.25, pose({ hipY: -0.2, lHip: 1.3, rHip: 1.2, lKnee: -1.3, rKnee: -1.2, torsoLean: -0.4, eyes: 'closed' })], [0.45, SLEEPING(sec)], [1, SLEEPING(sec)]], t),
  },
  climb: {
    mask: 'full', locomotion: true, sfx: [{ name: 'footsteps', at: 0 }],
    fn: (_t, sec, p) => {
      // high knees and a forward lean, as if going up steps
      const g = gait(p, sec, strideLength(WALK_REACH, 0.5), 5);
      const w = walkCycle(g.phase, 1.1);
      return withExpression(blendPose(STAND(sec), { ...w, lKnee: w.lKnee * 1.6, rKnee: w.rKnee * 1.6, lHip: w.lHip * 1.25 + 0.15, rHip: w.rHip * 1.25 + 0.15, torsoLean: 0.28, headTilt: -0.15, lShoulder: w.lShoulder * 1.2 + 0.2, rShoulder: w.rShoulder * 1.2 + 0.2 }, g.moving), p.emotion);
    },
  },
};

/**
 * Push-up position with the feet on the floor and the hands flat under the shoulders.
 * `down` 0 = arms nearly straight, 1 = chest low. Angles come from the default limb lengths.
 */
function plank(down: number): Pose {
  const L1 = 0.17, L2 = 0.16, BODY = 0.683;           // upper arm, forearm, feet→shoulder (body heights)
  const sh = 0.31 - down * 0.14;                       // shoulder height above the floor
  const rot = Math.acos(sh / BODY);                    // body tilt from vertical
  // two-bone arm reaching straight down, elbow pointing back toward the feet
  const a1 = -Math.acos(clamp((L1 * L1 + sh * sh - L2 * L2) / (2 * L1 * sh), -1, 1));
  const a2 = Math.asin(clamp((-L1 * sin(a1)) / L2, -1, 1));
  const arm = a1 + rot;                                // world angle → body frame (the body is tilted by rot)
  return pose({ bodyRot: rot, hipY: 0.4 * cos(rot) - 0.4, torsoLean: 0, headTilt: -0.3, lShoulder: arm, lElbow: a2 - a1, rShoulder: arm, rElbow: a2 - a1, lHip: 0, rHip: 0.04, lKnee: 0, rKnee: 0, eyes: 'squint', brow: -0.4, mouthShape: 'flat', sweat: down > 0.5 });
}

/** Asleep on the floor: lying still, breathing, eyes closed. */
const SLEEPING = (sec: number): Pose => ({ ...LYING, bodyRot: -Math.PI / 2, eyes: 'closed', stars: false, zzz: true, mouthShape: 'flat', mouth: 0, headBob: sin(sec * 1.4) * 0.05 });

export const REST_POSES = {
  standing: (sec: number, e?: Emotion, _seat?: boolean) => STAND(sec, e),
  lying: (sec: number, _e?: Emotion, _seat?: boolean, asleep?: boolean) => (asleep ? SLEEPING(sec) : LYING),
  sitting: (sec: number, e?: Emotion, seat?: boolean) => { const s = sitPose(seat); return withExpression({ ...s, torsoLean: s.torsoLean + sin(sec * 2.2) * 0.008, headBob: sin(sec * 2.2) * 0.05 }, e); },
};

/** Blend into an action from a previous pose for a short ramp to avoid pops. */
export function rampIn(prev: Pose, target: Pose, elapsed: number, ramp = 0.18) {
  if (elapsed >= ramp) return target;
  return blendPose(prev, target, easeInOut(elapsed / ramp));
}
