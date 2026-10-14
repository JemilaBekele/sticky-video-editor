// ───────────────────────────── Prompt-based editing ─────────────────────────────
// Natural-language edit → list of small, targeted operations → applied to the project.
// Edits never rebuild the whole project; they patch exactly what was asked.

import { type Project, type Scene, type ActionName, type Emotion, type BackgroundId, type Accessory, type SfxName, BACKGROUNDS, ACTIONS, uid, makeCharacter, fitSceneDuration } from '../types';
import { normalizeAction } from './plan';
import { speechDuration } from '../engine/voice';

export type EditOp =
  | { op: 'set_speed'; character?: string; action?: ActionName; factor: number; scene?: number | 'all' }
  | { op: 'set_background'; background: BackgroundId; scene?: number | 'all' }
  | { op: 'insert_pause'; scene?: number; duration: number; at: 'before_last_dialogue' | 'start' | 'end' | number }
  | { op: 'set_camera'; scene?: number; shot?: Scene['camera']['shot']; move?: Scene['camera']['move']; focus?: string; startAt?: 'angry' | 'surprised' | number; intensity?: number }
  | { op: 'face_each_other'; scene?: number }
  | { op: 'add_character'; name: string; scene?: number; enter?: boolean; accessories?: Accessory[]; color?: string }
  | { op: 'replace_action'; character?: string; from: ActionName; to: ActionName; emotion?: Emotion; scene?: number | 'all' }
  | { op: 'set_emotion'; character?: string; emotion: Emotion; scene?: number | 'all' }
  | { op: 'add_action'; scene?: number; character: string; action: ActionName; at?: 'start' | 'end' | number; target?: string; duration?: number; emotion?: Emotion }
  | { op: 'add_dialogue'; scene?: number; character: string; text: string; at?: 'end' | number; tone?: Emotion }
  | { op: 'add_accessory'; character?: string; accessory: Accessory }
  | { op: 'remove_accessory'; character?: string; accessory: Accessory }
  | { op: 'rename_character'; from: string; to: string }
  | { op: 'set_color'; character: string; color: string }
  | { op: 'set_duration'; scene?: number | 'all'; duration?: number; factor?: number }
  | { op: 'add_sfx'; scene?: number; name: SfxName; at?: number | 'end' | 'impact'; text?: string }
  | { op: 'set_subtitles'; enabled: boolean }
  | { op: 'set_music'; track?: Project['settings']['audio']['musicTrack']; enabled?: boolean }
  | { op: 'funnier'; scene?: number }
  | { op: 'remove_character'; character: string; scene?: number | 'all' }
  | { op: 'set_transition'; scene?: number | 'all'; transition: Scene['transitionIn'] }
  | { op: 'set_title'; opening?: string; closing?: string };

const EMOTIONS: Emotion[] = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'confused', 'scared', 'smug', 'embarrassed'];
const EMO_SYN: Record<string, Emotion> = { shocked: 'surprised', stunned: 'surprised', amazed: 'surprised', puzzled: 'confused', mad: 'angry', furious: 'angry', upset: 'sad', excited: 'happy', nervous: 'scared', afraid: 'scared', ashamed: 'embarrassed', proud: 'smug', cocky: 'smug' };
const ACCS: Accessory[] = ['sunglasses', 'hat', 'tie', 'bow', 'crown', 'glasses', 'headphones', 'cap', 'scarf'];
const SFX_NAMES: SfxName[] = ['footsteps', 'door', 'impact', 'boing', 'whoosh', 'laugh_track', 'slip', 'ding', 'crash', 'gasp', 'cheer'];

