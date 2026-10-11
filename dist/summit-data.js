// SPDX-License-Identifier: AGPL-3.0-or-later
import { parseCSV, validSummitRef, validLocator } from './converter.js';

export const SUMMIT_CSV_URL = 'https://storage.sota.org.uk/summitslist.csv';
const STORAGE_VERSION = 1;
const DATABASE_NAME = 'sotatoadif-summits';
const DATASET_STORE = 'datasets';
const CURRENT_DATASET_KEY = 'current';
const DOWNLOAD_TIMEOUT_MS = 120000;
const REQUIRED_COLUMNS = ['SummitCode', 'SummitName', 'Longitude', 'Latitude'];
const DATASET_DATE_PATTERN = /^SOTA Summits List \(Date=(\d{2}\/\d{2}\/\d{4})\)$/;
const SIX_CHARACTER_LOCATOR_PATTERN = /^[A-R]{2}\d{2}[A-X]{2}$/;

// Each locator pair puts longitude first, then latitude.
export function maidenhead(latitude, longitude) {
  const validLatitude = Number.isFinite(latitude) && latitude >= -90 && latitude < 90;
  const validLongitude = Number.isFinite(longitude) && longitude >= -180 && longitude < 180;
  if (!validLatitude || !validLongitude) {
    throw new Error('Invalid summit coordinates');
  }

  // Shift the origin to the southwest corner of the world.
  let east = longitude + 180;
  let north = latitude + 90;

  // Fields span 20 degrees of longitude and 10 degrees of latitude.
  const fieldColumn = Math.floor(east / 20);
  const fieldRow = Math.floor(north / 10);
  east -= fieldColumn * 20;
  north -= fieldRow * 10;

  // Each field contains ten squares along each axis.
  const squareColumn = Math.floor(east / 2);
  const squareRow = Math.floor(north);
  east -= squareColumn * 2;
  north -= squareRow;

  // Each square contains 24 subsquares along each axis.
  const subsquareColumn = Math.floor(east * 12);
  const subsquareRow = Math.floor(north * 24);
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return letters[fieldColumn] + letters[fieldRow] +
    String(squareColumn) + String(squareRow) +
    letters[subsquareColumn] + letters[subsquareRow];
}

// The first CSV row describes the dataset; the second names its columns.
function readDatasetHeader(rows) {
  const introductoryText = rows.shift()?.[0] || '';
  const dateMatch = DATASET_DATE_PATTERN.exec(introductoryText);
  if (!dateMatch) {
    throw new Error('Missing summit dataset date');
  }

  const header = rows.shift() || [];
  const columnIndexes = REQUIRED_COLUMNS.map(name => header.indexOf(name));
  if (columnIndexes.some(index => index < 0)) {
    throw new Error('Missing summit CSV columns');
  }
  return { date: dateMatch[1], columnCount: header.length, columnIndexes };
}

// Keep retired references for historical logs. Compact entries are [name, locator].
export function preprocessSummits(text) {
  const rows = parseCSV(text);
  const { date, columnCount, columnIndexes } = readDatasetHeader(rows);
  const summits = Object.create(null);

  for (const row of rows) {
    if (row.every(value => !value.trim())) {
      continue;
    }
    const [reference, name, longitude, latitude] = columnIndexes.map(index => row[index]?.trim());
    const hasRequiredValues = validSummitRef(reference || '') && name && longitude && latitude;
    const duplicateReference = Object.hasOwn(summits, (reference || '').toUpperCase());
    if (row.length !== columnCount || !hasRequiredValues || duplicateReference) {
      throw new Error('Invalid or duplicate summit row');
    }

    const locator = maidenhead(Number(latitude), Number(longitude));
    summits[reference.toUpperCase()] = [name, locator];
  }
  if (Object.keys(summits).length === 0) {
    throw new Error('Empty summit dataset');
  }
  return { version: STORAGE_VERSION, date, summits };
}

function isValidSavedEntry([reference, entry]) {
  return validSummitRef(reference) &&
    Array.isArray(entry) && entry.length === 2 &&
    typeof entry[0] === 'string' &&
    SIX_CHARACTER_LOCATOR_PATTERN.test(entry[1]) && validLocator(entry[1]);
}

// Ignore incompatible or corrupt saved data and download a fresh dataset instead.
function isValidSavedDataset(dataset) {
  if (dataset?.version !== STORAGE_VERSION ||
      typeof dataset.date !== 'string' ||
      typeof dataset.lastModified !== 'string' ||
      !dataset.summits || typeof dataset.summits !== 'object') {
    return false;
  }
  const entries = Object.entries(dataset.summits);
  return entries.length > 0 && entries.every(isValidSavedEntry);
}

