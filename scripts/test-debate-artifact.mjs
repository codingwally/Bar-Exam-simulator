import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createTimer, timerDisplay } from '../worker/debate-domain.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = path.join(root, '.pages-dist');
const page = await readFile(path.join(artifact, 'debate-room/index.html'), 'utf8');
const home = await readFile(path.join(artifact, 'index.html'), 'utf8');
assert.match(page, /<title>Debate Room/);
assert.equal((home.match(/data-debate-room-entry/g) || []).length, 2, 'Separate desktop and mobile entries must ship.');
assert.match(home, /assets\/debate-entry\.js/);
assert.doesNotMatch(page, /(?:unpkg|cdn\.jsdelivr\.net).*supabase/);
assert.match(page, /supabase-2\.49\.8\.umd\.js/);
assert.doesNotMatch(page, /DEBATE_LOCAL_REHEARSAL\s*[:=]\s*true/);
for (const match of page.matchAll(/<script[^>]+src="([^"]+)"/g)) {
  const relative = match[1].split('?')[0];
  assert.ok(relative.startsWith('../'), 'Public Debate scripts must use reviewed local assets.');
  assert.ok((await stat(path.resolve(artifact, 'debate-room', relative))).isFile(), relative);
}
const client = await readFile(path.join(artifact, 'assets/debate-room.js'), 'utf8');
const css = await readFile(path.join(artifact, 'assets/debate-room.css'), 'utf8');
assert.doesNotMatch(css, /@import\b|https?:\/\//, 'Debate typography must not require an external stylesheet or font request.');
const fonts = JSON.parse(await readFile(path.join(root, 'assets/vendor/debate-fonts/manifest.json'), 'utf8'));
const cssFontPaths = [...new Set([...css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)].map(match => match[1].replace(/^\.\//, '')))].sort();
assert.deepEqual(cssFontPaths, fonts.fonts.map(font => 'vendor/debate-fonts/' + font.file).sort());
for (const font of fonts.fonts) {
  const bytes = await readFile(path.join(artifact, 'assets/vendor/debate-fonts', font.file));
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'wOF2');
  assert.equal(bytes.length, font.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), font.sha256, font.file);
}
for (const name of ['Fraunces.OFL.txt','Inter.OFL.txt']) assert.match(await readFile(path.join(artifact, 'assets/vendor/debate-fonts', name), 'utf8'), /SIL OPEN FONT LICENSE/);
for (const match of client.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
  const dependency = new URL(match[1], 'https://artifact.invalid/assets/debate-room.js');
  assert.equal(dependency.origin, 'https://artifact.invalid');
  assert.ok(dependency.pathname.startsWith('/assets/'), 'Browser imports must stay inside the public assets directory');
  assert.ok((await stat(path.join(artifact, dependency.pathname.slice(1)))).isFile(), match[1]);
}
assert.equal(await readFile(path.join(artifact, 'assets/debate-domain.js'), 'utf8'), (await readFile(path.join(root, 'worker/debate-domain.mjs'), 'utf8')).replace("'./debate-sanctions.mjs'", "'./debate-sanctions.js'"), 'Browser and server must use the same domain arithmetic, with only the browser module suffix changed.');
assert.equal(await readFile(path.join(artifact, 'assets/debate-sanctions.js'), 'utf8'), await readFile(path.join(root, 'worker/debate-sanctions.mjs'), 'utf8'), 'Sanctions arithmetic must remain identical in both environments.');
const clockDeclaration = client.match(/^const serverNow = .+;$/m)?.[0];
assert.ok(clockDeclaration, 'The deployed client clock projection must be testable.');
const projected = vm.runInNewContext(clockDeclaration + '; serverNow()', { state: { sync: { server: 1000.125, local: 0.25 } }, performance: { now: () => 0.75 } });
assert.ok(Number.isSafeInteger(projected), 'Fractional RTT/performance samples must not crash the shared timer.');
assert.equal(timerDisplay(createTimer({ matchId: 'artifact-test', stageAttemptId: 'attempt-test', durationMs: 300000 }, 0), projected).text, '05:00');
console.log('Debate artifact includes navigation, direct route, all local module dependencies, preserved Supabase SDK and shared domain arithmetic. No hosted or physical acceptance is inferred.');
