// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024 Jack G5JDA. Browser port licensed AGPL-3.0-or-later.
import { modes } from './modes.js';

// CSV fields may contain quoted commas, escaped quotes and embedded line breaks.
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else if (quoted || value === '') {
        quoted = !quoted;
      } else {
        throw new Error('Unexpected quote in CSV.');
      }
    } else if (character === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') {
        index++;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  if (quoted) {
    throw new Error('CSV contains an unclosed quoted field.');
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

// Inclusive band boundaries in MHz, followed by the ADIF band name.
const bands = [
  [0.1357, 0.1378, '2190m'],
  [0.472, 0.479, '630m'],
  [0.501, 0.504, '560m'],
  [1.8, 2, '160m'],
  [3.5, 4, '80m'],
  [5, 5.45, '60m'],
  [7, 7.3, '40m'],
  [10, 10.15, '30m'],
  [14, 14.35, '20m'],
  [18, 18.168, '17m'],
  [21, 21.45, '15m'],
  [24, 24.99, '12m'],
  [28, 29.7, '10m'],
  [40, 45, '8m'],
  [50, 54, '6m'],
  [54.000001, 69.9, '5m'],
  [70, 71, '4m'],
  [144, 148, '2m'],
  [222, 225, '1.25m'],
  [420, 450, '70cm'],
  [902, 928, '33cm'],
  [1240, 1300, '23cm'],
  [2300, 2450, '13cm'],
  [3300, 3500, '9cm'],
  [5650, 5925, '6cm'],
  [10000, 10500, '3cm'],
  [24000, 24250, '1.25cm'],
  [47000, 47200, '6mm'],
  [75500, 81000, '4mm'],
  [119980, 123000, '2.5mm'],
  [134000, 149000, '2mm'],
  [241000, 250000, '1mm'],
  [300000, 7500000, 'submm']
];
export function frequencyToBand(value) {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*MHz$/i);
  return match
    ? bands.find(([minimum, maximum]) => +match[1] >= minimum && +match[1] <= maximum)?.[2] || ''
    : '';
}

// Preserve SOTA's generic DATA mode as an intentional extension to ADIF's mode enumeration.
export function modeFor(value) {
  value = value.toUpperCase();
  if (value === 'DATA') {
    return { mode: value };
  }
  if (value === 'DV') {
    value = 'DIGITALVOICE';
  }
  if (value in modes) {
    return { mode: value };
  }
  for (const [mode, submodes] of Object.entries(modes)) {
    if (submodes?.includes(value)) {
      return { mode, submode: value };
    }
  }
  return null;
}

export const validCallsign = (value) =>
  value.length >= 3 &&
  /^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/i.test(value) &&
  /[A-Z]/i.test(value) &&
  /[0-9]/.test(value);
export const validSummitRef = (value) => /^[A-Z0-9]+\/[A-Z0-9]+-\d{3}$/i.test(value);
export function readLog(text, { chaser = false } = {}) {
  const warnings = [];
  const qsos = [];
  parseCSV(text).forEach((row, index) => {
    const line = index + 1;
    if (row.every((value) => !value.trim()) || row[0] === 'Version') {
      return;
    }
    if (row[0] !== 'V2' || row.length < 10) {
      warnings.push(`Row ${line}: expected a SOTA V2 record with 10 columns.`);
      return;
    }
    const [, station, summit, date, time, frequency, mode, call, other, comment] = row.map(
      (value) => value.trim()
    );
    const dateParts = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const timeParts = time.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    const utcDate = dateParts
      ? new Date(Date.UTC(+dateParts[3], +dateParts[2] - 1, +dateParts[1]))
      : null;
    if (
      !dateParts ||
      +dateParts[3] < 1930 ||
      utcDate.getUTCFullYear() !== +dateParts[3] ||
      utcDate.getUTCMonth() !== +dateParts[2] - 1 ||
      utcDate.getUTCDate() !== +dateParts[1] ||
      !timeParts ||
      +timeParts[1] > 23 ||
      +timeParts[2] > 59 ||
      +(timeParts[3] || 0) > 59
    ) {
      warnings.push(`Row ${line}: invalid date or UTC time.`);
      return;
    }
    if (!validCallsign(station) || !validCallsign(call)) {
      warnings.push(
        `Row ${line}: invalid callsign; use letters, digits and optional slash-separated prefixes or suffixes, ` +
          'with at least one letter and digit.'
      );
      return;
    }
    const band = frequencyToBand(frequency);
    const mapped = modeFor(mode);
    if (!station || !call || (!chaser && !summit) || (chaser && !other) || !band || !mapped) {
      warnings.push(
        `Row ${line}: missing callsign/summit, unsupported frequency, or unknown mode (${frequency}, ${mode}).`
      );
      return;
    }
    if ((summit && !validSummitRef(summit)) || (other && !validSummitRef(other))) {
      warnings.push(`Row ${line}: invalid summit reference; use a reference such as G/CE-001.`);
      return;
    }
    qsos.push({
      line,
      chaser,
      station: station.toUpperCase(),
      summit: summit.toUpperCase(),
      date: dateParts[3] + dateParts[2] + dateParts[1],
      time: timeParts[1] + timeParts[2] + (timeParts[3] || ''),
      band,
      ...mapped,
      call: call.toUpperCase(),
      other: other.toUpperCase(),
      comment
    });
  });
  return { qsos, warnings };
}

export const validLocator = (value) => /^[A-R]{2}\d{2}([A-X]{2}(\d{2})?)?$/i.test(value);
export async function lookupSummit(ref) {
  ref = ref.trim().toUpperCase();
  if (!validSummitRef(ref)) {
    throw new Error('Invalid summit reference');
  }
  const path = ref.split('/').map(encodeURIComponent).join('/');
  const response = await fetch('https://api2.sota.org.uk/api/summits/' + path, {
    credentials: 'omit',
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok || response.status === 204) {
    throw new Error('Summit not found');
  }
  const data = await response.json();
  if (!validLocator(data.locator || '')) {
    throw new Error('No valid locator returned');
  }
  return { ...data, locator: data.locator.toUpperCase() };
}

// ADI COMMENT is an ASCII String: preserve readable accents where possible.
const asciiComment = (value) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/gu, '?');
const field = (key, value) => (value ? `<${key}:${Array.from(value).length}>${value}` : '');
export function makeOutputs(qsos, summits, now = new Date()) {
  const groups = new Map();
  const skipped = [];
  const warnings = [];
  for (const qso of qsos) {
    const grid = summits.get(qso.summit)?.locator;
    if (qso.summit && !validLocator(grid || '')) {
      skipped.push(`Row ${qso.line}: ${qso.summit} has no locator; QSO excluded.`);
      continue;
    }
    const workedGrid = summits.get(qso.other)?.locator;
    if (workedGrid && !validLocator(workedGrid)) {
      warnings.push(
        `Row ${qso.line}: ${qso.other} has an invalid worked locator; GRIDSQUARE omitted, contact retained.`
      );
    }
    const sourceComment = qso.comment || '';
    const safeComment = asciiComment(sourceComment);
    if (safeComment !== sourceComment) {
      warnings.push(
        `Row ${qso.line}: comment converted to ASCII for ADIF; accents removed, line breaks flattened ` +
          'and unsupported characters replaced with ?. Original CSV unchanged.'
      );
    }
    const comment =
      (qso.summit ? `My SOTA Ref: ${qso.summit}.` : '') +
      (qso.other ? `${qso.summit ? ' THX S2S, ' : ''}Your SOTA Ref: ${qso.other}.` : '') +
      (safeComment ? ` ${safeComment}` : '');
    const record =
      field('CALL', qso.call) +
      field('STATION_CALLSIGN', qso.station) +
      field('QSO_DATE', qso.date) +
      field('TIME_ON', qso.time) +
      field('MODE', qso.mode) +
      field('SUBMODE', qso.submode) +
      field('BAND', qso.band) +
      field('MY_SOTA_REF', qso.summit) +
      field('MY_GRIDSQUARE', grid) +
      field('SOTA_REF', qso.other) +
      field('GRIDSQUARE', validLocator(workedGrid || '') ? workedGrid : '') +
      field('COMMENT', comment) +
      '<EOR>\n';
    if (!groups.has(qso.station)) {
      groups.set(qso.station, []);
    }
    groups.get(qso.station).push(record);
  }
  const timestamp = now.toISOString().slice(0, 19);
  const stamp = timestamp.replace(/[-:]/g, '').replace('T', ' ');
  const files = [...groups].map(([station, records]) => ({
    station,
    count: records.length,
    name: `${station.replace(/[^A-Z0-9-]/g, '-')}_SOTAtoADIF_${timestamp.replace('T', '_').replace(/:/g, '-')}.adi`,
    text:
      `# SOTAtoADIF browser edition. Copyright Jack G5JDA. AGPL-3.0-or-later.\n` +
      field('ADIF_VER', '3.1.4') +
      '\n' +
      field('PROGRAMID', 'SOTAtoADIF') +
      '\n' +
      field('PROGRAMVERSION', 'web-1.0.0') +
      '\n' +
      field('CREATED_TIMESTAMP', stamp) +
      '\n<EOH>\n' +
      records.join('')
  }));
  return { files, skipped, warnings };
}

// Dates are compared in the same UTC calendar format as QSO_DATE.
export function filterByDate(qsos, startDate = '') {
  if (!startDate) {
    return { qsos, filtered: 0 };
  }
  const date = new Date(startDate + 'T00:00:00Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== startDate
  ) {
    throw new Error('Choose a valid start date or clear the date field.');
  }
  const cutoff = startDate.replaceAll('-', '');
  const included = qsos.filter((qso) => qso.date >= cutoff);
  return { qsos: included, filtered: qsos.length - included.length };
}

// Conservative proposals only: users review every source and destination.
export function proposeMerge(station) {
  const parts = station.toUpperCase().split('/');
  const indexes = parts.flatMap((part, index) =>
    /^[A-Z0-9]*[A-Z][0-9]+[A-Z]+$/.test(part) ? [index] : []
  );
  if (indexes.length !== 1 || indexes[0] === parts.length - 1) {
    return '';
  }
  return parts.slice(0, indexes[0] + 1).join('/');
}

export function makeMergedOutputs(qsos, summits, mappings, now = new Date()) {
  const merged = qsos
    .filter((qso) => mappings.has(qso.station) && mappings.get(qso.station) !== qso.station)
    .map((qso) => ({ ...qso, station: mappings.get(qso.station) }));
  return makeOutputs(merged, summits, now).files.map((file) => ({
    ...file,
    merged: true,
    name: file.name.replace('_SOTAtoADIF_', '_suffixes-merged_SOTAtoADIF_')
  }));
}

export function readS2S(text) {
  const rows = parseCSV(text);
  const warnings = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.every((value) => !value.trim()) || row[0] === 'Version') {
      continue;
    }
    if (row.length < 10 || !row[8]?.trim()) {
      warnings.push(`S2S row ${index + 1}: worked summit is required.`);
    }
  }
  const log = readLog(text);
  return {
    qsos: log.qsos.filter((qso) => qso.other),
    warnings: [...log.warnings.map((warning) => 'S2S ' + warning), ...warnings]
  };
}

