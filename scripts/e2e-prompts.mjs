// Checks the rule-based parser on prose prompts and renders mid-scene frames for visual review.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:8787';
const OUT = process.env.OUT_DIR || 'e2e-out'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));

const PROMPTS = [
  ['banana', 'Two stickmen are arguing. One gets angry, points at the other, and walks away. The second stickman laughs, slips on a banana peel, and falls to the ground.'],
  ['chase', 'John runs toward Mike, stops, points at him, and starts shouting. Mike is confused and shrugs. Then John chases Mike out of the park.'],
  ['idea', 'A nervous student has to give a presentation in class but keeps forgetting the words. The teacher is unimpressed. In the end the student accidentally does a dance move and the whole class cheers.'],
];
const read = () => page.evaluate(() => { const last = localStorage.getItem('sticky-motion:last-open'); return JSON.parse(localStorage.getItem('sticky-motion:project:' + last)); });

for (const [name, text] of PROMPTS) {
  await page.goto(BASE); await page.waitForSelector('text=Create New Animation');
  await page.click('text=Create New Animation'); await page.waitForSelector('textarea');
  await page.fill('textarea', text);
  await page.click('text=Generate Animation');
  await page.waitForSelector('text=Open in editor', { timeout: 20000 }); await page.waitForTimeout(1500);
  const p = await read();
  console.log(`\n== ${name} ==`);
  console.log('characters:', p.characters.map(c => c.name).join(', '));
  for (const s of p.scenes) {
    const who = id => p.characters.find(c => c.id === id)?.name ?? 'narrator';
    console.log(`  [${s.title}] ${s.duration}s bg=${s.background} cam=${s.camera.shot}/${s.camera.move} props=${s.props.map(x => x.type).join(',') || '-'}`);
    for (const a of [...s.actions].sort((a, b) => a.start - b.start)) console.log(`     ${a.start.toFixed(1)}s ${who(a.characterId)} → ${a.action}${a.targetId ? ' @' + (who(a.targetId) !== 'narrator' ? who(a.targetId) : s.props.find(x => x.id === a.targetId)?.type) : ''}${a.emotion ? ' (' + a.emotion + ')' : ''}`);
    for (const d of s.dialogue) console.log(`     ${d.start.toFixed(1)}s ${who(d.characterId)}: "${d.text}"`);
  }
  // render a few frames straight from the engine for visual review
  await page.click('text=Open in editor'); await page.waitForSelector('canvas');
  const total = p.scenes.reduce((a, s) => a + s.duration, 0);
  const times = [0.25, 0.5, 0.75, 0.9].map(f => Math.round(total * f * 10) / 10);
  for (const t of times) {
    const slider = await page.$('input[type=range][step="0.01"]'); await slider.fill(String(t)); await page.waitForTimeout(250);
    const data = await page.$eval('canvas', c => c.toDataURL('image/png'));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${OUT}/frame-${name}-${t}s.png`, Buffer.from(data.split(',')[1], 'base64'));
  }
}
await browser.close();
