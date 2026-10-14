// ───────────────────────────── Generation orchestration ─────────────────────────────
import { type Project, type Scene, type Character, fitSceneDuration } from '../types';
import { availableVoices, speakNatural, voiceFor, rateFor, isNeural, CHARACTER_VOICE_ORDER, type VoiceClip } from '../engine/neural';
import { parseScriptRules } from '../parser/rules';
import { compilePlan, type StoryPlan } from '../parser/plan';
import { commit, getState, toast } from './store';

export interface GenerateResult { warnings: string[]; sceneCount: number }

function getPlan(script: string): { plan: StoryPlan; warnings: string[] } {
  const plan = parseScriptRules(script);
  if (!plan.scenes.length) throw new Error('Could not find any scenes in the script.');
  return { plan, warnings: plan.warnings ?? [] };
}

export type Progress = (text: string) => void;

/**
 * Generation waits on voice synthesis, so the user may open another project meanwhile. Results are only
 * ever applied to the project that started the work.
 */
function commitTo(projectId: string, fn: (p: Project) => Project) {
  if (getState().current?.id !== projectId) throw new Error('Another project was opened before generation finished, so nothing was changed.');
  commit(fn);
}

/** Keep the user's current characters (and any edits to them) and add the newly created ones. */
function mergeCharacters(current: Character[], generated: Character[]) {
  return [...current, ...generated.filter(g => !current.some(c => c.id === g.id))];
}

/** When a line becomes longer, push everything after it later so voices never overlap, and fit the scene. */
function makeRoomForLines(scene: Scene, changed: Set<string>): Scene {
  const s: Scene = { ...scene, actions: [...scene.actions], dialogue: [...scene.dialogue], texts: [...scene.texts], sfx: [...scene.sfx] };
  const lines = [...s.dialogue].sort((a, b) => a.start - b.start);
  for (let i = 0; i + 1 < lines.length; i++) {
    const cur = s.dialogue.find(d => d.id === lines[i].id)!, next = s.dialogue.find(d => d.id === lines[i + 1].id)!;
    const delta = cur.start + cur.duration + 0.1 - next.start;
    if (!changed.has(cur.id) || delta <= 0) continue;
    const from = next.start;
    const shift = <T extends { start: number }>(x: T): T => (x.start >= from - 1e-6 ? { ...x, start: Math.round((x.start + delta) * 100) / 100 } : x);
    s.actions = s.actions.map(shift); s.dialogue = s.dialogue.map(shift); s.texts = s.texts.map(shift); s.sfx = s.sfx.map(shift);
  }
  return fitSceneDuration(s);
}
const lineKey = (ch: Character | undefined, text: string) => `${ch?.id ?? 'narrator'}|${text}`;

/**
 * Compile with natural voices when they are installed: give new characters natural voices, speak every
 * line, then compile again so each line lasts exactly as long as its clip, and attach the clips.
 */
async function compileVoiced(plan: StoryPlan, existing: Character[], onProgress?: Progress, warnings: string[] = []) {
  const first = compilePlan(plan, existing);
  const voices = await availableVoices();
  if (!voices.length) return first;
  const have = new Set(voices.map(v => v.id)), order = CHARACTER_VOICE_ORDER.filter(id => have.has(id));
  const known = new Set(existing.map(c => c.id));
  let k = 0;
  const characters = first.characters.map(c => (known.has(c.id) && isNeural(c.voice)) || !order.length ? c : { ...c, voice: order[k++ % order.length] });
  const lines = first.scenes.flatMap(s => s.dialogue.map(d => ({ text: d.text, ch: characters.find(c => c.id === d.characterId) })));
  const clips = new Map<string, VoiceClip>();
  let failed = 0;
  for (const [i, l] of lines.entries()) {
    const voice = voiceFor(l.ch);
    if (!have.has(voice) || clips.has(lineKey(l.ch, l.text))) continue;
    onProgress?.(`Recording voices ${i + 1}/${lines.length}…`);
    try { clips.set(lineKey(l.ch, l.text), await speakNatural(l.text, voice, rateFor(l.ch))); } catch (e) { failed++; console.warn('voice failed', e); }
  }
  if (failed) warnings.push(`${failed} line${failed > 1 ? 's' : ''} could not be voiced naturally and use the built-in voice.`);
  const out = compilePlan(plan, characters, { durationOf: (text, ch) => { const c = clips.get(lineKey(ch, text)); return c && Math.round((c.duration + 0.25) * 10) / 10; } });
  for (const s of out.scenes) s.dialogue = s.dialogue.map(d => { const c = clips.get(lineKey(out.characters.find(x => x.id === d.characterId), d.text)); return c ? { ...d, audioUrl: c.url, audioSource: 'voice' as const } : d; });
  return out;
}

/** Build the whole project from the script. */
export async function generateProject(script: string, mode: Project['inputMode'], onProgress?: Progress): Promise<GenerateResult> {
  const st = getState();
  if (!st.current) throw new Error('No project open');
  const { plan, warnings } = getPlan(script);
  const projectId = st.current.id;
  const { characters, scenes, title } = await compileVoiced(plan, st.current.characters, onProgress, warnings);
  commitTo(projectId, p => ({ ...p, script, inputMode: mode, characters, scenes, name: p.name.startsWith('Animation ') && title ? title : p.name, analysis: { at: Date.now(), warnings } }));
  return { warnings, sceneCount: scenes.length };
}