// Enrich only unambiguous one-to-one matches; never append unmatched S2S records.
export function joinS2S(activator, s2s) {
  const key = (qso) =>
    JSON.stringify([
      qso.station,
      qso.summit,
      qso.date,
      qso.time.padEnd(6, '0'),
      qso.band,
      qso.mode,
      qso.submode || '',
      qso.call
    ]);
  const groups = (qsos) => {
    const map = new Map();
    for (const qso of qsos) {
      const contactKey = key(qso);
      if (!map.has(contactKey)) {
        map.set(contactKey, []);
      }
      map.get(contactKey).push(qso);
    }
    return map;
  };
  const main = groups(activator);
  const extra = groups(s2s);
  const warnings = [];
  let enriched = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let conflicts = 0;
  const additions = new Map();
  for (const [contactKey, records] of extra) {
    const contacts = main.get(contactKey) || [];
    if (!contacts.length) {
      unmatched += records.length;
      warnings.push(`S2S row ${records[0].line}: no matching activator contact; not added.`);
      continue;
    }
    if (contacts.length !== 1 || records.length !== 1) {
      ambiguous += records.length;
      warnings.push(
        `S2S row ${records[0].line}: ambiguous repeated contact; no enrichment applied.`
      );
      continue;
    }
    const qso = contacts[0];
    const ref = records[0].other;
    if (qso.other && qso.other !== ref) {
      conflicts++;
      warnings.push(
        `S2S row ${records[0].line}: worked summit conflicts with activator row ${qso.line}; ` +
          'original reference retained.'
      );
      continue;
    }
    additions.set(qso, ref);
    enriched++;
  }
  return {
    qsos: activator.map((qso) =>
      additions.has(qso) ? { ...qso, other: additions.get(qso) } : { ...qso }
    ),
    warnings,
    enriched,
    unmatched,
    ambiguous,
    conflicts
  };
}

