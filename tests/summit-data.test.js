// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maidenhead, preprocessSummits, createSummitDataset, SUMMIT_CSV_URL } from '../dist/summit-data.js';
import { lookupSummit } from '../dist/converter.js';
const csv = 'SOTA Summits List (Date=11/10/2026)\nSummitCode,SummitName,Longitude,Latitude,ValidTo\nG/XX-001,"Test, summit",-2.0059,51.9199,01/01/2000\n';
const response = (text = csv) => ({ ok: true, status: 200, text: async () => text, headers: { get: () => 'Sun, 11 Oct 2026 03:39:11 GMT' } });
const saved = () => ({ ...preprocessSummits(csv), lastModified: 'Sun, 11 Oct 2026 03:39:11 GMT' });
test('six-character locators use longitude first and floor cell boundaries', () => {
  assert.equal(maidenhead(51.9199, -2.0059), 'IO81XW');
  assert.equal(maidenhead(0, 0), 'JJ00AA');
  assert.equal(maidenhead(-90, -180), 'AA00AA');
  assert.equal(maidenhead(-0.000001, -0.000001), 'II99XX');
  assert.equal(maidenhead(89.9999, 179.9999), 'RR99XX');
  for (const [lat, lon] of [[90, 0], [0, 180], [NaN, 0], [0, Infinity]]) assert.throws(() => maidenhead(lat, lon));
});
test('CSV keeps quoted Unicode names and retired references; rejects corrupt replacements', () => {
  assert.deepEqual(preprocessSummits(csv).summits['G/XX-001'], ['Test, summit', 'IO81XW']);
  assert.equal(preprocessSummits(csv.replace('Test, summit', 'Tést, summit')).summits['G/XX-001'][0], 'Tést, summit');
  for (const text of ['', csv + 'G/XX-001,Duplicate,0,0,\n', csv.replace('-2.0059', 'bad'), csv.replace('Longitude', 'Wrong')]) assert.throws(() => preprocessSummits(text));
});
test('first download is deduplicated, stored as reduced data and looked up without API calls', async () => {
  let calls = 0; let stored;
  const dataset = createSummitDataset({ storage: { read: async () => null, write: async data => { stored = data; } }, fetcher: async url => { assert.equal(url, SUMMIT_CSV_URL); calls++; return response(); } });
  const [a, b] = await Promise.all([dataset.prepare(), dataset.prepare()]);
  assert.equal(a, b); assert.equal(calls, 1); assert.equal(stored, a);
  assert.deepEqual(await lookupSummit(' g/xx-001 ', a), { name: 'Test, summit', locator: 'IO81XW' });
  await assert.rejects(lookupSummit('G/XX-002', a), /not found/);
});
test('saved data is immediately usable while conditional update is pending', async () => {
  let finish; let options; let writes = 0;
  const previous = saved();
  const dataset = createSummitDataset({ storage: { read: async () => previous, write: async () => { writes++; } }, fetcher: async (url, value) => { options = value; return new Promise(resolve => { finish = resolve; }); } });
  assert.equal(await dataset.prepare(), previous);
  assert.equal(options.headers['If-Modified-Since'], previous.lastModified);
  finish({ status: 304 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(await dataset.prepare(), previous); assert.equal(writes, 0);
});
test('valid background replacement preserves the old snapshot', async () => {
  let stored; const old = saved();
  const dataset = createSummitDataset({ storage: { read: async () => old, write: async value => { stored = value; } }, fetcher: async () => response(csv.replace('Test, summit', 'New summit')) });
  const snapshot = await dataset.prepare();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await dataset.prepare()).summits['G/XX-001'][0], 'New summit');
  assert.equal(snapshot.summits['G/XX-001'][0], 'Test, summit'); assert.ok(stored);
});
test('offline and malformed updates retain saved data without overwriting storage', async () => {
  for (const fetcher of [async () => { throw Error('Offline'); }, async () => response('broken')]) {
    const old = saved(); let writes = 0;
    const dataset = createSummitDataset({ storage: { read: async () => old, write: async () => { writes++; } }, fetcher });
    assert.equal(await dataset.prepare(), old);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(await dataset.prepare(), old); assert.equal(writes, 0);
  }
});
test('failed initial download retries and broken storage still permits memory use', async () => {
  let calls = 0;
  const dataset = createSummitDataset({ storage: { read: async () => { throw Error('Blocked'); }, write: async () => { throw Error('Quota'); } }, fetcher: async () => { if (++calls === 1) throw Error('Offline'); return response(); } });
  await assert.rejects(dataset.prepare(), /Offline/);
  const data = await dataset.prepare(); assert.equal(calls, 2);
  assert.equal(await dataset.prepare(), data);
});
