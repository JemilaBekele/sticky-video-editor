// ───────────────────────────── Story plan ─────────────────────────────
// Intermediate representation produced by the script parser, then compiled into executable Scenes.

import {
  type Project, type Scene, type Character, type ActionClip, type ActionName, type Emotion, type BackgroundId, type PropType, type CameraShot, type CameraMove,
  type Transition, type Accessory, type SfxName, ACTIONS, PROP_TYPES, makeCharacter, makeScene, uid, fitSceneDuration,
} from '../types';
import { speechDuration } from '../engine/voice';
import { ACTION_DEFS } from '../engine/actions';
import { solvePosition } from '../engine/scene';
import { HANDHELD } from '../engine/props';

export type Beat =
  | { type: 'action'; character: string; action: ActionName; target?: string; prop?: string; emotion?: Emotion; duration?: number; toX?: number; speed?: number; intensity?: number; simultaneous?: boolean }
  | { type: 'dialogue'; character: string; text: string; tone?: Emotion; style?: 'subtitle' | 'bubble' | 'thought' }
  | { type: 'pause'; duration: number }
  | { type: 'sfx'; name: SfxName; text?: string }
  | { type: 'text'; text: string; kind?: 'title' | 'caption' | 'sfx_text' | 'closing'; duration?: number };

export interface PlanScene {
  title: string;
  background?: BackgroundId;
  props?: { type: PropType; near?: string; x?: number; label?: string }[];
  characters?: string[];                   // present at scene start (others appear via 'enter')
  beats: Beat[];
  camera?: { shot?: CameraShot; move?: CameraMove; focus?: string };
  transition?: Transition;
  sourceText?: string;
}

export interface StoryPlan {
  title?: string;
  characters: { name: string; accessories?: Accessory[]; color?: string }[];
  scenes: PlanScene[];
  warnings?: string[];                     // sentences the parser could not turn into anything
}

const ACTION_NAMES = new Set<string>(ACTIONS.map(a => a.name));

const ACTION_ALIASES: Record<string, ActionName> = {
  walking: 'walk', walks: 'walk', running: 'run', runs: 'run', jumping: 'jump', sitting: 'sit', falling: 'fall', fall_down: 'fall', get_up: 'getup', stand_up: 'getup', standing: 'stand', idle: 'stand',
  waving: 'wave', pointing: 'point', clapping: 'clap', dancing: 'dance', laughing: 'laugh', crying: 'cry', shock: 'surprised', shocked: 'surprised', surprise: 'surprised', confusion: 'confused', anger: 'angry', shout: 'angry', shouting: 'angry', yell: 'angry',
  talking: 'talk', speak: 'talk', speaking: 'talk', say: 'talk', handshake: 'shake_hands', shake: 'shake_hands', chasing: 'chase', fighting: 'fight', punch: 'fight', pick_up: 'pickup', grab: 'pickup', take: 'pickup', hold: 'pickup', open: 'open_door', door: 'open_door',
  turn_around: 'turn', celebrating: 'celebrate', cheer: 'celebrate', reaction: 'react', sneaking: 'sneak', tiptoe: 'sneak', frozen: 'freeze', thinking: 'think', nodding: 'nod', shrugging: 'shrug', trip: 'slip', slipping: 'slip', stumble: 'slip',
  leave: 'exit', leaves: 'exit', arrive: 'enter', enters: 'enter', look_at: 'look', stare: 'look', glare: 'look', embarrassed: 'freeze', realize: 'react', notice: 'react',
};

export function normalizeAction(a: string | undefined): ActionName | undefined {
  if (!a) return undefined;
  const k = String(a).toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (ACTION_NAMES.has(k)) return k as ActionName;
  return ACTION_ALIASES[k];
}

// ───────────────────────────── Compile plan → project content ─────────────────────────────

const ROLE_NAMES = ['stickman', 'man', 'woman', 'person', 'guy', 'girl', 'boy', 'character'];

