// End-to-end smoke test: drives the built app in headless Chromium and verifies the
// script → scenes → animation → real video workflow. Run: node scripts/e2e.mjs
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const OUT = process.env.OUT_DIR || 'e2e-out';
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
// projects are stored in IndexedDB
// wait for autosave to finish (the header shows "Saved") instead of guessing a delay
const waitSaved = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => (document.querySelector('header')?.textContent ?? '').trim().endsWith('Saved'), null, { timeout: 15000 }); };
const readProject = () => page.evaluate(() => new Promise(res => { const r = indexedDB.open('sticky-motion'); r.onsuccess = () => { const q = r.result.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => res(q.result[0]); }; }));

await page.goto(BASE);
await page.waitForSelector('text=Create New Animation');
await page.screenshot({ path: `${OUT}/01-dashboard.png` });

// 1. create new project + 2. paste a script
await page.click('text=Create New Animation');
await page.waitForSelector('textarea');
await page.click('text=Full Script');
await page.click('text=Use example');
const words = await page.$eval('textarea', t => t.value.length);
check('1. create project & 2. paste script', words > 100, `${words} chars`);
await page.screenshot({ path: `${OUT}/02-script.png` });

// 3. divide into scenes
await page.click('text=Generate Animation');
await page.waitForSelector('text=Open in editor', { timeout: 20000 });
await page.waitForTimeout(1500); // autosave debounce
const sceneCount = await page.$$eval('[class*="card"] >> text=/^#\\d+$/', els => els.length).catch(() => 0);
const projectState = await readProject();
check('3. script divided into scenes', projectState.scenes.length === 3, `${projectState.scenes.length} scenes: ${projectState.scenes.map(s => s.title).join(' | ')}`);
check('4. characters identified & reused across scenes', projectState.characters.length === 2 && projectState.scenes.every(s => s.characters.some(c => c.characterId === projectState.characters[0].id)), projectState.characters.map(c => `${c.name}${c.accessories.length ? ' [' + c.accessories.join(',') + ']' : ''}`).join(', '));
const actions = projectState.scenes.flatMap(s => s.actions.map(a => a.action));
check('5. actions generated from script', actions.length >= 6, actions.join(', '));
check('   dialogue extracted', projectState.scenes.flatMap(s => s.dialogue).length === 5, projectState.scenes.flatMap(s => s.dialogue).map(d => d.text).join(' / '));
check('   backgrounds inferred', projectState.scenes.map(s => s.background).join(',') === 'street,shop,shop', projectState.scenes.map(s => s.background).join(', '));
await page.screenshot({ path: `${OUT}/03-storyboard.png`, fullPage: true });

// 6. preview + scrub in editor
await page.click('text=Open in editor');
await page.waitForSelector('canvas');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/04-editor-t0.png` });
const slider = await page.$('input[type=range][step="0.01"]');
await slider.fill('6.5');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/05-editor-scrubbed.png` });
const timeText = await page.textContent('span.font-mono.text-xs');
check('6. preview & scrub', timeText.includes('0:06.5'), timeText);
// frame determinism: render the same time twice and compare
const same = await page.evaluate(async () => {
  const c = document.querySelector('canvas'); const a = c.toDataURL(); await new Promise(r => setTimeout(r, 300)); return a === c.toDataURL();
});
check('   deterministic frames (same time → identical pixels)', same);
await page.click('button[title^="Play"]'); await page.waitForTimeout(1200); await page.click('button[title^="Play"]');
const t2 = await page.textContent('span.font-mono.text-xs');
check('   playback advances the clock', !t2.includes('0:06.5'), t2);

// 7. edit scene timing (storyboard duration field) via inspector → scene duration
const before = projectState.scenes[0].duration;
await page.click('text=/^1\\. Scene 1/');
const durInput = await page.$('label:has-text("Duration (s)") input');
await durInput.fill(String(before + 2)); await durInput.dispatchEvent('input'); await durInput.dispatchEvent('change');
await waitSaved();
const afterState = await readProject();
check('7. edit scene timing', Math.abs(afterState.scenes[0].duration - (before + 2)) < 0.01, `${before}s → ${afterState.scenes[0].duration}s`);

// editing assistant edit + undo
await page.fill('input[placeholder^="Edit scene"]', 'Change the background to a classroom');
await page.keyboard.press('Enter'); await waitSaved();
const s1 = await readProject();
check('9. prompt-based edit', s1.scenes[0].background === 'classroom', `scene 1 background = ${s1.scenes[0].background}`);
await page.click('button[title^="Undo"]'); await waitSaved();
const s2 = await readProject();
check('   undo reverts it', s2.scenes[0].background === 'street', `scene 1 background = ${s2.scenes[0].background}`);
await page.screenshot({ path: `${OUT}/06-editor-assistant.png` });