export function detectLogType(text, name = '') {
  // Internal layout takes precedence over filename hints.
  const rows = parseCSV(text).filter((row) => row.some((value) => value.trim()));
  const header = rows.find((row) => row[0] === 'Version');
  const records = rows.filter((row) => row[0] === 'V2');
  if (
    records.length &&
    records.every((row) => row.length >= 10 && !row[2]?.trim() && row[8]?.trim())
  ) {
    return 'chaser';
  }
  if (
    header?.some((value) => /^(ChaserPoints|ActivatorPoints)$/i.test(value.trim())) ||
    (records.length && records.every((row) => row.length === 12))
  ) {
    return 's2s';
  }
  if (/(?:^|[_\-])chaser(?:[_\-.]|$)/i.test(name)) {
    return 'chaser';
  }
  if (/(?:^|[_\-])s2s(?:[_\-.]|$)/i.test(name)) {
    return 's2s';
  }
  if (records.length && records.some((row) => row.length >= 10 && row.length < 12)) {
    return 'activator';
  }
  if (/(?:^|[_\-])activator(?:[_\-.]|$)/i.test(name)) {
    return 'activator';
  }
  throw new Error(
    'Could not identify this CSV as an activator, S2S or chaser export. ' +
      'Use a SOTA V2 export with its original filename.'
  );
}