/** `durationOf` lets the caller supply exact speaking times (e.g. from generated voice clips). */
export function compilePlan(plan: StoryPlan, existing: Character[] = [], opts: { durationOf?: (text: string, ch?: Character) => number | undefined } = {}): { characters: Character[]; scenes: Scene[]; title?: string } {
  // characters: reuse existing ones by name for consistency across regenerations
  const characters: Character[] = [];
  const byName = new Map<string, Character>();
  plan.characters.forEach((pc, i) => {
    const prev = existing.find(c => c.name.toLowerCase() === pc.name.toLowerCase());
    const ch = prev ? { ...prev, accessories: pc.accessories?.length ? pc.accessories : prev.accessories } : makeCharacter(titleCase(pc.name), i, { accessories: pc.accessories ?? [], color: pc.color });
    if (pc.color) ch.color = pc.color;
    characters.push(ch); byName.set(pc.name.toLowerCase(), ch);
  });
  const find = (name?: string) => name ? byName.get(name.toLowerCase()) ?? characters.find(c => name.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(name.toLowerCase())) : undefined;

  const scenes: Scene[] = [];
  let lastBg: BackgroundId = 'white';
  const persistentAccessories = new Map<string, Accessory[]>();

  plan.scenes.forEach((ps, si) => {
    const bg = ps.background ?? lastBg; lastBg = bg;
    const scene = makeScene(ps.title || `Scene ${si + 1}`, { background: bg, transitionIn: ps.transition ?? (si === 0 ? 'fade' : 'fade'), sourceText: ps.sourceText });

    // who is in this scene
    const names = new Set<string>();
    for (const n of ps.characters ?? []) names.add(n.toLowerCase());
    for (const b of ps.beats) { if (b.type === 'action') { names.add(b.character.toLowerCase()); if (b.target && find(b.target)) names.add(b.target.toLowerCase()); } if (b.type === 'dialogue' && b.character.toLowerCase() !== 'narrator') names.add(b.character.toLowerCase()); }
    const present = [...names].map(n => find(n)).filter((c): c is Character => !!c).filter((c, i, a) => a.indexOf(c) === i);
    const enterers = new Set(ps.beats.filter(b => b.type === 'action' && b.action === 'enter').map(b => (b as any).character.toLowerCase()));
    const slots = positions(present.length);
    present.forEach((c, i) => {
      const entering = enterers.has(c.name.toLowerCase());
      scene.characters.push({ characterId: c.id, x: slots[i], facing: slots[i] <= 0.5 ? 1 : -1, visible: !entering || true });
    });
    if (present.length === 1) scene.characters[0].facing = 1;

    // props
    for (const p of ps.props ?? []) {
      const near = find(p.near);
      const nx = near ? scene.characters.find(c => c.characterId === near.id)?.x ?? 0.5 : undefined;
      const x = p.x ?? (nx !== undefined ? Math.min(0.92, nx + 0.13) : 0.5 + (Math.random() - 0.5) * 0.6);
      scene.props.push({ id: uid('prp'), type: p.type, x, y: p.type === 'window' ? 0.25 : 0, scale: 1, label: p.label });
    }

    // beats → timeline (sequential, with optional simultaneous flag)
    let t = 0.4;
    let lastEnd = t;
    let narrationEnd = 0;
    // staging helpers: where everyone is at a given moment, given the clips placed so far
    // the scene is still being built, so query a snapshot: the solver caches results per scene object
    const posAt = (id: string, time: number) => solvePosition({ ...scene, actions: [...scene.actions] }, { characters } as Project, id, time).x;
    const resting = new Map<string, 'standing' | 'lying' | 'sitting'>();
    const place = (clip: Omit<ActionClip, 'id'>) => { const c: ActionClip = { id: uid('act'), ...clip }; scene.actions.push(c); return c; };
    /** Give a move the time it naturally takes to cover its distance. */
    const pace = (clip: ActionClip, speed = 1) => {
      const dist = Math.abs(posAt(clip.characterId, clip.start + clip.duration) - posAt(clip.characterId, clip.start));
      clip.duration = Math.round(Math.min(5, Math.max(0.6, dist / (TRAVEL_RATE[clip.action] ?? 0.2) / speed)) * 10) / 10;
      return clip.duration;
    };
    /** Walk up to a character or prop first when it is out of arm's reach. */
    const approach = (who: Character, to: { targetId?: string; toX?: number }, x: number, within: number) => {
      if (Math.abs(posAt(who.id, t) - x) <= within) return;
      t += pace(place({ characterId: who.id, action: 'walk', start: t, duration: 1, ...to })); lastEnd = t; resting.set(who.id, 'standing');
    };
    const camEvents: { at: number; kind: 'zoom_in' | 'track' | 'shake'; who: string }[] = [];
    for (const b of ps.beats) {
      switch (b.type) {
        case 'action': {
          const ch = find(b.character); if (!ch) break;
          const def = ACTION_DEFS[b.action];
          let dur = b.duration ?? ACTIONS.find(a => a.name === b.action)!.defaultDuration;
          let targetId: string | undefined, propId: string | undefined;
          if (b.target) { const tc = find(b.target); if (tc) targetId = tc.id; else { const pr = scene.props.find(p => p.type === b.target?.toLowerCase()); if (pr) targetId = pr.id; } }
          if (b.prop || (b.action === 'pickup' && !targetId)) {
            const type = (b.prop ?? b.target ?? '').toLowerCase() as PropType;
            let pr = scene.props.find(p => p.type === type);
            if (!pr && PROP_TYPES.includes(type)) { const cx = scene.characters.find(c => c.characterId === ch.id)?.x ?? 0.5; pr = { id: uid('prp'), type, x: Math.min(0.9, cx + 0.1), y: 0, scale: 1 }; scene.props.push(pr); }
            if (pr) propId = pr.id;
          }
          if (b.action === 'getup' && !resting.has(ch.id) && !scene.actions.some(a => a.characterId === ch.id)) {
            const sc = scene.characters.find(c => c.characterId === ch.id);
            if (sc) { sc.startsAs = 'lying'; resting.set(ch.id, 'lying'); }
          }
          if (!b.simultaneous) {
            // back on their feet before anything that needs standing
            const state = resting.get(ch.id) ?? 'standing';
            const staysDown = b.action === 'getup' || (state === 'lying' && (b.action === 'fall' || b.action === 'slip' || b.action === 'sleep')) || (state === 'sitting' && b.action === 'sit');
            if (state !== 'standing' && def.mask === 'full' && !staysDown) { const d = state === 'lying' ? 1.3 : 0.7; place({ characterId: ch.id, action: 'getup', start: t, duration: d }); t += d; lastEnd = t; resting.set(ch.id, 'standing'); }
            // close the distance before touching someone or something
            const other = targetId ? scene.characters.find(c => c.characterId === targetId) : undefined;
            const prop = scene.props.find(p => p.id === (propId ?? targetId));
            if (other && b.action === 'shake_hands') approach(ch, { targetId }, posAt(other.characterId, t), 0.17);
            else if (other && b.action === 'fight') { const ox = posAt(other.characterId, t); approach(ch, { toX: ox + (posAt(ch.id, t) < ox ? -FIGHT_RANGE : FIGHT_RANGE) }, ox, FIGHT_RANGE + 0.02); }   // within punching range
            else if (b.action === 'pickup' && prop) approach(ch, { targetId: prop.id }, prop.x, 0.1);
            else if (b.action === 'open_door') { const door = prop?.type === 'door' ? prop : scene.props.find(p => p.type === 'door'); if (door) { targetId = door.id; approach(ch, { targetId: door.id }, door.x, 0.1); } }
            else if (b.action === 'sit') {
              if (!scene.props.some(p => p.type === 'chair') && INDOORS.includes(bg)) scene.props.push({ id: uid('prp'), type: 'chair', x: posAt(ch.id, t), y: 0, scale: 1 });
              const chair = scene.props.filter(p => p.type === 'chair').sort((a, c) => Math.abs(a.x - posAt(ch.id, t)) - Math.abs(c.x - posAt(ch.id, t)))[0]; if (chair) approach(ch, { toX: chair.x }, chair.x, 0.03);
            }
          }
          const clipStart = b.simultaneous ? Math.max(0.2, lastEnd - dur) : t;
          let toX = b.toX;
          if (b.action === 'exit') toX = posAt(ch.id, clipStart) < 0.5 ? -0.18 : 1.18;
          if (b.action === 'climb' && toX === undefined && !targetId) toX = Math.min(0.9, posAt(ch.id, clipStart) + 0.3);   // up the slope, which rises to the right
          const clip = place({ characterId: ch.id, action: b.action, start: clipStart, duration: dur, toX, targetId, propId, emotion: b.emotion, speed: b.speed, intensity: b.intensity });
          if (def.locomotion && b.duration === undefined) dur = pace(clip, b.speed);
          resting.set(ch.id, def.leaves ?? (def.locomotion ? 'standing' : resting.get(ch.id) ?? 'standing'));
          if (def.cameraHint) camEvents.push({ at: clipStart, kind: def.cameraHint, who: ch.id });
          if (b.action === 'slip' || b.action === 'fall') scene.texts.push({ id: uid('txt'), kind: 'sfx_text', text: b.action === 'slip' ? 'SLIP!' : 'THUD!', start: clipStart + dur * 0.6, duration: 0.8, x: 0.5 + (Math.random() - 0.5) * 0.3, y: 0.35, size: 1.6, color: '#ffe36b', animation: 'pop' });
          if (b.action === 'laugh') scene.texts.push({ id: uid('txt'), kind: 'sfx_text', text: 'HA HA!', start: clipStart + 0.2, duration: Math.min(1.5, dur), x: 0.5, y: 0.25, size: 1.3, color: '#5aa9ff', animation: 'shake' });
          if (!b.simultaneous) { lastEnd = clipStart + dur; t = clipStart + (def.locomotion || def.leaves ? dur : dur * 0.85); } else lastEnd = Math.max(lastEnd, clipStart + dur);
          break;
        }
        case 'dialogue': {
          const isNarr = b.character.toLowerCase() === 'narrator';
          const ch = isNarr ? undefined : find(b.character);
          const dur = opts.durationOf?.(b.text, ch) ?? speechDuration(b.text, ch);
          // voices never overlap: wait for any narration still playing
          const start = Math.max(t, narrationEnd);
          scene.dialogue.push({ id: uid('dlg'), characterId: ch ? ch.id : 'narrator', text: b.text, start, duration: dur, tone: b.tone, style: b.style ?? (isNarr ? 'subtitle' : 'bubble') });
          if (ch && b.tone && ['angry', 'surprised'].includes(b.tone)) camEvents.push({ at: start, kind: 'zoom_in', who: ch.id });
          if (isNarr) { narrationEnd = start + dur + 0.2; t = start + 0.3; lastEnd = Math.max(lastEnd, narrationEnd); }   // the story keeps moving under narration
          else { t = start + dur + 0.2; lastEnd = t; }
          break;
        }
        case 'pause': t += b.duration; lastEnd = t; break;
        case 'sfx': scene.sfx.push({ id: uid('sfx'), name: b.name, start: t, volume: 1 }); if (b.text) scene.texts.push({ id: uid('txt'), kind: 'sfx_text', text: b.text, start: t, duration: 0.8, x: 0.5, y: 0.3, size: 1.5, color: '#ffe36b', animation: 'pop' }); t += 0.3; break;
        case 'text': { const dur = b.duration ?? 2; scene.texts.push({ id: uid('txt'), kind: b.kind ?? 'caption', text: b.text, start: t, duration: dur, x: 0.5, y: b.kind === 'title' ? 0.2 : 0.15, size: b.kind === 'title' ? 1.8 : 1.1, color: '#ffffff', animation: 'pop' }); if (b.kind === 'title') t += 0.6; break; }
      }
    }
    scene.duration = Math.max(2, Math.round((Math.max(t, lastEnd, narrationEnd) + 0.8) * 10) / 10);
    fitSceneDuration(scene);
    // make held props travel with their character and keep cross-scene accessories
    for (const c of present) if (c.accessories.length) persistentAccessories.set(c.id, c.accessories);

    // camera direction
    const focusEvent = camEvents.find(e => e.kind === 'zoom_in');
    const trackEvent = camEvents.find(e => e.kind === 'track');
    if (ps.camera?.shot || ps.camera?.move) {
      scene.camera = { shot: ps.camera.shot ?? 'wide', move: ps.camera.move ?? 'static', focusCharacterId: find(ps.camera.focus)?.id ?? focusEvent?.who };
    } else if (focusEvent) scene.camera = { shot: present.length > 1 ? 'medium' : 'wide', move: 'zoom_in', focusCharacterId: focusEvent.who, startAt: focusEvent.at, intensity: 0.8 };
    else if (trackEvent) scene.camera = { shot: 'wide', move: 'track', focusCharacterId: trackEvent.who };
    else if (present.length === 1 && scene.dialogue.some(d => d.characterId !== 'narrator')) scene.camera = { shot: 'medium', move: 'static', focusCharacterId: present[0].id };
    else scene.camera = { shot: 'wide', move: si % 3 === 2 ? 'zoom_out' : 'static' };
    scenes.push(scene);
  });

  return { characters, scenes, title: plan.title };
}

const FIGHT_RANGE = 0.085;
const INDOORS: BackgroundId[] = ['gym', 'office', 'bedroom', 'classroom', 'restaurant', 'school', 'shop'];
/** Natural travel speed per move, in stage widths per second. */
const TRAVEL_RATE: Partial<Record<ActionName, number>> = { climb: 0.12, walk: 0.2, enter: 0.24, exit: 0.24, run: 0.5, chase: 0.5, sneak: 0.1 };

function positions(n: number): number[] {
  if (n <= 1) return [0.5];
  if (n === 2) return [0.32, 0.68];
  if (n === 3) return [0.2, 0.5, 0.8];
  return Array.from({ length: n }, (_, i) => 0.12 + (0.76 * i) / (n - 1));
}
function titleCase(s: string) { return s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()); }

export { HANDHELD, ROLE_NAMES };
