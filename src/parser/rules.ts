// ───────────────────────────── Rule-based script parser ─────────────────────────────
// Deterministic fallback that works offline. Understands screenplay-style scripts
// (SCENE headers, NAME: dialogue) as well as plain prose prompts.

import type { ActionName, Emotion, BackgroundId, PropType, Accessory } from '../types';
import type { StoryPlan, PlanScene, Beat } from './plan';

const BG_KEYWORDS: [RegExp, BackgroundId][] = [
  [/\b(gym|workout|work(s|ing)? out|weights|dumbbells?|barbell|push-?ups?|treadmill)\b/i, 'gym'],
  [/\b(classroom|class|lesson|lecture)\b/i, 'classroom'], [/\b(school|campus|playground)\b/i, 'school'], [/\b(office|desk|meeting|boss|cubicle|work)\b/i, 'office'],
  [/\b(bedroom|bed|sleep|wakes? up|morning alarm)\b/i, 'bedroom'], [/\b(restaurant|cafe|café|diner|waiter|menu|dinner|lunch)\b/i, 'restaurant'],
  [/\b(shop|store|mall|cashier|shopkeeper|buy|buys|counter)\b/i, 'shop'], [/\b(stage|awards?|ceremony|podium|spotlight|trophy)\b/i, 'stage'], [/\b(stadium|match|game|football|soccer|race|arena|crowd)\b/i, 'stadium'],
  [/\b(mountain|summit|peak|top of the (hill|world))\b/i, 'mountain'], [/\b(stairs|staircase|steps)\b/i, 'stairs'], [/\b(sunrise|dawn|sun rises|5 ?am|early morning)\b/i, 'sunrise'],
  [/\b(rain|raining|rainy|storm|thunder)\b/i, 'rain'], [/\b(alone|lonely|midnight|late at night|in the dark)\b/i, 'night'], [/\b(road|journey|highway|long path)\b/i, 'road'],
  [/\b(park|bench|picnic|grass|garden)\b/i, 'park'], [/\b(city|downtown|skyline|night|rooftop)\b/i, 'city'], [/\b(street|sidewalk|outside|walks? down)\b/i, 'street'],
  [/\b(hill|field|countryside|landscape|forest|nature|sunset|beach)\b/i, 'landscape'],
];

const PROP_KEYWORDS: [RegExp, PropType][] = [
  [/\b(phones?|smartphone|mobile|iphone)\b/i, 'phone'], [/\b(laptop|computer|pc|monitor)\b/i, 'computer'], [/\b(tables?|desk)\b/i, 'table'], [/\b(chairs?|seat|stool)\b/i, 'chair'],
  [/\b(doors?|doorway)\b/i, 'door'], [/\b(windows?)\b/i, 'window'], [/\b(bags?|backpack|suitcase|briefcase)\b/i, 'bag'], [/\b(books?|notebook)\b/i, 'book'], [/\b(cars?|taxi|vehicle)\b/i, 'car'],
  [/\b(box(es)?|package|parcel|crate)\b/i, 'box'], [/\b(money|cash|dollars?|coins?|bills?|fifty thousand|payment)\b/i, 'money'], [/\b(banana( peel)?)\b/i, 'banana'], [/\b(cup|coffee|tea|mug|drink)\b/i, 'cup'],
  [/\b(balls?|football|basketball)\b/i, 'ball'], [/\b(sign|signboard|poster)\b/i, 'sign'], [/\b(trees?)\b/i, 'tree'], [/\b(lamp|light post|streetlight)\b/i, 'lamp'], [/\b(wallet|purse)\b/i, 'wallet'],
  [/\b(trophy|medal|prize|award)\b/i, 'trophy'], [/\b(dumbbells?|weights|barbell)\b/i, 'dumbbell'], [/\b(flag)\b/i, 'flag'], [/\b(alarm|clock)\b/i, 'clock'], [/\b(bed)\b/i, 'bed'], [/\b(podium)\b/i, 'podium'],
];

const ACCESSORY_KEYWORDS: [RegExp, Accessory][] = [
  [/\b(sunglasses|shades)\b/i, 'sunglasses'], [/\b(top hat|hat)\b/i, 'hat'], [/\bcap\b/i, 'cap'], [/\btie\b/i, 'tie'], [/\bbow\b/i, 'bow'], [/\b(crown|king|queen)\b/i, 'crown'], [/\b(glasses|spectacles)\b/i, 'glasses'], [/\bheadphones\b/i, 'headphones'], [/\bscarf\b/i, 'scarf'],
];

