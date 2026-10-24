import test from 'node:test';
import assert from 'node:assert/strict';
import { countdownText, ServerClock, saveSummary, toMillis, ExamApp, activityBatch, activityDetails } from '../public/student.mjs';

test('scheduled countdown is continuous at every required early-arrival interval', () => {
  for (const [seconds, expected] of [[172800, '2 days 00:00:00'], [7200, '02:00:00'], [1200, '00:20:00'], [360, '00:06:00'], [240, '00:04:00'], [30, '00:00:30']]) assert.equal(countdownText(seconds * 1000), expected);
});
test('practice timer shows minutes and seconds and stops at zero', () => { assert.equal(countdownText(299000, true), '04:59'); assert.equal(countdownText(-1000, true), '00:00'); assert.equal(countdownText(0), '00:00:00'); });
test('server clock supports epoch milliseconds and ISO without using a changed device clock', () => {
  let tick = 10; const clock = new ServerClock(() => tick); const epoch = 1792814400000;
  clock.set(epoch); tick += 2500; assert.equal(clock.now(), epoch + 2500);
  clock.set(new Date(epoch).toISOString()); tick += 500; assert.equal(clock.now(), epoch + 500); assert.equal(toMillis(epoch), epoch);
});
test('clock bounds network latency compensation', () => { const clock = new ServerClock(() => 0); clock.set(100000, 40000); assert.equal(clock.now(), 102000); });
test('honest save status never says server saved while a draft is pending', () => {
  const store = { durable: true, pending: () => [{}], state: { answers: { Q1: { savedAt: 1000 } } } };
  assert.match(saveSummary(store, false, () => '12:00:00').text, /not yet synced/);
  store.pending = () => []; assert.match(saveSummary(store, true, () => '12:00:00').text, /Saved to server at 12:00:00 PHT/);
  store.durable = false; assert.match(saveSummary(store, true, () => '').text, /storage is unavailable/);
});
test('visual timer expiry checks server state and cannot request an early manual submission', () => {
  let checks = 0;
  const app = { state: { exam: { status: 'OPEN' } }, clock: { now: () => 101 }, deadline: () => 100, root: { querySelectorAll: () => [] }, screen: 'exam', closedLocally: false, updateWritable() {}, updateSave() {}, record() {}, refresh: () => { checks++; return Promise.resolve(); }, submit() { throw new Error('A client timer must not manually submit'); } };
  ExamApp.prototype.tick.call(app); assert.equal(checks, 1); assert.equal(app.closedLocally, true);
});
test('HTTP fetch retains the global receiver required by browser fetch', async () => {
  const app = new ExamApp({}, { slug: 'practice', fetcher: function () { assert.equal(this, globalThis); return Promise.resolve(new Response(JSON.stringify({ serverTime: 1792814400000 }))); } });
  const result = await app.request(); assert.equal(result.serverTime, 1792814400000);
});
test('long queued clipboard records use bounded UTF-8 batches without truncating exact contents', () => {
  const text = '漢字'.repeat(60000);
  const queue = Array.from({ length: 12 }, (_, i) => ({ eventId: `event-${i}`, category: 'paste', questionId: 'Q1', clientTime: new Date().toISOString(), detail: { pastedText: text }, provenance: 'browser-observed' }));
  const batch = activityBatch(queue); assert.ok(batch.length < queue.length); assert.ok(new TextEncoder().encode(JSON.stringify({ events: batch })).byteLength < 900000);
  assert.equal(batch[0].details.pastedText, text); assert.equal(queue.length, 12);
});
test('oversized clipboard content is exactly reconstructable from ordered bounded Unicode-safe parts', () => {
  const text = '\u0000\n"\\漢字😀'.repeat(35000);
  for (const [type, field] of [['copy', 'selectedText'], ['cut', 'selectedText'], ['paste', 'pastedText']]) {
    const parts = activityDetails(type, { [field]: text, readable: true }, () => 'synthetic-group');
    assert.ok(parts.length > 1); assert.equal(parts.map(part => part[field]).join(''), text);
    assert.ok(parts.every((part, index) => part.groupId === 'synthetic-group' && part.part === index + 1 && part.parts === parts.length && part.originalCharacters === text.length && JSON.stringify(part).length < 220000));
    assert.ok(parts.every(part => !/[\uD800-\uDBFF]$/.test(part[field])));
  }
});
