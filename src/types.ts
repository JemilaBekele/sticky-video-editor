// ───────────────────────────── Core data model ─────────────────────────────
// Everything the engine renders is derived deterministically from a Project.

export type ActionName =
  | 'stand' | 'walk' | 'run' | 'jump' | 'sit' | 'fall' | 'getup' | 'wave' | 'point' | 'clap'
  | 'dance' | 'laugh' | 'cry' | 'surprised' | 'confused' | 'angry' | 'talk' | 'shake_hands'
  | 'chase' | 'fight' | 'pickup' | 'open_door' | 'turn' | 'celebrate' | 'react' | 'sneak'
  | 'freeze' | 'slip' | 'think' | 'nod' | 'shrug' | 'facepalm' | 'enter' | 'exit' | 'look'
  | 'pushup' | 'lift' | 'kneel' | 'sleep' | 'climb';

export type Emotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'confused' | 'scared' | 'smug' | 'embarrassed';

export type BackgroundId =
  | 'white' | 'black' | 'office' | 'bedroom' | 'classroom' | 'restaurant' | 'street' | 'park'
  | 'school' | 'shop' | 'city' | 'stadium' | 'landscape'
  | 'gym' | 'mountain' | 'stairs' | 'sunrise' | 'night' | 'rain' | 'stage' | 'road' | 'custom';

export type PropType =
  | 'table' | 'chair' | 'door' | 'window' | 'phone' | 'computer' | 'bag' | 'book' | 'car'
  | 'box' | 'money' | 'banana' | 'cup' | 'ball' | 'sign' | 'tree' | 'lamp' | 'wallet'
  | 'trophy' | 'dumbbell' | 'flag' | 'clock' | 'bed' | 'podium';

export type CameraShot = 'wide' | 'medium' | 'closeup';
export type CameraMove = 'static' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'track';
export type Transition = 'cut' | 'fade' | 'slide' | 'wipe' | 'zoom';
export type SfxName = 'footsteps' | 'door' | 'impact' | 'boing' | 'whoosh' | 'laugh_track' | 'slip' | 'ding' | 'crash' | 'gasp' | 'cheer' | 'none';
export type Accessory = 'sunglasses' | 'hat' | 'tie' | 'bow' | 'crown' | 'glasses' | 'headphones' | 'cap' | 'scarf';

export interface Character {
  id: string;
  name: string;
  color: string;          // stroke color
  headColor?: string;     // optional fill
  lineWidth: number;      // 2..10
  scale: number;          // 0.6..1.6
  proportions: { headRadius: number; torso: number; upperArm: number; lowerArm: number; upperLeg: number; lowerLeg: number };
  face: boolean;
  accessories: Accessory[];
  voice: string;          // built-in voice id (see engine/voice.ts)
  pitch: number;          // voice pitch multiplier 0.5..2
}

export interface ActionClip {
  id: string;
  characterId: string;
  action: ActionName;
  start: number;          // seconds, relative to scene start
  duration: number;       // seconds
  // Movement target in scene coordinates (x 0..1 across stage, y is depth row -0.1..0.1)
  toX?: number;
  targetId?: string;      // another character or prop to face / interact with
  propId?: string;        // prop to pick up / carry
  emotion?: Emotion;
  speed?: number;         // multiplier
  intensity?: number;     // 0..2
  facing?: 1 | -1;
}

export interface DialogueLine {
  id: string;
  characterId: string | 'narrator';
  text: string;
  start: number;          // seconds, relative to scene start
  duration: number;
  tone?: Emotion;
  style: 'subtitle' | 'bubble' | 'thought';
  audioUrl?: string;      // generated / recorded / imported audio (data URL)
  audioSource?: 'voice' | 'recorded' | 'imported';   // 'voice' clips are regenerated when the voice changes
}

export interface SfxCue { id: string; name: SfxName; start: number; volume: number }