function emotionIn(s: string): Emotion | undefined { const w = s.toLowerCase(); for (const e of EMOTIONS) if (new RegExp(`\\b${e}\\b`).test(w)) return e; for (const k in EMO_SYN) if (new RegExp(`\\b${k}\\b`).test(w)) return EMO_SYN[k]; return undefined; }
function bgIn(s: string): BackgroundId | undefined { const w = s.toLowerCase(); for (const b of BACKGROUNDS) if (w.includes(b.label.toLowerCase()) || w.includes(b.id)) return b.id; if (/\boutdoors?|nature|mountain/.test(w)) return 'landscape'; if (/\bstore|mall\b/.test(w)) return 'shop'; if (/\bnight|downtown\b/.test(w)) return 'city'; return undefined; }
function charIn(project: Project, s: string): string | undefined { const w = s.toLowerCase(); return [...project.characters].sort((a, b) => b.name.length - a.name.length).find(c => w.includes(c.name.toLowerCase()))?.name; }
function numIn(s: string): number | undefined { const m = s.match(/(\d+(?:\.\d+)?)\s*(?:-?\s*second|sec|s\b)/i) ?? s.match(/\b(one|two|three|four|five|half a)\b\s*(?:second|sec)/i); if (!m) return undefined; const words: any = { one: 1, two: 2, three: 3, four: 4, five: 5, 'half a': 0.5 }; return words[m[1].toLowerCase()] ?? parseFloat(m[1]); }
function sceneIn(s: string, current: number, total: number): number | 'all' | undefined { if (/\b(all|every|each) scenes?\b|\bwhole (video|project|animation)\b|\beverywhere\b/i.test(s)) return 'all'; const m = s.match(/\bscene\s*(\d+)/i); if (m) return Math.min(total - 1, Math.max(0, parseInt(m[1]) - 1)); if (/\b(this|current) scene\b/i.test(s)) return current; return undefined; }