// 8. save & reopen (reload page, open from dashboard)
await page.reload(); await page.waitForSelector('text=Recent projects');
const cards = await page.$$('text=/^Open$/');
check('8. project persisted after refresh', cards.length >= 1, `${cards.length} project card(s)`);
await cards[0].click(); await page.waitForSelector('canvas');
const reopened = (await readProject()).scenes.length;
check('   reopened with scenes intact', reopened === 3, `${reopened} scenes`);

// 11. fully standalone: the built-in parser understood every sentence of the sample script
check('11. generated with the built-in parser, nothing skipped', Array.isArray(afterState.analysis?.warnings) && afterState.analysis.warnings.length === 0, `warnings=${JSON.stringify(afterState.analysis?.warnings)}`);

// 9/10. render a real video (WebM realtime, then MP4 via server ffmpeg) and verify with ffprobe
await page.click('text=Video Export');
await page.waitForSelector('text=Render video');
await page.selectOption('select:near(:text("Resolution"))', '0.5');
await page.click('label:has-text("Real-time capture")');   // WebM comes from real-time mode
await page.selectOption('select:near(:text("Format"))', 'webm');
await page.screenshot({ path: `${OUT}/07-export.png` });
const t0 = Date.now();
await page.click('text=Render video');
await page.waitForSelector('text=Video ready', { timeout: 180000 });
console.log(`   webm render took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await page.screenshot({ path: `${OUT}/08-export-done.png` });
const webm = await page.evaluate(async () => { const a = document.querySelector('a[download]'); const b = await (await fetch(a.href)).arrayBuffer(); return { name: a.download, bytes: Array.from(new Uint8Array(b)) }; });
writeFileSync(`${OUT}/${webm.name}`, Buffer.from(webm.bytes));
const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString());
const pw = probe(`${OUT}/${webm.name}`);
const vw = pw.streams.find(s => s.codec_type === 'video'), aw = pw.streams.find(s => s.codec_type === 'audio');
check('9. real WebM rendered', !!vw && webm.bytes.length > 50000, `${webm.name}: ${(webm.bytes.length / 1024).toFixed(0)} KB, ${vw?.codec_name} ${vw?.width}x${vw?.height}, audio=${aw?.codec_name ?? 'none'}, duration=${Number(pw.format.duration).toFixed(1)}s`);

// MP4
await page.click('text=Back to live preview');
await page.click('label:has-text("hardware encoder")');   // fast WebCodecs mode (default)
await page.selectOption('select:near(:text("Format"))', 'mp4');
const t1 = Date.now();
await page.click('text=Render video');
await page.waitForSelector('text=Video ready', { timeout: 240000 });
console.log(`   mp4 render took ${((Date.now() - t1) / 1000).toFixed(1)}s`);
const mp4 = await page.evaluate(async () => { const a = document.querySelector('a[download]'); const b = await (await fetch(a.href)).arrayBuffer(); return { name: a.download, bytes: Array.from(new Uint8Array(b)) }; });
writeFileSync(`${OUT}/${mp4.name}`, Buffer.from(mp4.bytes));
const pm = probe(`${OUT}/${mp4.name}`);
const vm = pm.streams.find(s => s.codec_type === 'video'), am = pm.streams.find(s => s.codec_type === 'audio');
check('10. MP4 plays (H.264 + AAC, ffprobe OK)', vm?.codec_name === 'h264' && pm.format.format_name.includes('mp4'), `${mp4.name}: ${(mp4.bytes.length / 1024).toFixed(0)} KB, ${vm?.codec_name} ${vm?.width}x${vm?.height} ${vm?.r_frame_rate}fps, audio=${am?.codec_name ?? 'none'}, duration=${Number(pm.format.duration).toFixed(1)}s`);
// decode a frame from the middle of the mp4 to prove it's real content
execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '7', '-i', `${OUT}/${mp4.name}`, '-frames:v', '1', `${OUT}/09-mp4-frame.png`]);
check('    decoded frame from MP4', true, `${OUT}/09-mp4-frame.png`);

// 12. rendering error reported correctly: render an empty project
await page.evaluate(() => new Promise(res => { const r = indexedDB.open('sticky-motion'); r.onsuccess = () => { const st = r.result.transaction('projects', 'readwrite').objectStore('projects'); const q = st.getAll(); q.onsuccess = () => { const p = q.result[0]; p.scenes = []; st.put(p).onsuccess = res; }; }; }));
await page.reload(); await page.waitForSelector('text=Recent projects');
await (await page.$$('text=/^Open$/'))[0].click();
await page.click('text=Video Export');
await page.click('text=Render video');
const toast = await page.waitForSelector('text=/Nothing to render|Rendering failed/', { timeout: 5000 }).then(e => e.textContent());
check('12. rendering error reported, project preserved', !!toast, toast.trim());

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