export interface SceneCharacter {
  characterId: string;
  x: number;              // 0..1 stage position at scene start
  facing: 1 | -1;
  visible: boolean;
  initialEmotion?: Emotion;
  startsAs?: 'lying' | 'sitting';   // asleep / seated when the scene opens
}

export interface SceneProp {
  id: string;
  type: PropType;
  x: number;              // 0..1
  y: number;              // 0..1 (0 = floor line), vertical offset
  scale: number;
  label?: string;
}

export interface CameraPlan {
  shot: CameraShot;
  move: CameraMove;
  focusCharacterId?: string;   // for track / zoom target
  startAt?: number;            // seconds when the move starts (zoom etc.)
  intensity?: number;          // 0..1
}

export interface TextOverlay {
  id: string;
  kind: 'title' | 'caption' | 'sfx_text' | 'closing';
  text: string;
  start: number;
  duration: number;
  x: number; y: number;        // 0..1
  size: number;
  color: string;
  animation: 'none' | 'pop' | 'slide' | 'typewriter' | 'shake';
}

export interface Scene {
  id: string;
  title: string;
  duration: number;
  background: BackgroundId;
  customBackgroundUrl?: string;
  characters: SceneCharacter[];
  props: SceneProp[];
  actions: ActionClip[];
  dialogue: DialogueLine[];
  sfx: SfxCue[];
  texts: TextOverlay[];
  camera: CameraPlan;
  transitionIn: Transition;
  notes?: string;
  sourceText?: string;        // raw script fragment that produced this scene
}

export interface SubtitleStyle {
  font: string;
  size: number;
  color: string;
  outline: string;
  outlineWidth: number;
  position: 'bottom' | 'top' | 'center';
  animation: 'none' | 'pop' | 'fade' | 'typewriter' | 'words';
  showNames: boolean;
  enabled: boolean;
}

export interface AudioSettings {
  voiceEnabled: boolean;
  sfxEnabled: boolean;
  musicEnabled: boolean;
  musicTrack: 'none' | 'upbeat' | 'calm' | 'comedy' | 'tense' | 'inspiring' | 'epic' | 'sad' | 'lofi' | 'hype';
  masterVolume: number;
  voiceVolume: number;
  sfxVolume: number;
  musicVolume: number;
  fadeIn: number;
  fadeOut: number;
  importedMusicUrl?: string;
}

export type AspectPreset = 'landscape' | 'portrait' | 'square';

export interface ProjectSettings {
  aspect: AspectPreset;
  fps: 24 | 30 | 60;
  subtitles: SubtitleStyle;
  audio: AudioSettings;
  openingTitle?: string;
  closingTitle?: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  script: string;
  inputMode: 'prompt' | 'script' | 'idea';
  characters: Character[];
  scenes: Scene[];
  settings: ProjectSettings;
  thumbnail?: string;           // data URL
  analysis?: { at: number; warnings: string[] };
}

export interface AppSettings {
  theme: 'dark';
  autoplayPreview: boolean;
  defaultAspect: AspectPreset;
  defaultFps: 24 | 30 | 60;
  previewQuality: 'low' | 'high';
}

export const ASPECT_SIZES: Record<AspectPreset, { w: number; h: number; label: string }> = {
  landscape: { w: 1920, h: 1080, label: '1920 × 1080 (16:9)' },
  portrait: { w: 1080, h: 1920, label: '1080 × 1920 (9:16)' },
  square: { w: 1080, h: 1080, label: '1080 × 1080 (1:1)' },
};