export function readChaser(text) {
  return readLog(text, { chaser: true });
}

// Chaser matches omit our summit: chaser-only contacts have no activation location.
export function joinChaser(base, chaser) {
  const key = (qso) =>
    JSON.stringify([
      qso.station,
      qso.date,
      qso.time.padEnd(6, '0'),
      qso.band,
      qso.mode,
      qso.submode || '',
      qso.call
    ]);
  const qsos = base.map((qso) => ({ ...qso }));
  const groups = new Map();
  const extras = new Map();
  const warnings = [];
  let enriched = 0;
  let added = 0;
  let ambiguous = 0;
  let conflicts = 0;
  for (const qso of qsos) {
    const contactKey = key(qso);
    if (!groups.has(contactKey)) {
      groups.set(contactKey, []);
    }
    groups.get(contactKey).push(qso);
  }
  for (const qso of chaser) {
    const contactKey = key(qso);
    if (!extras.has(contactKey)) {
      extras.set(contactKey, []);
    }
    extras.get(contactKey).push(qso);
  }
  for (const [contactKey, rows] of extras) {
    const matches = groups.get(contactKey) || [];
    if (rows.length !== 1 || matches.length > 1) {
      ambiguous += rows.length;
      warnings.push(
        `Chaser row ${rows[0].line}: ambiguous repeated contact; not added or enriched.`
      );
      continue;
    }
    const source = rows[0];
    if (!matches.length) {
      qsos.push({ ...source });
      added++;
      continue;
    }
    const target = matches[0];
    if (target.other && target.other !== source.other) {
      conflicts++;
      warnings.push(`Chaser row ${source.line}: conflicting worked summit; original retained.`);
      continue;
    }
    target.other = source.other;
    enriched++;
  }
  return { qsos, warnings, enriched, added, ambiguous, conflicts };
}
