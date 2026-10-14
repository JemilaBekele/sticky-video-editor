// Runs the API server and the Vite dev server together.
// Spawns node directly (not npx.cmd) so it works on Windows with modern Node.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(viteBin)) { console.error('vite is not installed — run `npm install` first.'); process.exit(1); }

const procs = [
  spawn(process.execPath, [path.join(root, 'server', 'index.mjs')], { stdio: 'inherit', env: process.env, cwd: root }),
  spawn(process.execPath, [viteBin], { stdio: 'inherit', env: process.env, cwd: root }),
];
const stop = () => { procs.forEach(p => { try { p.kill(); } catch {} }); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', code => { if (code && code !== 0) stop(); });
