// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024, 2026 Jack G5JDA. Browser port licensed AGPL-3.0-or-later.
import { modes } from './modes.js';
import { summitDataset } from './summit-data.js';

// Column counts and zero-based summit positions in the supported SOTA V2 CSV layouts.
const LOG_COLUMN_COUNT = 10;
const S2S_COLUMN_COUNT = 12;
const OWN_SUMMIT_COLUMN = 2;
const WORKED_SUMMIT_COLUMN = 8;

// Parse CSV rows while preserving quoted commas, escaped quotes and embedded line breaks.
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      // Inside a quoted field, doubled quotes represent one literal quote rather than closing the field.
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
      // Treat CRLF as a single row boundary; newlines inside quoted fields remain part of the value.
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
  // Keep a final record without a trailing newline, but do not add an extra empty row.
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

// Inclusive band boundaries in MHz, followed by the ADIF band name.
const frequencyBands = [
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

// Resolve a SOTA MHz frequency to an ADIF band; unrecognized formats or ranges return an empty string.
export function frequencyToBand(frequency) {
  const match = frequency.match(/^(\d+(?:\.\d+)?)\s*MHz$/i);
  if (!match) {
    return '';
  }
  const frequencyMHz = Number(match[1]);
  const matchingBand = frequencyBands.find(
    ([minimum, maximum]) => frequencyMHz >= minimum && frequencyMHz <= maximum
  );
  return matchingBand?.[2] || '';
}

// Map a SOTA mode to ADIF MODE/SUBMODE, returning null for unknown values.
// Preserve SOTA's generic DATA mode as an intentional extension to ADIF's mode enumeration.
export function modeFor(value) {
  let normalizedMode = value.toUpperCase();
  if (normalizedMode === 'DATA') {
    return { mode: normalizedMode };
  }
  if (normalizedMode === 'DV') {
    normalizedMode = 'DIGITALVOICE';
  }
  if (normalizedMode in modes) {
    return { mode: normalizedMode };
  }
  // A SOTA submode becomes its parent MODE plus SUBMODE, rather than replacing the parent field.
  for (const [mode, submodes] of Object.entries(modes)) {
    if (submodes?.includes(normalizedMode)) {
      return { mode, submode: normalizedMode };
    }
  }
  return null;
}

// Check callsign syntax, including slash-separated operating prefixes/suffixes, not licence validity.
export const validCallsign = (value) =>
  value.length >= 3 &&
  /^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/i.test(value) &&
  /[A-Z]/i.test(value) &&
  /[0-9]/.test(value);
// Check the association/region-number shape before a reference is used in a dataset lookup or ADIF field.
export const validSummitRef = (value) => /^[A-Z0-9]+\/[A-Z0-9]+-\d{3}$/i.test(value);

// Validate calendar dates explicitly because Date.UTC normalizes impossible dates.
function parseQsoDateTime(date, time) {
  const dateParts = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const timeParts = time.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateParts || !timeParts) {
    return null;
  }
  const [, day, month, year] = dateParts;
  const [, hours, minutes, seconds = ''] = timeParts;
  const utcDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const isValidDate =
    Number(year) >= 1930 &&
    utcDate.getUTCFullYear() === Number(year) &&
    utcDate.getUTCMonth() === Number(month) - 1 &&
    utcDate.getUTCDate() === Number(day);
  const isValidTime = Number(hours) <= 23 && Number(minutes) <= 59 && Number(seconds) <= 59;
  if (!isValidDate || !isValidTime) {
    return null;
  }
  return { date: year + month + day, time: hours + minutes + seconds };
}

