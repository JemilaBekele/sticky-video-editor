// ───────────────────────────── Natural voice worker ─────────────────────────────
// Runs Piper neural text-to-speech off the main thread: espeak-ng phonemizer (WASM) → VITS model
// (ONNX runtime, WASM). Everything is loaded from /voices on this machine.
import * as ort from 'onnxruntime-web';

interface ModelConfig { audio: { sample_rate: number }; espeak: { voice: string }; inference: { noise_scale: number; length_scale: number; noise_w: number }; speaker_id_map: Record<string, number> }
export interface SynthRequest { id: number; text: string; model: string; speaker?: number; lengthScale?: number }
export type SynthResponse = { id: number; samples: Float32Array; sampleRate: number } | { id: number; error: string };

const RUNTIME = '/voices/runtime/';
ort.env.wasm.wasmPaths = RUNTIME;
ort.env.wasm.numThreads = (self as any).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

let phonemizerFactory: Promise<any> | null = null;
function loadPhonemizer() {
  // the phonemizer is an Emscripten script (not a module): evaluate it to get its factory
  phonemizerFactory ??= fetch(RUNTIME + 'piper_phonemize.js').then(r => r.text()).then(src => new Function(`${src}\nreturn createPiperPhonemize;`)());
  return phonemizerFactory;
}

async function phonemeIds(text: string, voice: string): Promise<number[]> {
  const create = await loadPhonemizer();
  return new Promise((resolve, reject) => {
    create({
      print: (line: string) => { try { resolve(JSON.parse(line).phoneme_ids); } catch (e) { reject(e); } },
      printErr: (line: string) => reject(new Error(line)),
      locateFile: (f: string) => RUNTIME + (f.endsWith('.wasm') ? 'piper_phonemize.wasm' : f.endsWith('.data') ? 'piper_phonemize.data' : f),
    }).then((m: any) => m.callMain(['-l', voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data'])).catch(reject);
  });
}

const models = new Map<string, Promise<{ session: ort.InferenceSession; config: ModelConfig }>>();
function loadModel(name: string) {
  if (!models.has(name)) models.set(name, (async () => {
    const [cfg, onnx] = await Promise.all([fetch(`/voices/${name}.onnx.json`), fetch(`/voices/${name}.onnx`)]);
    if (!cfg.ok || !onnx.ok) throw new Error(`voice ${name} is not installed`);
    return { config: await cfg.json() as ModelConfig, session: await ort.InferenceSession.create(await onnx.arrayBuffer()) };
  })());
  const p = models.get(name)!;
  p.catch(() => models.delete(name));
  return p;
}

async function synth(req: SynthRequest) {
  const { session, config } = await loadModel(req.model);
  const ids = await phonemeIds(req.text, config.espeak.voice);
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([config.inference.noise_scale, (req.lengthScale ?? 1) * config.inference.length_scale, config.inference.noise_w]), [3]),
  };
  if (Object.keys(config.speaker_id_map ?? {}).length) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(req.speaker ?? 0)]), [1]);
  const out = await session.run(feeds);
  return { samples: out.output.data as Float32Array, sampleRate: config.audio.sample_rate };
}

// one request at a time keeps memory flat and the order predictable
let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<SynthRequest>) => {
  const req = e.data;
  queue = queue.then(() => synth(req)
    .then(r => (self as any).postMessage({ id: req.id, ...r }, [r.samples.buffer]))
    .catch(err => self.postMessage({ id: req.id, error: String(err?.message ?? err) })));
};