// Ordered: more specific phrases first.
const ACTION_PATTERNS: [RegExp, ActionName, Partial<{ emotion: Emotion; target: boolean; prop: boolean; duration: number }>][] = [
  [/\b(push-?ups?|press-?ups?)\b/i, 'pushup', { duration: 3 }],
  [/\b(lifts? (weights|the (dumbbells?|barbell|weights))|work(s|ing)? out|trains? hard|training hard|exercis(e|es|ing)|bench ?press(es)?)\b/i, 'lift', { duration: 3 }],
  [/\b(kneels?|kneeling|(falls?|drops?|sinks?) to (his|her|their) knees|on (his|her|their) knees)\b/i, 'kneel', { emotion: 'sad' }],
  [/\b(sleeps?|sleeping|asleep|naps?|goes? to (bed|sleep)|lies? down)\b/i, 'sleep', { duration: 3 }],
  [/\b(wakes? up|woke up)\b/i, 'getup', {}],
  [/\b(climbs?|climbing|climbed|scales?|(goes?|walks?|runs?) up (the )?(stairs|steps|mountain|hill))\b/i, 'climb', {}],
  [/\b(slips?|slipping|slipped|trips?|tripping|tripped|stumbles?|loses? (his|her|their) balance)\b/i, 'slip', {}],
  [/\b(falls?|falling|fell|collapses?|tumbles?|topples?|faints?|passes? out|crashes? (down|to the (ground|floor))|drops? to the (ground|floor)|(is |gets? )?knocked (down|over|out))\b/i, 'fall', {}],
  [/\b(gets? (back )?up|stands? (back )?up|rises?|picks? (him|her)self up)\b/i, 'getup', {}],
  [/\b(sneaks?|sneaking|tiptoes?|creeps?|crawls?|slinks?|slowly attempts? to (leave|sneak|walk)|tries? to sneak)\b/i, 'sneak', { duration: 3 }],
  [/\b(walks? (away|off|out)|runs? (away|off|out)|leaves?|leaving|exits?|storms? (off|out)|goes? (away|home|out)|heads? (out|off|home)|departs?|flees?|escapes?|disappears?|vanishes)\b/i, 'exit', {}],
  [/\b(enters?|entering|walks? (in|into)|runs? (in|into)|comes? (in|back|over)|arrives?|appears?|shows? up|returns?|steps? in|bursts? in)\b/i, 'enter', {}],
  [/\b(runs?|running|ran|sprints?|dashes?|rushes?|races?|bolts?|charges?|jogs?|hurries|hurry)\b/i, 'run', { target: true }],
  [/\b(chases?|chasing|chased|pursues?)\b/i, 'chase', { target: true }],
  [/\b(walks?|walking|walked|strolls?|strides?|wanders?|marches?|paces?|approaches|goes? (to|over|up)|heads? (to|toward|towards|over)|moves? (to|toward|towards|closer)|steps? (forward|closer|toward|towards)|follows?)\b/i, 'walk', { target: true }],
  [/\b(jumps?|jumping|leaps?|hops?|bounces?|skips?)\b/i, 'jump', {}],
  [/\b(sits?|sitting|sat|takes? a seat)\b/i, 'sit', {}],
  [/\b(waves?|waving|greets?|says? (hi|hello|goodbye|bye))\b/i, 'wave', { target: true }],
  [/\b(points?|pointing|pointed|gestures?)\b/i, 'point', { target: true }],
  [/\b(claps?|clapping|applauds?|high[- ]fives?)\b/i, 'clap', {}],
  [/\b(dances?|dancing|boogies?|grooves?|twirls?|moonwalks?)\b/i, 'dance', {}],
  [/\b(laughs?|laughing|giggles?|chuckles?|snickers?|cackles?|cracks? up|bursts? out laughing)\b/i, 'laugh', { emotion: 'happy' }],
  [/\b(cries|cry|crying|sobs?|weeps?|wails?|whimpers?|tears)\b/i, 'cry', { emotion: 'sad' }],
  [/\b(shocked|surprised|startled|amazed|gasps?|stunned|astonished|jaw drops?|eyes widen|can't believe|cannot believe|in disbelief)\b/i, 'surprised', { emotion: 'surprised' }],
  [/\b(confused|puzzled|scratches? (his|her|their) head|tilts? (his|her|their) head|baffled|bewildered|doesn't understand|looks? lost)\b/i, 'confused', { emotion: 'confused' }],
  [/\b(angry|angrily|furious|mad|rage|fumes?|stomps?|scolds?|shouts?|shouting|yells?|yelling|screams? at|snaps? at|loses? (his|her|their) temper)\b/i, 'angry', { emotion: 'angry', target: true }],
  [/\b(shakes? hands|handshake|hugs?|embraces?)\b/i, 'shake_hands', { target: true }],
  [/\b(fights?|fighting|punches|punch|hits?|slaps?|smacks?|kicks?|pushes|shoves?|tackles?|attacks?|wrestles?)\b/i, 'fight', { target: true, emotion: 'angry' }],
  [/\b(picks? up|grabs?|takes?|holds?|lifts?|carries|catches|collects?|steals?|snatches|reaches? for|pulls? out)\b/i, 'pickup', { prop: true }],
  [/\b((opens?|closes?|slams?) (the |a )?door|knocks?|rings? the (door)?bell)\b/i, 'open_door', {}],
  [/\b(turns? (around|back|away|left|right|to face)|spins? around|looks? back)\b/i, 'turn', {}],
  [/\b(celebrates?|cheers?|rejoices?|fist pumps?|pumps? (his|her|their) fist|victory|wins?|scores?|succeeds?|triumphant)\b/i, 'celebrate', { emotion: 'happy' }],
  [/\b(freezes?|frozen|stands? still|stops? (dead|moving)|goes? stiff|motionless|speechless|embarrass(ed|ment))\b/i, 'freeze', { emotion: 'embarrassed' }],
  [/\b(thinks?|thinking|ponders?|wonders?|considers?|reaches? into (his|her|their) pocket|checks? (his|her|their) pockets?|searches?|forgets?|forgetting|hesitates?|stammers?|stutters?|tries to remember)\b/i, 'think', { emotion: 'scared' }],
  [/\b(reads?|reading|writes?|writing|types?|typing|studies|studying|counts?|calculates?|decides?|works?|working)\b/i, 'think', {}],
  [/\b(unimpressed|bored|disappointed|disapproves?|frowns?|rolls? (his|her|their) eyes|groans?)\b/i, 'facepalm', { emotion: 'sad' }],
  [/\b(gives? a (presentation|speech|talk)|presents?|presenting|announces?|lectures?|reads? aloud)\b/i, 'talk', { duration: 2.5 }],
  [/\b(nods?|nodding|agrees?|accepts?|approves?|says? yes)\b/i, 'nod', {}],
  [/\b(shrugs?|shrugging|gives? up|doesn't (know|care))\b/i, 'shrug', { emotion: 'confused' }],
  [/\b(facepalms?|covers? (his|her|their) face|shakes? (his|her|their) head|sighs?|regrets?)\b/i, 'facepalm', {}],
  [/\b(realizes?|realises?|notices?|discovers?|finds? out|remembers?|sees?|spots?|hears?|flinches)\b/i, 'react', { emotion: 'surprised' }],
  [/\b(looks? (at|around|up|down|over)|stares? at|glares? at|watches|watching|glances? at|peeks?|observes?)\b/i, 'look', { target: true }],
  [/\b(talks?|talking|speaks?|speaking|says?|tells?|explains?|argu(es|ing)|chats?|discuss(es|ing)?|asks?|answers?|replies|responds?|whispers?|mutters?|calls? (out|to)|thanks?|apologi[sz]es|introduces|begs?|brags?|boasts?|complains?)\b/i, 'talk', { target: true }],
  [/\b(stands?|standing|waits?|waiting|poses?|stays?|remains?|leans?|rests?)\b/i, 'stand', {}],
];

const EMOTION_WORDS: [RegExp, Emotion][] = [
  [/\b(confident(ly)?|proud(ly)?|smug(ly)?|cocky|boasts?|brags?|shows? off)\b/i, 'smug'], [/\b(happy|happily|cheerful|excited|delighted|glad|pleased|thrilled|relieved|smiles?|smiling|grins?|joyful)\b/i, 'happy'],
  [/\b(sad|sadly|upset|disappointed|gloomy|miserable|unhappy|heartbroken|depressed|lonely)\b/i, 'sad'], [/\b(angry|angrily|furious|mad|annoyed|irritated|frustrated|grumpy|outraged|rage)\b/i, 'angry'],
  [/\b(shocked|surprised|stunned|amazed|astonished)\b/i, 'surprised'], [/\b(confused|puzzled|unsure|baffled)\b/i, 'confused'],
  [/\b(scared|afraid|nervous(ly)?|terrified|frightened|anxious|worried|trembl(es|ing)|panics?|panicked)\b/i, 'scared'], [/\b(embarrass(ed|ment)|ashamed|awkward(ly)?|blushes?|sheepish(ly)?)\b/i, 'embarrassed'],
];

const ROLE_NOUNS = /\b(shopkeeper|shop keeper|cashier|teacher|professor|student|boss|manager|waiter|waitress|doctor|nurse|police(man| officer)?|officer|cop|driver|customer|clerk|guard|chef|coach|referee|kid|child|mother|mom|father|dad|friend|stranger|neighbou?r|robber|thief|king|queen|hero|villain|salesman|barista|pilot)\b/i;
const GENERIC = /\b(stickman|stick man|stickmen|stick figure|man|woman|guy|girl|boy|person|character)\b/i;
const STOP_NAMES = new Set(['The', 'A', 'An', 'He', 'She', 'They', 'It', 'Then', 'Meanwhile', 'Later', 'Suddenly', 'Scene', 'Title', 'Narrator', 'Int', 'Ext', 'Cut', 'Fade', 'And', 'But', 'So', 'After', 'Before', 'When', 'While', 'His', 'Her', 'Their', 'One', 'Two', 'Three', 'First', 'Second', 'Third', 'Both', 'Everyone', 'Nobody', 'Someone', 'Sir', 'Mr', 'Mrs', 'Ms', 'Dr', 'Ok', 'Okay', 'Oh', 'Hey', 'Yes', 'No', 'I', 'You', 'We', 'Meet', 'This', 'That', 'There', 'Here', 'Now', 'Finally', 'Next', 'Also', 'Just']);

const CUE_STOP = /^(THE END|END|LATER|MEANWHILE|CUT TO|FADE (IN|OUT)|CONTINUED|INTERIOR|EXTERIOR|DAY|NIGHT)$/;
const NARRATOR_CUE = /^(NARRATOR|VOICE ?OVER|V\.O\.)$/i;
/** Screenplay cue: a short all-caps NAME alone on a line, with the dialogue on the next line. */
function cueName(line: string, next: string | undefined): string | undefined {
  const m = line.match(/^([A-Z][A-Z .'\-]{0,24}?)(?:\s*\(.*\))?$/);
  return m && next && !CUE_STOP.test(m[1].trim()) && m[1].trim().split(/\s+/).length <= 3 ? m[1].trim() : undefined;
}

interface Ctx {
  characters: Map<string, { name: string; accessories: Accessory[] }>; order: string[]; lastSubject?: string; genericCount: number;
  sentence?: number;                                 // which sentence is being read
  another?: { sentence: number; name: string };      // the "another stickman" created for it
}

export function parseScriptRules(text: string): StoryPlan {
  const ctx: Ctx = { characters: new Map(), order: [], genericCount: 0 };
  const warnings: string[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let title: string | undefined;
  const rawScenes: { title: string; lines: string[] }[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  let sawHeader = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (cur) cur.lines.push(''); continue; }
    const tm = line.match(/^(?:TITLE|Title)\s*[:\-]\s*(.+)$/); if (tm) { title = tm[1].trim().replace(/^["']|["']$/g, ''); continue; }
    const sm = line.match(/^(?:SCENE|Scene|INT\.|EXT\.|INT\/EXT\.)\s*([\w\s\d\-–—:.,']*)$/i) || line.match(/^#+\s*(.+)$/) || line.match(/^(?:SCENE|Scene)\s*\d+\s*[:\-–—.]?\s*(.*)$/i);
    if (sm && line.length < 70) {
      let title = (sm[1] ?? '').trim().replace(/^[:\-–—\s]+/, '').replace(/[:\-–—\s]+$/, '');
      const num = title.match(/^(\d+)\s*[:.\-–—]?\s*(.*)$/);
      if (num) title = num[2].trim() ? `Scene ${num[1]}: ${num[2].trim()}` : `Scene ${num[1]}`;
      if (!title) title = `Scene ${rawScenes.length + 1}`;
      cur = { title, lines: [] }; rawScenes.push(cur); sawHeader = true; continue;
    }
    if (!cur) { cur = { title: 'Scene 1', lines: [] }; rawScenes.push(cur); }
    cur.lines.push(line);
  }

  // Prose without scene headers: split into scenes by paragraph, or by sentence groups
  // only plain prose (no scene headers, no NAME: dialogue) is split into scenes automatically
  if (rawScenes.length === 1 && !sawHeader && !/^[A-Z][A-Za-z .'\-]{0,30}?\s*(?:\(.*?\))?\s*:/m.test(text)) {
    const paras = rawScenes[0].lines.join('\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    let chunks: string[] = paras.length > 1 ? paras : splitSentences(paras[0] ?? '').reduce<string[][]>((acc, s, i) => { if (i % 2 === 0 || /^(then|later|meanwhile|suddenly|next|after|finally)\b/i.test(s)) acc.push([s]); else acc[acc.length - 1].push(s); return acc; }, []).map(g => g.join(' '));
    if (chunks.length > 8) { const merged: string[] = []; for (let i = 0; i < chunks.length; i += 2) merged.push([chunks[i], chunks[i + 1]].filter(Boolean).join(' ')); chunks = merged; }
    rawScenes.length = 0;
    chunks.forEach((c, i) => rawScenes.push({ title: `Scene ${i + 1}`, lines: [c] }));
  }

  // First pass: register named speakers so pronoun resolution can see them
  for (const s of rawScenes) for (const l of s.lines) { const m = l.match(/^([A-Z][A-Za-z .'\-]{0,30}?)\s*(?:\((.*?)\))?\s*:\s*(.*)$/); if (m && m[1].toUpperCase() !== 'NARRATOR' && m[1].toUpperCase() !== 'TITLE' && !/^SCENE/i.test(m[1])) ensureChar(ctx, m[1]); }
  for (const s of rawScenes) s.lines.forEach((l, i) => { const cue = cueName(l, s.lines[i + 1]); if (cue && !NARRATOR_CUE.test(cue)) ensureChar(ctx, cue); });

  const scenes: PlanScene[] = [];
  let lastBg: BackgroundId | undefined;
  for (const rs of rawScenes) {
    const beats: Beat[] = [];
    const props: PlanScene['props'] = [];
    const seenProps = new Set<PropType>();
    const sceneText = rs.lines.join('\n');
    let bg = detectBackground(sceneText) ?? detectBackground(rs.title);
    if (!bg) bg = lastBg ?? (scenes.length === 0 ? 'white' : undefined);
    lastBg = bg;
    let pendingSpeaker: string | null = null;
    let pendingTone: Emotion | undefined;

    for (let i = 0; i < rs.lines.length; i++) {
      let line = rs.lines[i];
      if (!line) continue;
      // THE END → closing card
      if (/^(the end|fin)[.!]*$/i.test(line)) { beats.push({ type: 'text', text: 'The End', kind: 'closing' }); continue; }
      // NAME alone on a line, dialogue on the next
      const cue: string | undefined = pendingSpeaker ? undefined : cueName(line, rs.lines[i + 1]);
      if (cue) {
        pendingSpeaker = NARRATOR_CUE.test(cue) ? 'NARRATOR' : ensureChar(ctx, cue);
        if (pendingSpeaker !== 'NARRATOR') ctx.lastSubject = pendingSpeaker;
        pendingTone = detectEmotion(line.match(/\((.*)\)/)?.[1] ?? '') ?? undefined;
        continue;
      }
      // (parenthetical) under a cue sets the tone; elsewhere it is a stage direction
      const paren = line.match(/^[(\[](.+?)[)\]]$/);
      if (paren && pendingSpeaker) { pendingTone = detectEmotion(paren[1]) ?? pendingTone; continue; }
      if (paren) line = paren[1];
      // NAME: dialogue  /  NAME (tone): dialogue  /  NAME:\n"dialogue"
      const dm = line.match(/^([A-Z][A-Za-z .'\-]{0,30}?)\s*(?:\((.*?)\))?\s*:\s*(.*)$/);
      if (dm) {
        const who = dm[1].trim(); const tone = detectEmotion(dm[2] ?? '') ?? undefined; const rest = dm[3].trim();
        if (/^(NARRATOR|VOICE ?OVER|V\.O\.)$/i.test(who)) { if (rest) beats.push({ type: 'dialogue', character: 'NARRATOR', text: clean(rest) }); else { pendingSpeaker = 'NARRATOR'; } continue; }
        const name = ensureChar(ctx, who); ctx.lastSubject = name;
        if (rest) beats.push({ type: 'dialogue', character: name, text: clean(rest), tone: tone ?? detectEmotion(rest) ?? undefined, style: /\(thinks?|thinking|to (him|her)self\)/i.test(line) ? 'thought' : 'bubble' });
        else { pendingSpeaker = name; pendingTone = tone; }
        continue;
      }
      if (pendingSpeaker) {
        const txt = clean(line);
        beats.push({ type: 'dialogue', character: pendingSpeaker, text: txt, tone: pendingTone ?? detectEmotion(txt) ?? undefined, style: pendingSpeaker === 'NARRATOR' ? 'subtitle' : 'bubble' });
        pendingSpeaker = null; pendingTone = undefined; continue;
      }
      // quoted speech inside prose: John says "..."
      const qm = line.match(/^(.*?)\b(says?|said|shouts?|yells?|whispers?|asks?|replies|replied|exclaims?|screams?)\b[^"“]*["“](.+?)["”]/i);
      if (qm) {
        const subj = findSubject(ctx, qm[1]) ?? ctx.lastSubject;
        if (subj) { const tone = /shout|yell|scream/i.test(qm[2]) ? 'angry' : detectEmotion(qm[3]) ?? undefined; beats.push({ type: 'dialogue', character: subj, text: clean(qm[3]), tone, style: 'bubble' }); }
      }
      else {
        // quote first: "Hello," says John.
        const qf = line.match(/^["“](.+?)["”],?\s*(.*)$/);
        const subj = qf ? (qf[2] ? findSubject(ctx, qf[2]) : ctx.lastSubject) : undefined;
        if (qf && subj) { ctx.lastSubject = subj; beats.push({ type: 'dialogue', character: subj, text: clean(qf[1]).replace(/,$/, ''), tone: /shout|yell|scream/i.test(qf[2]) ? 'angry' : detectEmotion(qf[1]) ?? undefined, style: 'bubble' }); continue; }
      }
      // action sentences
      for (const sentence of splitSentences(line.replace(/["“][^"”]*["”]/g, ''))) {
        ctx.sentence = (ctx.sentence ?? 0) + 1;
        for (const [re, type] of PROP_KEYWORDS) if (re.test(sentence) && !seenProps.has(type)) { seenProps.add(type); props.push({ type, near: findSubject(ctx, sentence) ?? ctx.lastSubject }); }
        // a sentence that only sets the scene ("It is raining.") is understood too
        const understood = extractActions(ctx, sentence, beats) || !!detectBackground(sentence) || PROP_KEYWORDS.some(([re]) => re.test(sentence));
        if (!understood && !qm && /[A-Za-z]{3}/.test(sentence)) warnings.push(`${rs.title}: could not understand “${sentence.length > 90 ? sentence.slice(0, 90) + '…' : sentence}”`);
      }
    }
    // scene-level fallbacks
    if (!beats.some(b => b.type === 'action')) {
      const who = beats.find(b => b.type === 'dialogue' && b.character !== 'NARRATOR') as any;
      if (who) beats.unshift({ type: 'action', character: who.character, action: 'stand', duration: 0.6 });
    }
    scenes.push({ title: rs.title, background: bg, props, beats, sourceText: sceneText });
  }
  if (!ctx.order.length) { // nothing recognised — create a single narrator-driven scene
    const name = ensureChar(ctx, 'Stickman');
    scenes.forEach(s => { s.beats.unshift({ type: 'action', character: name, action: 'wave' }); });
  }
  return { title, characters: ctx.order.map(n => ctx.characters.get(n)!), scenes, warnings };
}

function clean(s: string) { return s.replace(/^["“'‘]+|["”'’]+$/g, '').trim(); }
function splitSentences(s: string) { return s.split(/(?<=[.!?])\s+(?=[A-Z"“])|;\s+/).map(x => x.trim()).filter(Boolean); }
function detectBackground(s: string): BackgroundId | undefined { for (const [re, id] of BG_KEYWORDS) if (re.test(s)) return id; return undefined; }
function detectEmotion(s: string): Emotion | undefined { for (const [re, e] of EMOTION_WORDS) if (re.test(s)) return e; return undefined; }

function ensureChar(ctx: Ctx, rawName: string): string {
  let name = rawName.trim().replace(/\s+/g, ' ');
  name = name.split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  const key = name.toLowerCase();
  // "John" and "John Smith" are one person, but "Stickman" and "Stickman 2" are not
  const sameAs = (long: string, short: string) => long.startsWith(short + ' ') && !/^\d+$/.test(long.slice(short.length + 1));
  for (const [k, v] of ctx.characters) if (k === key || sameAs(k, key) || sameAs(key, k)) return v.name;
  ctx.characters.set(key, { name, accessories: [] }); ctx.order.push(key);
  return name;
}

/** Find which character a sentence is about. Handles names, roles, "one/the other", "the second stickman", pronouns. */
function findSubject(ctx: Ctx, full: string): string | undefined {
  // only the subject part of the clause (before prepositions) decides who acts
  const s = full.replace(/\s+\b(at|to|toward|towards|with|from|into|onto|on|for|behind|after|past|over)\b[\s\S]*$/i, '');
  // "Another stickman" is someone new, even though "stickman" matches an existing name
  if (/\b(another|a new|a second|a third) (stickman|stick man|stick figure|man|woman|guy|girl|boy|person|character)\b/i.test(s)) {
    // a sentence is read more than once (props, then actions): create the newcomer only once
    if (ctx.another && ctx.another.sentence === ctx.sentence) return ctx.another.name;
    ctx.genericCount++;
    const name = ensureChar(ctx, ctx.order.length === 0 ? 'Stickman' : `Stickman ${ctx.order.length + 1}`);
    if (ctx.sentence !== undefined) ctx.another = { sentence: ctx.sentence, name };
    return name;
  }
  // explicit names
  const names = [...ctx.characters.values()].map(c => c.name).sort((a, b) => b.length - a.length);
  // the name mentioned first is the one acting ("Bob follows Anna" → Bob)
  let first: string | undefined, firstAt = Infinity;
  for (const n of names) { const at = s.search(new RegExp(`\\b${escapeRe(n)}\\b`, 'i')); if (at >= 0 && at < firstAt) { first = n; firstAt = at; } }
  if (first) return first;
  // "two stickmen" → create two
  const two = s.match(/\b(two|2|both)\s+(stickmen|stick men|stick figures|men|people|friends|characters|guys)\b/i);
  if (two && ctx.order.length < 2) { ensureChar(ctx, 'Stickman 1'); ensureChar(ctx, 'Stickman 2'); return ctx.characters.get(ctx.order[0])!.name; }
  const three = s.match(/\b(three|3)\s+(stickmen|stick men|stick figures|men|people|friends|characters|guys)\b/i);
  if (three) { ensureChar(ctx, 'Stickman 1'); ensureChar(ctx, 'Stickman 2'); ensureChar(ctx, 'Stickman 3'); return ctx.characters.get(ctx.order[0])!.name; }
  if (/\b(the (first|1st)( one| stickman| man)?|one of them|^one\b)/i.test(s) && ctx.order[0]) return ctx.characters.get(ctx.order[0])!.name;
  if (/\b(the (second|2nd|other)( one| stickman| man| guy)?|the other one)\b/i.test(s)) { if (!ctx.order[1]) ensureChar(ctx, 'Stickman 2'); return ctx.characters.get(ctx.order[1])!.name; }
  if (/\b(the (third|3rd)( one| stickman| man| guy)?)\b/i.test(s)) { if (!ctx.order[2]) ensureChar(ctx, 'Stickman 3'); return ctx.characters.get(ctx.order[2])!.name; }
  const role = s.match(ROLE_NOUNS); if (role) return ensureChar(ctx, role[1].replace(/\s+/g, ' '));
  // Capitalized word that looks like a name (not sentence-initial stop word)
  const capMatches = [...s.matchAll(/\b([A-Z][a-z]{1,15})\b/g)].map(m => m[1]).filter(w => !STOP_NAMES.has(w));
  for (const w of capMatches) { if (/\b(is|was|slowly|tries|attempts?)\b/i.test(s) || ACTION_PATTERNS.some(([re]) => re.test(s))) return ensureChar(ctx, w); }
  const gen = s.match(GENERIC);
  if (gen && /\b(a|an|another|the)\s+(stickman|stick man|stick figure|man|woman|guy|girl|boy|person|character)\b/i.test(s)) {
    if (/\b(another|a (new|third|second))\b/i.test(s) || !ctx.order.length) { ctx.genericCount++; return ensureChar(ctx, ctx.order.length === 0 ? 'Stickman' : `Stickman ${ctx.order.length + 1}`); }
    return ctx.characters.get(ctx.order[0])!.name;
  }
  // "He lifts weights." before anyone is named: he is the story's stickman (or its only character)
  if (/\b(he|she|they|him|her|his|their)\b/i.test(s)) return ctx.lastSubject ?? (ctx.order.length === 0 ? ensureChar(ctx, 'Stickman') : ctx.order.length === 1 ? ctx.characters.get(ctx.order[0])!.name : undefined);
  return undefined;
}

function findTarget(ctx: Ctx, s: string, subject: string): string | undefined {
  const names = [...ctx.characters.values()].map(c => c.name).filter(n => n !== subject).sort((a, b) => b.length - a.length);
  const after = s.replace(new RegExp(`^.*?\\b${escapeRe(subject)}\\b`, 'i'), '');
  for (const n of names) if (new RegExp(`\\b${escapeRe(n)}\\b`, 'i').test(after)) return n;
  const cap = [...after.matchAll(/\b([A-Z][a-z]{1,15})\b/g)].map(m => m[1]).find(w => !STOP_NAMES.has(w));
  if (cap && /\b(toward|towards|at|to|with|after|past)\s+(?:the\s+)?([A-Z][a-z]+)/.test(after)) { const n = ensureChar(ctx, cap); if (n !== subject) return n; }
  if (/\b(the other|the second|him|her|them|each other|at the other)\b/i.test(after)) { const other = ctx.order.map(k => ctx.characters.get(k)!.name).find(n => n !== subject); if (other) return other; }
  const role = after.match(ROLE_NOUNS); if (role) { const n = ensureChar(ctx, role[1]); if (n !== subject) return n; }
  return undefined;
}

/** Returns false when nothing in the sentence could be turned into an action. */
function extractActions(ctx: Ctx, sentence: string, beats: Beat[]): boolean {
  let understood = false;
  // accessories: "wearing sunglasses"
  const subjForAcc = findSubject(ctx, sentence);
  if (/\b(wear(s|ing)?|puts? on|with (a |his |her )?)\b/i.test(sentence) && subjForAcc) {
    for (const [re, acc] of ACCESSORY_KEYWORDS) if (re.test(sentence)) { const c = ctx.characters.get(subjForAcc.toLowerCase()); if (c && !c.accessories.includes(acc)) c.accessories.push(acc); }
  }
  // split compound sentences on connectors to preserve order: "runs toward Mike, stops, points at him, and starts shouting"
  const clauses = sentence.split(/,\s*(?:and\s+|then\s+)?|\s+and then\s+|\s+then\s+|\s+and\s+(?=\w+s?\b)|\s+before\s+|\s+while\s+/i).map(c => c.trim()).filter(Boolean);
  let subject = subjForAcc ?? ctx.lastSubject;
  let clauseIdx = 0;
  for (const clause of clauses) {
    if (/\b(everyone|everybody|the whole (class|crowd|room|team)|the (class|crowd|audience|students|kids|people)|they all|both of them|both (stickmen|characters|of them)|all of them)\b/i.test(clause) && ctx.order.length) {
      const emotion = detectEmotion(clause);
      for (const [re, action, meta] of ACTION_PATTERNS) if (re.test(clause)) { for (const k of groupIn(ctx, beats)) beats.push({ type: 'action', character: ctx.characters.get(k)!.name, action, emotion: emotion ?? meta.emotion, simultaneous: k !== groupIn(ctx, beats)[0] }); understood = true; break; }
      clauseIdx++; continue;
    }
    const explicit = findSubject(ctx, clause);
    if (explicit) subject = explicit;
    if (!subject) { clauseIdx++; continue; }
    ctx.lastSubject = subject;
    const emotion = detectEmotion(clause);
    let matched = false;
    for (const [re, action, meta] of ACTION_PATTERNS) {
      if (!re.test(clause)) continue;
      matched = true;
      const beat: Beat = { type: 'action', character: subject, action, emotion: emotion ?? meta.emotion, duration: meta.duration };
      if (meta.target) { const t = findTarget(ctx, clause, subject); if (t) beat.target = t; }
      if (meta.prop || action === 'pickup') { for (const [pre, type] of PROP_KEYWORDS) if (pre.test(clause)) { beat.prop = type; break; } }
      if (action === 'exit' && /\b(door)\b/i.test(clause)) beats.push({ type: 'action', character: subject, action: 'open_door', duration: 1.2 });
      if (/\b(fast|quickly|hurriedly|rapidly)\b/i.test(clause)) beat.speed = 1.5;
      if (/\b(slowly|carefully|gently)\b/i.test(clause)) beat.speed = 0.7;
      if (/\b(very|extremely|really|so)\b/i.test(clause)) beat.intensity = 1.4;
      if (/\bwhile\b|\bas (he|she|they)\b/i.test(clause) && beats.length) beat.simultaneous = true;
      // "slips ... and falls" → the slip already ends on the ground; drop the redundant fall
      const prev = [...beats].reverse().find(b => b.type === 'action' && b.character === subject) as any;
      // "goes to bed and falls asleep" is one sleep, not two
      if (prev && prev.action === beat.action && ['sleep', 'sit', 'kneel'].includes(beat.action)) break;
      if (beat.action === 'fall' && prev && (prev.action === 'slip' || prev.action === 'fall')) break;
      if (beat.action === 'slip' && prev && prev.action === 'fall') { prev.action = 'slip'; break; }
      beats.push(beat);
      // 'starts shouting' → angry + talk
      if (action === 'angry' && /\b(shout|yell|scream)/i.test(clause)) beats.push({ type: 'action', character: subject, action: 'talk', emotion: 'angry', duration: 1.5, simultaneous: false });
      if (/\b(stops?)\b/i.test(clause) && action !== 'stand') { /* stop is implicit at the end of locomotion */ }
      break;
    }
    if (matched) understood = true;
    else {
      const before = beats.length;
      if (/\bstops?\b/i.test(clause)) beats.push({ type: 'action', character: subject, action: 'stand', duration: 0.6, emotion });
      else if (emotion) beats.push({ type: 'action', character: subject, action: emotion === 'angry' ? 'angry' : emotion === 'surprised' ? 'surprised' : emotion === 'confused' ? 'confused' : emotion === 'sad' ? 'cry' : emotion === 'happy' ? 'nod' : emotion === 'embarrassed' ? 'freeze' : emotion === 'scared' ? 'react' : 'stand', emotion, duration: 1.5 });
      else if (/\bhas no (money|cash)|empty|nothing\b/i.test(clause)) beats.push({ type: 'action', character: subject, action: 'react', emotion: 'surprised' });
      if (beats.length > before) understood = true;
    }
    clauseIdx++;
  }
  return understood;
}

/** "Everyone" means the characters already in this scene (or everyone, if the scene has no one yet). */
function groupIn(ctx: Ctx, beats: Beat[]): string[] {
  const here = new Set(beats.flatMap(b => (b.type === 'action' || b.type === 'dialogue') && b.character !== 'NARRATOR' ? [b.character.toLowerCase()] : []));
  const keys = ctx.order.filter(k => here.has(ctx.characters.get(k)!.name.toLowerCase()));
  return keys.length ? keys : ctx.order;
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