export const BACKGROUNDS: { id: BackgroundId; label: string }[] = [
  { id: 'white', label: 'White' }, { id: 'black', label: 'Black' }, { id: 'office', label: 'Office' },
  { id: 'bedroom', label: 'Bedroom' }, { id: 'classroom', label: 'Classroom' }, { id: 'restaurant', label: 'Restaurant' },
  { id: 'street', label: 'Street' }, { id: 'park', label: 'Park' }, { id: 'school', label: 'School' },
  { id: 'shop', label: 'Shop' }, { id: 'city', label: 'City' }, { id: 'stadium', label: 'Stadium' },
  { id: 'landscape', label: 'Outdoor landscape' }, { id: 'gym', label: 'Gym' }, { id: 'mountain', label: 'Mountain summit' },
  { id: 'stairs', label: 'Stairs' }, { id: 'sunrise', label: 'Sunrise' }, { id: 'night', label: 'Lonely night' }, { id: 'rain', label: 'Rain' },
  { id: 'stage', label: 'Award stage' }, { id: 'road', label: 'Long road' }, { id: 'custom', label: 'Custom image' },
];

export const PROP_TYPES: PropType[] = ['table', 'chair', 'door', 'window', 'phone', 'computer', 'bag', 'book', 'car', 'box', 'money', 'banana', 'cup', 'ball', 'sign', 'tree', 'lamp', 'wallet', 'trophy', 'dumbbell', 'flag', 'clock', 'bed', 'podium'];

export const ACTIONS: { name: ActionName; label: string; defaultDuration: number; moves?: boolean }[] = [
  { name: 'stand', label: 'Stand', defaultDuration: 2 },
  { name: 'walk', label: 'Walk', defaultDuration: 3, moves: true },
  { name: 'run', label: 'Run', defaultDuration: 2, moves: true },
  { name: 'jump', label: 'Jump', defaultDuration: 1.2 },
  { name: 'sit', label: 'Sit', defaultDuration: 2.5 },
  { name: 'fall', label: 'Fall', defaultDuration: 1.4 },
  { name: 'getup', label: 'Get up', defaultDuration: 1.5 },
  { name: 'wave', label: 'Wave', defaultDuration: 1.8 },
  { name: 'point', label: 'Point', defaultDuration: 1.8 },
  { name: 'clap', label: 'Clap', defaultDuration: 1.8 },
  { name: 'dance', label: 'Dance', defaultDuration: 3 },
  { name: 'laugh', label: 'Laugh', defaultDuration: 2.2 },
  { name: 'cry', label: 'Cry', defaultDuration: 2.5 },
  { name: 'surprised', label: 'Surprised', defaultDuration: 1.5 },
  { name: 'confused', label: 'Confused', defaultDuration: 2 },
  { name: 'angry', label: 'Angry', defaultDuration: 2 },
  { name: 'talk', label: 'Talk', defaultDuration: 2 },
  { name: 'shake_hands', label: 'Shake hands', defaultDuration: 2 },
  { name: 'chase', label: 'Chase', defaultDuration: 2.5, moves: true },
  { name: 'fight', label: 'Cartoon fight', defaultDuration: 2.5 },
  { name: 'pickup', label: 'Pick up object', defaultDuration: 1.6 },
  { name: 'open_door', label: 'Open door', defaultDuration: 1.6 },
  { name: 'turn', label: 'Turn around', defaultDuration: 0.8 },
  { name: 'celebrate', label: 'Celebrate', defaultDuration: 2.2 },
  { name: 'react', label: 'React', defaultDuration: 1.4 },
  { name: 'sneak', label: 'Sneak', defaultDuration: 3, moves: true },
  { name: 'freeze', label: 'Freeze', defaultDuration: 1.5 },
  { name: 'slip', label: 'Slip & fall', defaultDuration: 1.6 },
  { name: 'think', label: 'Think', defaultDuration: 2 },
  { name: 'nod', label: 'Nod', defaultDuration: 1.2 },
  { name: 'shrug', label: 'Shrug', defaultDuration: 1.4 },
  { name: 'facepalm', label: 'Facepalm', defaultDuration: 1.6 },
  { name: 'enter', label: 'Enter scene', defaultDuration: 2.5, moves: true },
  { name: 'exit', label: 'Exit scene', defaultDuration: 2.5, moves: true },
  { name: 'look', label: 'Look at', defaultDuration: 1 },
  { name: 'pushup', label: 'Push-ups', defaultDuration: 3 },
  { name: 'lift', label: 'Lift weights', defaultDuration: 3 },
  { name: 'kneel', label: 'Kneel down', defaultDuration: 2 },
  { name: 'sleep', label: 'Sleep', defaultDuration: 3 },
  { name: 'climb', label: 'Climb', defaultDuration: 3, moves: true },
];

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;