// Normalize valid SOTA V2 records and retain row-specific warnings instead of rejecting the whole log.
// QSO dates use YYYYMMDD, times use HHmm[ss] UTC, and line identifies the original CSV record.
export function readLog(text, { chaser = false } = {}) {
  const warnings = [];
  const qsos = [];
  parseCSV(text).forEach((row, index) => {
    const line = index + 1;
    if (row.every((value) => !value.trim()) || row[0] === 'Version') {
      return;
    }
    if (row[0] !== 'V2' || row.length < LOG_COLUMN_COUNT) {
      warnings.push(`Row ${line}: expected a SOTA V2 record with 10 columns.`);
      return;
    }
    const [, station, summit, date, time, frequency, mode, call, other, comment] = row.map(
      (value) => value.trim()
    );
    const dateTime = parseQsoDateTime(date, time);
    if (!dateTime) {
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
    const modeMapping = modeFor(mode);
    if (!station || !call || (!chaser && !summit) || (chaser && !other) || !band || !modeMapping) {
      warnings.push(
        `Row ${line}: missing callsign/summit, unsupported frequency, or unknown mode (${frequency}, ${mode}).`
      );
      return;
    }
    if ((summit && !validSummitRef(summit)) || (other && !validSummitRef(other))) {
      warnings.push(`Row ${line}: invalid summit reference; use a reference such as G/CE-001.`);
      return;
    }
    // Normalize matching/export keys once; keep comments as Unicode until ADIF serialization.
    qsos.push({
      line,
      chaser,
      station: station.toUpperCase(),
      summit: summit.toUpperCase(),
      date: dateTime.date,
      time: dateTime.time,
      band,
      ...modeMapping,
      call: call.toUpperCase(),
      other: other.toUpperCase(),
      comment
    });
  });
  return { qsos, warnings };
}

// Accept Maidenhead locators with four, six or eight characters.
export const validLocator = (value) => /^[A-R]{2}\d{2}([A-X]{2}(\d{2})?)?$/i.test(value);

// Read a summit from one dataset snapshot, so an update cannot mix versions within an export.
export async function lookupSummit(ref, dataset) {
  ref = ref.trim().toUpperCase();
  if (!validSummitRef(ref)) throw new Error('Invalid summit reference');
  dataset ||= await summitDataset.prepare();
  const entry = Object.hasOwn(dataset.summits, ref) ? dataset.summits[ref] : undefined;
  if (!entry) throw new Error('Summit not found');
  return { name: entry[0], locator: entry[1] };
}

// ADI COMMENT is an ASCII String: preserve readable accents where possible.
const toAsciiComment = (value) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/gu, '?');
// Serialize a non-empty ADIF value with its character count; absent optional values produce no field.
const adifField = (key, value) => (value ? `<${key}:${Array.from(value).length}>${value}` : '');

// Build one ADIF file per exact station callsign, reporting excluded contacts and retained-field warnings.
export function makeOutputs(qsos, summits, now = new Date()) {
  const groups = new Map();
  const skipped = [];
  const warnings = [];
  for (const qso of qsos) {
    // Own-summit locators are required for activation contacts; chaser-only contacts have no own summit.
    const ownLocator = summits.get(qso.summit)?.locator;
    if (qso.summit && !validLocator(ownLocator || '')) {
      skipped.push(`Row ${qso.line}: ${qso.summit} has no locator; QSO excluded.`);
      continue;
    }
    // Worked locators are optional: an invalid value omits GRIDSQUARE while retaining the contact.
    const workedLocator = summits.get(qso.other)?.locator;
    if (workedLocator && !validLocator(workedLocator)) {
      warnings.push(
        `Row ${qso.line}: ${qso.other} has an invalid worked locator; GRIDSQUARE omitted, contact retained.`
      );
    }
    const sourceComment = qso.comment || '';
    const safeComment = toAsciiComment(sourceComment);
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
      adifField('CALL', qso.call) +
      adifField('STATION_CALLSIGN', qso.station) +
      adifField('QSO_DATE', qso.date) +
      adifField('TIME_ON', qso.time) +
      adifField('MODE', qso.mode) +
      adifField('SUBMODE', qso.submode) +
      adifField('BAND', qso.band) +
      adifField('MY_SOTA_REF', qso.summit) +
      adifField('MY_GRIDSQUARE', ownLocator) +
      adifField('SOTA_REF', qso.other) +
      adifField('GRIDSQUARE', validLocator(workedLocator || '') ? workedLocator : '') +
      adifField('COMMENT', comment) +
      '<EOR>\n';
    if (!groups.has(qso.station)) {
      groups.set(qso.station, []);
    }
    groups.get(qso.station).push(record);
  }
  // ADIF requires a compact UTC creation timestamp; filenames use a filesystem-safe representation.
  const timestamp = now.toISOString().slice(0, 19);
  const adifTimestamp = timestamp.replace(/[-:]/g, '').replace('T', ' ');
  const filenameTimestamp = timestamp.replace('T', '_').replace(/:/g, '-');
  const header = [
    '# SOTAtoADIF browser edition. Copyright 2024, 2026 Jack G5JDA. AGPL-3.0-or-later.',
    adifField('ADIF_VER', '3.1.4'),
    adifField('PROGRAMID', 'SOTAtoADIF'),
    adifField('PROGRAMVERSION', 'web-1.0.0'),
    adifField('CREATED_TIMESTAMP', adifTimestamp),
    '<EOH>',
    ''
  ].join('\n');
  const files = [...groups].map(([station, records]) => ({
    station,
    count: records.length,
    name: `${station.replace(/[^A-Z0-9-]/g, '-')}_SOTAtoADIF_${filenameTimestamp}.adi`,
    text: header + records.join('')
  }));
  return { files, skipped, warnings };
}