/** Re-parse a single scene's source text (or a new description), leaving other scenes alone. */
export async function regenerateScene(index: number, description?: string, onProgress?: Progress): Promise<GenerateResult> {
  const st = getState();
  const p = st.current; if (!p) throw new Error('No project open');
  const scene = p.scenes[index];
  const text = (description ?? scene.sourceText ?? scene.title).trim();
  if (!text) throw new Error('This scene has no source text to regenerate from. Add a description.');
  const { plan, warnings } = getPlan(text);
  // keep known characters, collapse into one scene
  const merged: StoryPlan = { characters: [...p.characters.map(c => ({ name: c.name, accessories: c.accessories, color: c.color })), ...plan.characters.filter(c => !p.characters.some(x => x.name.toLowerCase() === c.name.toLowerCase()))], scenes: [{ ...plan.scenes[0], beats: plan.scenes.flatMap(s => s.beats), props: plan.scenes.flatMap(s => s.props ?? []), title: scene.title, background: plan.scenes[0].background ?? scene.background }] };
  const { characters, scenes } = await compileVoiced(merged, p.characters, onProgress, warnings);
  const fresh: Scene = { ...scenes[0], id: scene.id, title: scene.title, sourceText: text, transitionIn: scene.transitionIn };
  // replace the scene by id (it may have moved while voices were recorded) and keep character edits
  commitTo(p.id, prj => prj.scenes.some(s => s.id === scene.id) ? { ...prj, characters: mergeCharacters(prj.characters, characters), scenes: prj.scenes.map(s => s.id === scene.id ? fresh : s) } : prj);
  return { warnings, sceneCount: 1 };
}

export function reportGeneration(r: GenerateResult) {
  const scenes = `Generated ${r.sceneCount} scene${r.sceneCount === 1 ? '' : 's'}`;
  if (r.warnings.length) toast('info', `${scenes}. ${r.warnings.length} sentence${r.warnings.length > 1 ? 's were' : ' was'} not understood — ${r.warnings[0]}`);
  else toast('success', scenes);
}

export const SAMPLE_SCRIPT = `TITLE: THE BROKE MILLIONAIRE

SCENE 1:
A stickman walks confidently down the street wearing sunglasses.

NARRATOR:
"Meet John. He tells everyone he is a millionaire."

JOHN:
"I'm basically a billionaire."

SCENE 2:
John enters a shop and picks up an expensive phone.

SHOPKEEPER:
"That will be fifty thousand."

John reaches into his pocket and realizes he has no money.

JOHN:
"I forgot my wallet."

SCENE 3:
John slowly attempts to sneak out of the shop.

SHOPKEEPER:
"Sir, the door is behind you."

John freezes in embarrassment.`;

export const SAMPLE_PROMPT = `Two stickmen are arguing. One gets angry, points at the other, and walks away. The second stickman laughs, slips on a banana peel, and falls to the ground.`;

export const SAMPLE_IDEA = `A nervous student has to give a presentation in class but keeps forgetting the words. The teacher is unimpressed. In the end the student accidentally does a dance move and the whole class cheers.`;

export const SAMPLE_MOTIVATION = `TITLE: NEVER GIVE UP

SCENE 1: 5 AM
The alarm rings. A stickman wakes up.
NARRATOR: While the world sleeps, he is already up.

SCENE 2: The gym
He does push-ups.
NARRATOR: Nobody sees the hours you put in.
He lifts weights.

SCENE 3: The fall
It is raining. He falls to his knees.
NARRATOR: Some days you will want to quit.

SCENE 4: The climb
He climbs the stairs.
NARRATOR: But every step counts. Every single one.

SCENE 5: The summit
He reaches the summit and celebrates.
NARRATOR: So get up. Your story is not over.`;

/**
 * Give lines natural-voice clips without regenerating the scenes: every line without audio, and with
 * `characterId`, also that character's earlier natural-voice clips (after their voice changed).
 * Returns how many lines were voiced.
 */
export async function voiceLines(opts: { characterId?: string } = {}, onProgress?: Progress): Promise<number> {
  const p = getState().current; if (!p) return 0;
  const have = new Set((await availableVoices()).map(v => v.id));
  if (!have.size) throw new Error('Natural voices are not installed. Run `npm run voices` once, then restart the app.');
  const todo = p.scenes.flatMap(s => s.dialogue.filter(d => !d.audioUrl || (d.audioSource === 'voice' && opts.characterId && d.characterId === opts.characterId)));
  const done = new Map<string, { clip: VoiceClip; text: string }>();
  let failed = 0;
  for (const [i, d] of todo.entries()) {
    const ch = p.characters.find(c => c.id === d.characterId), voice = voiceFor(ch);
    if (!have.has(voice)) continue;
    onProgress?.(`Recording voices ${i + 1}/${todo.length}…`);
    // one bad line must not throw away the clips already recorded
    try { done.set(d.id, { clip: await speakNatural(d.text, voice, rateFor(ch)), text: d.text }); } catch (e) { failed++; console.warn('voice failed', e); }
  }
  if (done.size) commitTo(p.id, prj => ({ ...prj, scenes: prj.scenes.map(s => {
    const changed = new Set<string>();
    // skip lines whose text was edited while their voice was being recorded
    const dialogue = s.dialogue.map(d => { const r = done.get(d.id); if (!r || r.text !== d.text) return d; changed.add(d.id); return { ...d, audioUrl: r.clip.url, audioSource: 'voice' as const, duration: Math.round((r.clip.duration + 0.25) * 10) / 10 }; });
    return changed.size ? makeRoomForLines({ ...s, dialogue }, changed) : s;
  }) }));
  if (failed) toast('error', `${failed} line${failed > 1 ? 's' : ''} could not be voiced and keep the built-in voice.`);
  return done.size;
}