// Store one compact JSON document atomically; never persist uploaded log content.
export function createDatasetStorage(indexedDB = globalThis.indexedDB) {
  let connectionPromise;

  function openDatabase() {
    if (!connectionPromise) {
      connectionPromise = new Promise((resolve, reject) => {
        if (!indexedDB) {
          reject(new Error('Browser storage unavailable'));
          return;
        }
        const request = indexedDB.open(DATABASE_NAME, STORAGE_VERSION);
        request.onupgradeneeded = () => request.result.createObjectStore(DATASET_STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Browser storage blocked'));
      });
    }
    return connectionPromise;
  }

  async function runTransaction(mode, dataset) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(DATASET_STORE, mode);
      const store = transaction.objectStore(DATASET_STORE);
      const isReading = mode === 'readonly';
      const request = isReading
        ? store.get(CURRENT_DATASET_KEY)
        : store.put(JSON.stringify(dataset), CURRENT_DATASET_KEY);

      // Resolve writes only when committed, rather than when the individual request succeeds.
      transaction.oncomplete = () => {
        try {
          const savedDataset = isReading && request.result
            ? JSON.parse(request.result)
            : undefined;
          resolve(savedDataset);
        } catch (error) {
          reject(error);
        }
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => {
        reject(transaction.error || new Error('Storage transaction aborted'));
      };
    });
  }

  return {
    read: () => runTransaction('readonly'),
    write: dataset => runTransaction('readwrite', dataset)
  };
}

// Inject dependencies for deterministic tests without contacting SOTA or browser storage.
export function createSummitDataset({
  fetcher = (...args) => globalThis.fetch(...args),
  storage = createDatasetStorage(),
  onStatus = () => {}
} = {}) {
  let currentDataset;
  let initializationPromise;

  async function loadSavedDataset() {
    try {
      const savedDataset = await storage.read();
      if (isValidSavedDataset(savedDataset)) {
        currentDataset = savedDataset;
      }
    } catch {
      // Storage is optional: a fresh download can still be used in memory.
    }
  }

  async function saveDataset(dataset) {
    try {
      await storage.write(dataset);
      return true;
    } catch {
      onStatus(`Summit data (${dataset.date}) ready; could not save it on this device.`);
      return false;
    }
  }

  async function prepareReplacement(response) {
    const text = await response.text();
    onStatus('Preparing summit names and locators…');
    // Allow the browser to paint the status before parsing the full CSV.
    await new Promise(resolve => setTimeout(resolve, 0));
    const dataset = preprocessSummits(text);
    dataset.lastModified = response.headers.get('Last-Modified') || '';
    return dataset;
  }

  async function refreshDataset() {
    const checkingMessage = currentDataset
      ? `Checking summit data (${currentDataset.date}) for updates…`
      : 'Downloading summit data (about 25 MB)…';
    onStatus(checkingMessage);

    try {
      const headers = currentDataset?.lastModified
        ? { 'If-Modified-Since': currentDataset.lastModified }
        : {};
      const response = await fetcher(SUMMIT_CSV_URL, {
        headers,
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
      });

      const unchanged = response.status === 304 && currentDataset;
      if (!unchanged) {
        if (!response.ok) {
          throw new Error('Summit download failed');
        }
        // Validate the entire replacement before changing the current snapshot.
        currentDataset = await prepareReplacement(response);
        const saved = await saveDataset(currentDataset);
        if (!saved) {
          return;
        }
      }
      onStatus(`Summit data (${currentDataset.date}) ready.`);
    } catch (error) {
      if (currentDataset) {
        onStatus(`Using saved summit data (${currentDataset.date}); update unavailable.`);
      } else {
        onStatus('Summit download unavailable. Enter locators manually or retry conversion.');
        throw error;
      }
    }
  }

  async function initializeDataset() {
    await loadSavedDataset();
    const updatePromise = refreshDataset();
    if (currentDataset) {
      // Saved data is immediately usable while the update runs in the background.
      updatePromise.catch(() => {});
      return;
    }
    await updatePromise;
  }

  async function prepare() {
    if (!initializationPromise) {
      initializationPromise = initializeDataset().catch(error => {
        // Permit another conversion attempt to retry a failed first download.
        initializationPromise = undefined;
        throw error;
      });
    }
    await initializationPromise;
    return currentDataset;
  }

  return { prepare };
}

export const summitDataset = createSummitDataset({
  onStatus: message => {
    const status = globalThis.document?.getElementById('datasetStatus');
    if (status) {
      status.textContent = message;
    }
  }
});