// Apply an optional inclusive UTC start date and count the intentionally excluded contacts.
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
  // Fixed-width YYYYMMDD strings sort chronologically; the cutoff itself is included.
  const cutoff = startDate.replaceAll('-', '');
  const included = qsos.filter((qso) => qso.date >= cutoff);
  return { qsos: included, filtered: qsos.length - included.length };
}

// Preserve everything through the callsign segment, including any overseas prefix.
// Propose a mapping only when exactly one segment resembles a callsign; users still review it.
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

// Generate additional exports from reviewed mappings without mutating contacts or the original station files.
export function makeMergedOutputs(qsos, summits, mappings, now = new Date()) {
  // Contacts already logged under the destination callsign stay out of these additional files.
  const merged = qsos
    .filter((qso) => mappings.has(qso.station) && mappings.get(qso.station) !== qso.station)
    .map((qso) => ({ ...qso, station: mappings.get(qso.station) }));
  return makeOutputs(merged, summits, now).files.map((file) => ({
    ...file,
    merged: true,
    name: file.name.replace('_SOTAtoADIF_', '_suffixes-merged_SOTAtoADIF_')
  }));
}

// Apply normal row validation, require a worked summit, and label supplementary-log warnings as S2S.
export function readS2S(text) {
  const rows = parseCSV(text);
  const warnings = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.every((value) => !value.trim()) || row[0] === 'Version') {
      continue;
    }
    if (row.length < LOG_COLUMN_COUNT || !row[WORKED_SUMMIT_COLUMN]?.trim()) {
      warnings.push(`S2S row ${index + 1}: worked summit is required.`);
    }
  }
  const log = readLog(text);
  return {
    qsos: log.qsos.filter((qso) => qso.other),
    warnings: [...log.warnings.map((warning) => 'S2S ' + warning), ...warnings]
  };
}

// Keep every candidate in a group so joins can reject ambiguous repeated contacts.
function groupContacts(qsos, keyForContact) {
  const groups = new Map();
  for (const qso of qsos) {
    const key = keyForContact(qso);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(qso);
  }
  return groups;
}