export const DEFAULT_SUBTITLES: SubtitleStyle = {
  font: 'Inter, system-ui, sans-serif', size: 1, color: '#ffffff', outline: '#000000', outlineWidth: 4,
  position: 'bottom', animation: 'pop', showNames: true, enabled: true,
};

export const DEFAULT_AUDIO: AudioSettings = {
  voiceEnabled: true, sfxEnabled: true, musicEnabled: true, musicTrack: 'comedy',
  masterVolume: 0.9, voiceVolume: 1, sfxVolume: 0.8, musicVolume: 0.25, fadeIn: 0.5, fadeOut: 1,
};

export function defaultSettings(aspect: AspectPreset = 'landscape', fps: 24 | 30 | 60 = 30): ProjectSettings {
  return { aspect, fps, subtitles: { ...DEFAULT_SUBTITLES }, audio: { ...DEFAULT_AUDIO } };
}

const PALETTE = ['#f5a524', '#5aa9ff', '#3ddc97', '#ff6b6b', '#c084fc', '#f472b6', '#facc15', '#22d3ee'];

export function makeCharacter(name: string, index = 0, partial: Partial<Character> = {}): Character {
  return {
    id: uid('chr'),
    name,
    color: PALETTE[index % PALETTE.length],
    lineWidth: 5,
    scale: 1,
    proportions: { headRadius: 0.11, torso: 0.3, upperArm: 0.17, lowerArm: 0.16, upperLeg: 0.2, lowerLeg: 0.2 },
    face: true,
    accessories: [],
    voice: ['classic', 'deep', 'bright', 'stuffy', 'elf', 'granny'][index % 6],
    pitch: [1, 0.8, 1.2, 0.7, 1.4, 0.9][index % 6],
    ...Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined)),
  };
}

export function makeScene(title: string, partial: Partial<Scene> = {}): Scene {
  return {
    id: uid('scn'), title, duration: 5, background: 'white', characters: [], props: [], actions: [],
    dialogue: [], sfx: [], texts: [], camera: { shot: 'wide', move: 'static' }, transitionIn: 'fade', ...partial,
  };
}

export function makeProject(name = 'Untitled animation', settings?: ProjectSettings): Project {
  const now = Date.now();
  return { id: uid('prj'), name, createdAt: now, updatedAt: now, script: '', inputMode: 'prompt', characters: [], scenes: [], settings: settings ?? defaultSettings() };
}

/** Lengthen a scene so no clip, line or caption runs past its end (they would be cut off). */
export function fitSceneDuration(s: Scene): Scene {
  const end = Math.max(0, ...s.actions.map(a => a.start + a.duration), ...s.dialogue.map(d => d.start + d.duration), ...s.texts.map(x => x.start + x.duration), ...s.sfx.map(x => x.start + 0.3));
  if (end + 0.3 > s.duration) s.duration = Math.round((end + 0.3) * 10) / 10;
  return s;
}

export function projectDuration(p: Project) { return p.scenes.reduce((a, s) => a + s.duration, 0); }

export function sceneStartTimes(p: Project): number[] {
  const out: number[] = []; let t = 0;
  for (const s of p.scenes) { out.push(t); t += s.duration; }
  return out;
}

export function locateScene(p: Project, time: number): { index: number; local: number } {
  let t = 0;
  for (let i = 0; i < p.scenes.length; i++) {
    const d = p.scenes[i].duration;
    if (time < t + d || i === p.scenes.length - 1) return { index: i, local: Math.min(Math.max(0, time - t), d) };
    t += d;
  }
  return { index: 0, local: 0 };
}
