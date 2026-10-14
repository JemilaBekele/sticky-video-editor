// Copies the ffmpeg.wasm core into public/ so the browser can load it from the same origin.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/@ffmpeg/core/dist/esm/';
if (!existsSync(src)) process.exit(0);
mkdirSync('public/ffmpeg', { recursive: true });
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) copyFileSync(src + f, 'public/ffmpeg/' + f);
console.log('ffmpeg core copied to public/ffmpeg');