// Enrich only unambiguous one-to-one matches; never append unmatched S2S records.
export function joinS2S(activator, s2s) {
  // Treat HHmm and HHmm00 as the same UTC contact time; differing comments do not prevent a match.
  const keyForContact = (qso) =>
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
  const activatorGroups = groupContacts(activator, keyForContact);
  const s2sGroups = groupContacts(s2s, keyForContact);
  const warnings = [];
  let enriched = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let conflicts = 0;
  // Associate enrichment with the original contact object, then return copies instead of editing inputs.
  const additions = new Map();
  for (const [contactKey, records] of s2sGroups) {
    const contacts = activatorGroups.get(contactKey) || [];
    if (!contacts.length) {
      unmatched += records.length;
      warnings.push(`S2S row ${records[0].line}: no matching activator contact; not added.`);
      continue;
    }
    // Multiple candidates on either side cannot be joined safely, even if their matching keys agree.
    if (contacts.length !== 1 || records.length !== 1) {
      ambiguous += records.length;
      warnings.push(
        `S2S row ${records[0].line}: ambiguous repeated contact; no enrichment applied.`
      );
      continue;
    }
    const qso = contacts[0];
    const workedSummitRef = records[0].other;
    // Retain the base reference when supplementary data conflicts with it.
    if (qso.other && qso.other !== workedSummitRef) {
      conflicts++;
      warnings.push(
        `S2S row ${records[0].line}: worked summit conflicts with activator row ${qso.line}; ` +
          'original reference retained.'
      );
      continue;
    }
    additions.set(qso, workedSummitRef);
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

// Identify chaser, S2S or activator exports from their layout, using filename hints where needed.
export function detectLogType(text, name = '') {
  // Internal layout takes precedence over filename hints.
  const rows = parseCSV(text).filter((row) => row.some((value) => value.trim()));
  const header = rows.find((row) => row[0] === 'Version');
  const records = rows.filter((row) => row[0] === 'V2');
  if (
    records.length &&
    records.every(
      (row) =>
        row.length >= LOG_COLUMN_COUNT &&
        !row[OWN_SUMMIT_COLUMN]?.trim() &&
        row[WORKED_SUMMIT_COLUMN]?.trim()
    )
  ) {
    return 'chaser';
  }
  if (
    header?.some((value) => /^(ChaserPoints|ActivatorPoints)$/i.test(value.trim())) ||
    (records.length && records.every((row) => row.length === S2S_COLUMN_COUNT))
  ) {
    return 's2s';
  }
  if (/(?:^|[_\-])chaser(?:[_\-.]|$)/i.test(name)) {
    return 'chaser';
  }
  if (/(?:^|[_\-])s2s(?:[_\-.]|$)/i.test(name)) {
    return 's2s';
  }
  if (
    records.length &&
    records.some((row) => row.length >= LOG_COLUMN_COUNT && row.length < S2S_COLUMN_COUNT)
  ) {
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

// Parse chaser contacts with a required worked summit and no required own activation summit.
export function readChaser(text) {
  return readLog(text, { chaser: true });
}

// Enrich matching contacts and append unique chaser-only contacts without guessing their own location.
// Chaser matches omit our summit: chaser-only contacts have no activation location.
export function joinChaser(base, chaser) {
  // Treat HHmm and HHmm00 as the same UTC contact time; differing comments do not prevent a match.
  const keyForContact = (qso) =>
    JSON.stringify([
      qso.station,
      qso.date,
      qso.time.padEnd(6, '0'),
      qso.band,
      qso.mode,
      qso.submode || '',
      qso.call
    ]);
  // Work on copies so enrichment does not affect a later rebuild from the uploaded source logs.
  const qsos = base.map((qso) => ({ ...qso }));
  const baseGroups = groupContacts(qsos, keyForContact);
  const chaserGroups = groupContacts(chaser, keyForContact);
  const warnings = [];
  let enriched = 0;
  let added = 0;
  let ambiguous = 0;
  let conflicts = 0;
  for (const [contactKey, rows] of chaserGroups) {
    const matches = baseGroups.get(contactKey) || [];
    if (rows.length !== 1 || matches.length > 1) {
      ambiguous += rows.length;
      warnings.push(
        `Chaser row ${rows[0].line}: ambiguous repeated contact; not added or enriched.`
      );
      continue;
    }
    const source = rows[0];
    // Unlike unmatched S2S records, a unique chaser-only contact adds a useful standalone QSO.
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