/** Rule-based interpretation of an edit instruction. Returns null if it can't be understood. */
export function interpretInstruction(text: string, project: Project, current: number): { ops: EditOp[]; explanation: string } | null {
  const s = text.trim(); const low = s.toLowerCase();
  const scene = sceneIn(s, current, project.scenes.length);
  const who = charIn(project, s);
  const ops: EditOp[] = [];
  const say = (m: string) => ({ ops, explanation: m });

  // speed
  if (/\b(faster|quicker|speed up|hurry)\b/.test(low) || /\b(slower|slow down|more slowly)\b/.test(low)) {
    const faster = /\b(faster|quicker|speed up|hurry)\b/.test(low);
    const action = (ACTIONS.map(a => a.name) as ActionName[]).find(a => new RegExp(`\\b${a}(s|ning|ing)?\\b`).test(low)) ?? (/\brun/.test(low) ? 'run' : /\bwalk/.test(low) ? 'walk' : /\btalk|speak/.test(low) ? 'talk' : undefined);
    const factor = /\bmuch|way|a lot|twice\b/.test(low) ? (faster ? 2 : 0.5) : faster ? 1.5 : 0.7;
    ops.push({ op: 'set_speed', character: who, action, factor, scene: scene ?? (who ? 'all' : current) });
    return say(`${faster ? 'Sped up' : 'Slowed down'} ${action ?? 'actions'}${who ? ` for ${who}` : ''} ×${factor}.`);
  }
  // background
  if (/\b(background|setting|location|set it in|move (it|them|the scene) to|scene takes place)\b/.test(low) || /\bchange .* to (a|an|the) (office|classroom|park|street|shop|city|bedroom|restaurant|stadium|school)/.test(low)) {
    const bg = bgIn(s); if (bg) { ops.push({ op: 'set_background', background: bg, scene: scene ?? current }); return say(`Background set to ${bg}.`); }
  }
  // pause
  if (/\b(pause|beat|wait|delay|hold)\b/.test(low) && /\badd|insert|put|give\b/.test(low)) {
    const d = numIn(s) ?? 1;
    const at: 'before_last_dialogue' | 'start' | 'end' = /before the (punchline|last line|ending|end|final line)/.test(low) ? 'before_last_dialogue' : /\b(at the )?(start|beginning)\b/.test(low) ? 'start' : /\bend\b/.test(low) ? 'end' : 'before_last_dialogue';
    ops.push({ op: 'insert_pause', scene: scene === 'all' ? current : scene ?? current, duration: d, at });
    return say(`Inserted a ${d}s pause ${at === 'before_last_dialogue' ? 'before the punchline' : `at the ${at}`}.`);
  }
  // camera
  if (/\bcamera|zoom|close[- ]?up|wide shot|pan\b/.test(low)) {
    const op: EditOp = { op: 'set_camera', scene: scene === 'all' ? current : scene ?? current };
    if (/zoom (in|into|on)|close[- ]?up/.test(low)) op.move = 'zoom_in'; else if (/zoom out/.test(low)) op.move = 'zoom_out'; else if (/pan left/.test(low)) op.move = 'pan_left'; else if (/pan right/.test(low)) op.move = 'pan_right'; else if (/follow|track/.test(low)) op.move = 'track'; else if (/static|still|stop moving/.test(low)) op.move = 'static';
    if (/close[- ]?up/.test(low)) op.shot = 'closeup'; else if (/medium/.test(low)) op.shot = 'medium'; else if (/wide/.test(low)) op.shot = 'wide';
    if (who) op.focus = who;
    const em = emotionIn(s); if (em === 'angry' || em === 'surprised') op.startAt = em; else { const n = numIn(s); if (n !== undefined) op.startAt = n; }
    if (/\b(slightly|a little|subtle)\b/.test(low)) op.intensity = 0.5; if (/\b(dramatic|a lot|hard|big)\b/.test(low)) op.intensity = 1.2;
    ops.push(op); return say(`Camera updated: ${op.shot ?? ''} ${op.move ?? ''}${op.focus ? ` on ${op.focus}` : ''}${op.startAt ? ` when ${op.startAt}` : ''}.`.replace(/\s+/g, ' '));
  }
  // face each other
  if (/\bface (each other|one another)|look at each other|turn (to|towards?) each other\b/.test(low)) { ops.push({ op: 'face_each_other', scene: scene === 'all' ? current : scene ?? current }); return say('Characters now face each other.'); }
  // add a character
  const addChar = low.match(/\badd (?:a |an |another )?(?:third |fourth |new |second )?(?:stickman|stick man|character|person|man|woman|guy|girl)(?: (?:called|named) ([a-z]+))?/) ?? s.match(/\b[Aa]dd ([A-Z][a-z]+) (?:who|to the scene|entering)/);
  if (addChar || /\bthird stickman\b/.test(low)) {
    const nameRaw = addChar?.[1] ?? s.match(/\b(?:called|named)\s+([A-Z][a-z]+)/)?.[1];
    const name = nameRaw ? nameRaw[0].toUpperCase() + nameRaw.slice(1) : `Stickman ${project.characters.length + 1}`;
    const accessories = ACCS.filter(a => new RegExp(`\\b${a}s?\\b`).test(low));
    ops.push({ op: 'add_character', name, scene: scene === 'all' ? current : scene ?? current, enter: /\benter|walks? in|comes? in|arrives?\b/.test(low) || true, accessories });
    return say(`Added ${name}, entering the scene.`);
  }
  // dialogue
  const dlg = s.match(/\b(?:make|have|let)\s+(\w[\w ]*?)\s+say\s+["“']?(.+?)["”']?$/i) ?? s.match(/\badd (?:a )?(?:line|dialogue)\s*(?:for|to)?\s*(\w+)?\s*[:"“'](.+?)["”']?$/i);
  if (dlg) { const name = charIn(project, dlg[1] ?? '') ?? dlg[1] ?? 'NARRATOR'; ops.push({ op: 'add_dialogue', scene: scene === 'all' ? current : scene ?? current, character: name, text: dlg[2].trim(), tone: emotionIn(s) }); return say(`${name} now says "${dlg[2].trim()}".`); }
  // accessories
  const acc = ACCS.find(a => new RegExp(`\\b${a}s?\\b`).test(low));
  if (acc && /\b(add|give|put|wear|wearing|with)\b/.test(low) && !/\bremove|take off|without\b/.test(low)) { ops.push({ op: 'add_accessory', character: who, accessory: acc }); return say(`${who ?? 'Everyone'} now wears ${acc}.`); }
  if (acc && /\b(remove|take off|without|no more|lose)\b/.test(low)) { ops.push({ op: 'remove_accessory', character: who, accessory: acc }); return say(`Removed ${acc}${who ? ` from ${who}` : ''}.`); }
  // rename / color
  const ren = s.match(/\brename\s+(\w[\w ]*?)\s+(?:to|as)\s+(\w[\w ]*)/i) ?? s.match(/\bcall\s+(\w+)\s+(\w+)\s+instead/i);
  if (ren) { ops.push({ op: 'rename_character', from: ren[1].trim(), to: ren[2].trim() }); return say(`Renamed ${ren[1]} to ${ren[2]}.`); }
  const colorM = low.match(/\b(red|blue|green|yellow|orange|purple|pink|white|black|cyan|teal|gold)\b/);
  if (colorM && /\b(colou?r|make .* (red|blue|green|yellow|orange|purple|pink|white|black|cyan|teal|gold))\b/.test(low) && who) {
    const map: Record<string, string> = { red: '#ff6b6b', blue: '#5aa9ff', green: '#3ddc97', yellow: '#facc15', orange: '#f5a524', purple: '#c084fc', pink: '#f472b6', white: '#f5f5f5', black: '#222222', cyan: '#22d3ee', teal: '#14b8a6', gold: '#f5c518' };
    ops.push({ op: 'set_color', character: who, color: map[colorM[1]] }); return say(`${who} is now ${colorM[1]}.`);
  }
  // emotion / expression swap: "look shocked instead of confused"
  const instead = low.match(/\b(?:look|be|seem|act|feel)\s+(\w+)\s+instead of\s+(\w+)/) ?? low.match(/\bchange\s+(\w+)\s+to\s+(\w+)/) ?? low.match(/\breplace\s+(\w+)\s+with\s+(\w+)/);
  if (instead) {
    const [a, b] = instead[0].startsWith('change') || instead[0].startsWith('replace') ? [instead[2], instead[1]] : [instead[1], instead[2]];
    const toE = emotionIn(a), fromE = emotionIn(b);
    const toA = normalizeAction(a) ?? (toE ? emotionAction(toE) : undefined), fromA = normalizeAction(b) ?? (fromE ? emotionAction(fromE) : undefined);
    if (toA && fromA) { ops.push({ op: 'replace_action', character: who, from: fromA, to: toA, emotion: toE, scene: scene ?? 'all' }); return say(`Replaced ${fromA} with ${toA}${who ? ` for ${who}` : ''}.`); }
  }
  const em = emotionIn(s);
  if (em && /\b(make|look|feel|be|seem|turn|become)\b/.test(low) && !/\bcamera\b/.test(low)) { ops.push({ op: 'set_emotion', character: who, emotion: em, scene: scene ?? current }); return say(`${who ?? 'Characters'} now look ${em}.`); }
  // funnier
  if (/\b(funnier|more comedic|more comedy|funny|hilarious|more dramatic|exaggerate|punchier)\b/.test(low)) { ops.push({ op: 'funnier', scene: scene === 'all' ? current : scene ?? current }); return say('Punched up the reaction: bigger gestures, comic sound effect and a camera shake.'); }
  // add action
  const actWord = (ACTIONS.map(a => a.name) as ActionName[]).find(a => new RegExp(`\\b${a.replace('_', ' ')}(s|es|ing)?\\b`).test(low)) ?? normalizeAction(low.match(/\b(make|have|let)\s+\w+\s+(\w+)/)?.[2]);
  if (actWord && /\b(make|have|let|add|then|should)\b/.test(low) && who) {
    const target = charIn(project, s.replace(new RegExp(who, 'i'), ''));
    ops.push({ op: 'add_action', scene: scene === 'all' ? current : scene ?? current, character: who, action: actWord, at: /\b(start|beginning|first)\b/.test(low) ? 'start' : 'end', target, emotion: em });
    return say(`${who} now ${actWord.replace('_', ' ')}s${target ? ` at ${target}` : ''} at the ${/\bstart|beginning|first\b/.test(low) ? 'start' : 'end'} of the scene.`);
  }
  // duration
  if (/\b(longer|shorter|extend|shorten|trim)\b/.test(low) || (/\bduration\b/.test(low) && numIn(s) !== undefined)) {
    const n = numIn(s); const longer = /\b(longer|extend)\b/.test(low);
    ops.push({ op: 'set_duration', scene: scene ?? current, duration: n !== undefined && /\bto\b/.test(low) ? n : undefined, factor: n !== undefined && !/\bto\b/.test(low) ? undefined : longer ? 1.3 : 0.8 });
    if (n !== undefined && !/\bto\b/.test(low)) (ops[0] as any).duration = undefined, (ops[0] as any).factor = undefined, (ops[0] as any).addSeconds = longer ? n : -n;
    return say(`Scene duration ${longer ? 'extended' : 'shortened'}.`);
  }
  // sfx
  const sfx = SFX_NAMES.find(n => low.includes(n.replace('_', ' '))) ?? (/\bthud|bang|boom\b/.test(low) ? 'impact' : /\bapplause\b/.test(low) ? 'cheer' : undefined);
  if (sfx && /\b(add|play|put|insert)\b/.test(low)) { ops.push({ op: 'add_sfx', scene: scene === 'all' ? current : scene ?? current, name: sfx, at: numIn(s) ?? 'impact' }); return say(`Added ${sfx} sound effect.`); }
  // subtitles / music
  if (/\bsubtitles?|captions?\b/.test(low)) { const on = !/\b(off|remove|hide|disable|no)\b/.test(low); ops.push({ op: 'set_subtitles', enabled: on }); return say(`Subtitles ${on ? 'enabled' : 'disabled'}.`); }
  if (/\bmusic|soundtrack\b/.test(low)) { const off = /\b(off|remove|mute|disable|no|silence)\b/.test(low); const track = low.includes('lo-fi') ? 'lofi' as const : (['inspiring', 'epic', 'sad', 'lofi', 'hype', 'upbeat', 'calm', 'comedy', 'tense'] as const).find(t => low.includes(t)); ops.push({ op: 'set_music', enabled: !off, track }); return say(off ? 'Music muted.' : `Music ${track ? `set to ${track}` : 'enabled'}.`); }
  // transitions
  const tr = (['cut', 'fade', 'slide', 'wipe', 'zoom'] as const).find(t => new RegExp(`\\b${t}\\b`).test(low));
  if (tr && /\btransition|between scenes\b/.test(low)) { ops.push({ op: 'set_transition', scene: scene ?? 'all', transition: tr }); return say(`Transitions set to ${tr}.`); }
  // remove character
  if (/\b(remove|delete|get rid of)\b/.test(low) && who) { ops.push({ op: 'remove_character', character: who, scene: scene ?? current }); return say(`Removed ${who} from the scene.`); }
  // titles
  const tt = s.match(/\b(?:opening|intro) title\s*(?:to|:)?\s*["“']?(.+?)["”']?$/i); if (tt) { ops.push({ op: 'set_title', opening: tt[1] }); return say('Opening title set.'); }
  const ct = s.match(/\b(?:closing|end(?:ing)?) title\s*(?:to|:)?\s*["“']?(.+?)["”']?$/i); if (ct) { ops.push({ op: 'set_title', closing: ct[1] }); return say('Closing title set.'); }
  return null;
}

function emotionAction(e: Emotion): ActionName { return ({ angry: 'angry', surprised: 'surprised', confused: 'confused', sad: 'cry', happy: 'laugh', scared: 'react', embarrassed: 'freeze', smug: 'nod', neutral: 'stand' } as Record<Emotion, ActionName>)[e]; }

// ───────────────────────────── Apply ops ─────────────────────────────

export function applyOps(project: Project, ops: EditOp[], current: number): Project {
  if (!project.scenes.length) return project;   // nothing to edit yet
  let p: Project = structuredClone(project);
  const sceneIdxs = (sel: number | 'all' | undefined) => sel === 'all' ? p.scenes.map((_, i) => i) : [Math.min(p.scenes.length - 1, Math.max(0, sel ?? current))];
  const charId = (name?: string) => name ? p.characters.find(c => c.name.toLowerCase() === name.toLowerCase() || c.id === name)?.id : undefined;
  const shiftAfter = (sc: Scene, from: number, by: number) => { for (const a of sc.actions) if (a.start >= from - 1e-6) a.start += by; for (const d of sc.dialogue) if (d.start >= from - 1e-6) d.start += by; for (const x of sc.sfx) if (x.start >= from - 1e-6) x.start += by; for (const t of sc.texts) if (t.start >= from - 1e-6) t.start += by; sc.duration = Math.max(1, sc.duration + by); if (sc.camera.startAt !== undefined && sc.camera.startAt >= from) sc.camera.startAt += by; };
  const endOf = (sc: Scene) => Math.max(0.3, ...sc.actions.map(a => a.start + a.duration), ...sc.dialogue.map(d => d.start + d.duration));

  for (const op of ops) {
    switch (op.op) {
      case 'set_speed': { const cid = charId(op.character); for (const i of sceneIdxs(op.scene)) for (const a of p.scenes[i].actions) { if (cid && a.characterId !== cid) continue; if (op.action && a.action !== op.action) continue; if (!op.action && !['walk', 'run', 'chase', 'sneak', 'talk', 'dance', 'enter', 'exit', 'fight', 'laugh'].includes(a.action)) continue; a.speed = Math.min(3, Math.max(0.3, (a.speed ?? 1) * op.factor)); if (['walk', 'run', 'chase', 'sneak', 'enter', 'exit'].includes(a.action)) { const nd = Math.max(0.4, a.duration / op.factor); const delta = nd - a.duration; a.duration = nd; shiftAfter(p.scenes[i], a.start + a.duration - delta - 1e-3, delta); } } break; }
      case 'set_background': for (const i of sceneIdxs(op.scene)) p.scenes[i].background = op.background; break;
      case 'insert_pause': { const sc = p.scenes[sceneIdxs(op.scene)[0]]; let at: number; if (op.at === 'start') at = 0; else if (op.at === 'end') at = endOf(sc); else if (op.at === 'before_last_dialogue') { const last = [...sc.dialogue].sort((a, b) => a.start - b.start).pop(); at = last ? last.start : endOf(sc); } else at = op.at; shiftAfter(sc, at, op.duration); break; }
      case 'set_camera': { const sc = p.scenes[sceneIdxs(op.scene)[0]]; if (op.shot) sc.camera.shot = op.shot; if (op.move) sc.camera.move = op.move; if (op.focus) sc.camera.focusCharacterId = charId(op.focus) ?? sc.camera.focusCharacterId; if (op.intensity !== undefined) sc.camera.intensity = op.intensity; if (typeof op.startAt === 'number') sc.camera.startAt = op.startAt; else if (op.startAt) { const clip = sc.actions.find(a => (a.emotion === op.startAt || a.action === op.startAt) && (!sc.camera.focusCharacterId || a.characterId === sc.camera.focusCharacterId)) ?? sc.actions.find(a => a.emotion === op.startAt || a.action === op.startAt); if (clip) { sc.camera.startAt = clip.start; sc.camera.focusCharacterId = clip.characterId; if (!op.move) sc.camera.move = 'zoom_in'; } } break; }
      case 'face_each_other': { const sc = p.scenes[sceneIdxs(op.scene)[0]]; const cs = sc.characters.filter(c => c.visible); if (cs.length >= 2) { const sorted = [...cs].sort((a, b) => a.x - b.x); sorted.forEach((c, i) => { c.facing = i < sorted.length / 2 ? 1 : -1; }); const t = endOf(sc); for (let i = 0; i < sorted.length; i++) { const other = sorted[i < sorted.length / 2 ? sorted.length - 1 : 0]; sc.actions.push({ id: uid('act'), characterId: sorted[i].characterId, action: 'look', start: Math.max(0, t - 1), duration: 1, targetId: other.characterId }); } } break; }
      case 'add_character': { const sc = p.scenes[sceneIdxs(op.scene)[0]]; let ch = p.characters.find(c => c.name.toLowerCase() === op.name.toLowerCase()); if (!ch) { ch = makeCharacter(op.name, p.characters.length, { accessories: op.accessories ?? [], color: op.color }); p.characters.push(ch); } if (!sc.characters.some(c => c.characterId === ch!.id)) { const x = sc.characters.length ? (sc.characters.reduce((a, c) => a + c.x, 0) / sc.characters.length < 0.5 ? 0.82 : 0.18) : 0.5; sc.characters.push({ characterId: ch.id, x, facing: x < 0.5 ? 1 : -1, visible: true }); const t = Math.min(endOf(sc), sc.duration - 2.5); sc.actions.push({ id: uid('act'), characterId: ch.id, action: 'enter', start: Math.max(0, t), duration: 2.2, toX: x }); sc.actions.push({ id: uid('act'), characterId: ch.id, action: 'wave', start: Math.max(0, t) + 2.3, duration: 1.5 }); if (sc.duration < t + 4.2) sc.duration = Math.round((t + 4.2) * 10) / 10; } break; }
      case 'replace_action': { const cid = charId(op.character); for (const i of sceneIdxs(op.scene)) for (const a of p.scenes[i].actions) if (a.action === op.from && (!cid || a.characterId === cid)) { a.action = op.to; if (op.emotion) a.emotion = op.emotion; } break; }
      case 'set_emotion': { const cid = charId(op.character); for (const i of sceneIdxs(op.scene)) { const sc = p.scenes[i]; for (const c of sc.characters) if (!cid || c.characterId === cid) c.initialEmotion = op.emotion; for (const a of sc.actions) if ((!cid || a.characterId === cid) && ['stand', 'talk', 'walk', 'look', 'nod', 'react', 'freeze', 'point'].includes(a.action)) a.emotion = op.emotion; for (const d of sc.dialogue) if (!cid || d.characterId === cid) d.tone = op.emotion; } break; }
      case 'add_action': { const sc = p.scenes[sceneIdxs(op.scene)[0]]; const cid = charId(op.character); if (!cid) break; if (!sc.characters.some(c => c.characterId === cid)) sc.characters.push({ characterId: cid, x: 0.5, facing: 1, visible: true }); const dur = op.duration ?? ACTIONS.find(a => a.name === op.action)!.defaultDuration; let start: number; if (op.at === 'start') { start = 0.3; shiftAfter(sc, 0, dur); start = 0.2; } else if (typeof op.at === 'number') start = op.at; else { start = endOf(sc); if (sc.duration < start + dur + 0.5) sc.duration = Math.round((start + dur + 0.6) * 10) / 10; } sc.actions.push({ id: uid('act'), characterId: cid, action: op.action, start, duration: dur, targetId: charId(op.target), emotion: op.emotion }); break; }
      case 'add_dialogue': { const sc = p.scenes[sceneIdxs(op.scene)[0]]; const cid = op.character.toLowerCase() === 'narrator' ? 'narrator' : charId(op.character); if (!cid) break; const dur = speechDuration(op.text, p.characters.find(c => c.id === cid)); const start = typeof op.at === 'number' ? op.at : endOf(sc); sc.dialogue.push({ id: uid('dlg'), characterId: cid, text: op.text, start, duration: dur, tone: op.tone, style: cid === 'narrator' ? 'subtitle' : 'bubble' }); if (sc.duration < start + dur + 0.5) sc.duration = Math.round((start + dur + 0.6) * 10) / 10; break; }
      case 'add_accessory': { const cid = charId(op.character); for (const c of p.characters) if ((!cid || c.id === cid) && !c.accessories.includes(op.accessory)) c.accessories.push(op.accessory); break; }
      case 'remove_accessory': { const cid = charId(op.character); for (const c of p.characters) if (!cid || c.id === cid) c.accessories = c.accessories.filter(a => a !== op.accessory); break; }
      case 'rename_character': { const c = p.characters.find(c => c.name.toLowerCase() === op.from.toLowerCase()); if (c) c.name = op.to; break; }
      case 'set_color': { const c = p.characters.find(c => c.id === charId(op.character)); if (c) c.color = op.color; break; }
      case 'set_duration': for (const i of sceneIdxs(op.scene)) { const sc = p.scenes[i]; const add = (op as any).addSeconds; if (op.duration) sc.duration = op.duration; else if (add) sc.duration = Math.max(1, sc.duration + add); else if (op.factor) sc.duration = Math.round(sc.duration * op.factor * 10) / 10; sc.duration = Math.max(sc.duration, Math.round((endOf(sc) + 0.3) * 10) / 10); } break;
      case 'add_sfx': { const sc = p.scenes[sceneIdxs(op.scene)[0]]; let at: number; if (typeof op.at === 'number') at = op.at; else if (op.at === 'end') at = endOf(sc) - 0.3; else { const imp = sc.actions.find(a => ['fall', 'slip', 'fight', 'jump', 'surprised', 'react'].includes(a.action)); at = imp ? imp.start + imp.duration * 0.6 : endOf(sc) - 0.3; } sc.sfx.push({ id: uid('sfx'), name: op.name, start: Math.max(0, at), volume: 1 }); if (op.text) sc.texts.push({ id: uid('txt'), kind: 'sfx_text', text: op.text, start: at, duration: 0.8, x: 0.5, y: 0.3, size: 1.5, color: '#ffe36b', animation: 'pop' }); break; }
      case 'set_subtitles': p.settings.subtitles.enabled = op.enabled; break;
      case 'set_music': if (op.enabled !== undefined) p.settings.audio.musicEnabled = op.enabled; if (op.track) { p.settings.audio.musicTrack = op.track; p.settings.audio.musicEnabled = true; } break;
      case 'funnier': { const sc = p.scenes[sceneIdxs(op.scene)[0]]; const reaction = [...sc.actions].reverse().find(a => ['react', 'surprised', 'laugh', 'fall', 'slip', 'angry', 'confused', 'freeze', 'cry'].includes(a.action)) ?? [...sc.actions].pop(); if (reaction) { reaction.intensity = Math.min(2, (reaction.intensity ?? 1) * 1.6); reaction.duration = Math.round(reaction.duration * 1.3 * 10) / 10; const t = reaction.start + reaction.duration * 0.5; sc.sfx.push({ id: uid('sfx'), name: reaction.action === 'laugh' ? 'laugh_track' : reaction.action === 'fall' || reaction.action === 'slip' ? 'crash' : 'boing', start: t, volume: 1 }); sc.texts.push({ id: uid('txt'), kind: 'sfx_text', text: reaction.action === 'laugh' ? 'HAHAHA!' : reaction.action === 'angry' ? 'GRRR!' : reaction.action === 'fall' || reaction.action === 'slip' ? 'CRASH!' : 'WHAT?!', start: t, duration: 1, x: 0.5, y: 0.3, size: 1.7, color: '#ffe36b', animation: 'shake' }); sc.camera = { ...sc.camera, move: 'zoom_in', focusCharacterId: reaction.characterId, startAt: reaction.start, intensity: 1.1 }; const others = sc.characters.filter(c => c.characterId !== reaction.characterId); for (const o of others) sc.actions.push({ id: uid('act'), characterId: o.characterId, action: 'laugh', start: t, duration: 1.6 }); if (sc.duration < reaction.start + reaction.duration + 1) sc.duration = Math.round((reaction.start + reaction.duration + 1) * 10) / 10; } break; }
      case 'remove_character': { const cid = charId(op.character); if (!cid) break; for (const i of sceneIdxs(op.scene)) { const sc = p.scenes[i]; sc.characters = sc.characters.filter(c => c.characterId !== cid); sc.actions = sc.actions.filter(a => a.characterId !== cid); sc.dialogue = sc.dialogue.filter(d => d.characterId !== cid); } break; }
      case 'set_transition': for (const i of sceneIdxs(op.scene)) p.scenes[i].transitionIn = op.transition; break;
      case 'set_title': if (op.opening !== undefined) p.settings.openingTitle = op.opening; if (op.closing !== undefined) p.settings.closingTitle = op.closing; break;
    }
  }
  p.scenes.forEach(fitSceneDuration);
  return p;
}
