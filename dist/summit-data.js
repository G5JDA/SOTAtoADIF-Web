// SPDX-License-Identifier: AGPL-3.0-or-later
import { parseCSV, validSummitRef, validLocator } from './converter.js';

export const SUMMIT_CSV_URL = 'https://storage.sota.org.uk/summitslist.csv';
const STORAGE_VERSION = 1;

// Longitude comes first in each pair: field letters, square digits, subsquare letters.
export function maidenhead(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude >= 90 || longitude < -180 || longitude >= 180) {
    throw new Error('Invalid summit coordinates');
  }
  let east = longitude + 180;
  let north = latitude + 90;
  const fieldColumn = Math.floor(east / 20);
  const fieldRow = Math.floor(north / 10);
  east -= fieldColumn * 20;
  north -= fieldRow * 10;
  const squareColumn = Math.floor(east / 2);
  const squareRow = Math.floor(north);
  east -= squareColumn * 2;
  north -= squareRow;
  const letter = index => String.fromCharCode(65 + index);
  return letter(fieldColumn) + letter(fieldRow) + squareColumn + squareRow +
    letter(Math.floor(east * 12)) + letter(Math.floor(north * 24));
}

// Keep retired summits: their coordinates are needed when converting historical logs.
export function preprocessSummits(text) {
  const rows = parseCSV(text);
  const date = /^SOTA Summits List \(Date=(\d{2}\/\d{2}\/\d{4})\)$/.exec(rows.shift()?.[0] || '');
  if (!date) throw new Error('Missing summit dataset date');
  const header = rows.shift() || [];
  const columns = ['SummitCode', 'SummitName', 'Longitude', 'Latitude'].map(name => header.indexOf(name));
  if (columns.some(index => index < 0)) throw new Error('Missing summit CSV columns');
  const summits = Object.create(null);
  for (const row of rows) {
    if (row.every(value => !value.trim())) continue;
    const [ref, name, longitude, latitude] = columns.map(index => row[index]?.trim());
    if (row.length !== header.length || !validSummitRef(ref || '') || !name ||
        !longitude || !latitude || Object.hasOwn(summits, ref.toUpperCase())) {
      throw new Error('Invalid or duplicate summit row');
    }
    summits[ref.toUpperCase()] = [name, maidenhead(Number(latitude), Number(longitude))];
  }
  if (!Object.keys(summits).length) throw new Error('Empty summit dataset');
  return { version: STORAGE_VERSION, date: date[1], summits };
}

function validateSaved(data) {
  if (data?.version !== STORAGE_VERSION || typeof data.date !== 'string' ||
      typeof data.lastModified !== 'string' || !data.summits || typeof data.summits !== 'object') return false;
  const entries = Object.entries(data.summits);
  return entries.length > 0 && entries.every(([ref, value]) =>
    validSummitRef(ref) && Array.isArray(value) && value.length === 2 &&
    typeof value[0] === 'string' && /^[A-R]{2}\d{2}[A-X]{2}$/.test(value[1]) && validLocator(value[1]));
}

// Store one compact JSON document atomically; never persist uploaded log content.
export function createDatasetStorage(indexedDB = globalThis.indexedDB) {
  let connection;
  function open() {
    if (!connection) connection = new Promise((resolve, reject) => {
      if (!indexedDB) return reject(new Error('Browser storage unavailable'));
      const request = indexedDB.open('sotatoadif-summits', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('datasets');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Browser storage blocked'));
    });
    return connection;
  }
  async function transact(mode, value) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('datasets', mode);
      const store = transaction.objectStore('datasets');
      const request = mode === 'readonly' ? store.get('current') : store.put(JSON.stringify(value), 'current');
      transaction.oncomplete = () => {
        try { resolve(mode === 'readonly' && request.result ? JSON.parse(request.result) : undefined); }
        catch (error) { reject(error); }
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Storage transaction aborted'));
    });
  }
  return { read: () => transact('readonly'), write: data => transact('readwrite', data) };
}

export function createSummitDataset({ fetcher = (...args) => globalThis.fetch(...args), storage = createDatasetStorage(), onStatus = () => {} } = {}) {
  let current;
  let initialization;
  async function refresh() {
    onStatus(current ? `Checking summit data (${current.date}) for updates…` : 'Downloading summit data (about 25 MB)…');
    try {
      const headers = current?.lastModified ? { 'If-Modified-Since': current.lastModified } : {};
      const response = await fetcher(SUMMIT_CSV_URL, {
        headers, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(120000)
      });
      if (response.status !== 304 || !current) {
        if (!response.ok) throw new Error('Summit download failed');
        const text = await response.text();
        onStatus('Preparing summit names and locators…');
        // Yield so the preparation status can paint before parsing the full CSV.
        await new Promise(resolve => setTimeout(resolve, 0));
        const replacement = preprocessSummits(text);
        replacement.lastModified = response.headers.get('Last-Modified') || '';
        current = replacement;
        try { await storage.write(replacement); }
        catch { onStatus(`Summit data (${current.date}) ready; could not save it on this device.`); return; }
      }
      onStatus(`Summit data (${current.date}) ready.`);
    } catch (error) {
      onStatus(current ? `Using saved summit data (${current.date}); update unavailable.` :
        'Summit download unavailable. Enter locators manually or retry conversion.');
      if (!current) throw error;
    }
  }
  async function prepare() {
    if (!initialization) initialization = (async () => {
      try { const saved = await storage.read(); if (validateSaved(saved)) current = saved; } catch { /* Use memory if storage is unavailable or corrupt. */ }
      const update = refresh();
      // Existing data is usable immediately while the update runs in the background.
      if (current) { update.catch(() => {}); return; }
      await update;
    })().catch(error => { initialization = undefined; throw error; });
    await initialization;
    return current;
  }
  return { prepare };
}

export const summitDataset = createSummitDataset({
  onStatus: message => {
    const status = globalThis.document?.getElementById('datasetStatus');
    if (status) status.textContent = message;
  }
});
