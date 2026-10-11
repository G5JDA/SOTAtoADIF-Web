// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  readLog,
  lookupSummit,
  makeOutputs,
  validLocator,
  validCallsign,
  filterByDate,
  proposeMerge,
  makeMergedOutputs,
  readS2S,
  joinS2S,
  detectLogType,
  readChaser,
  joinChaser
} from './converter.js';
import { createSummitLookup } from './summit-cache.js';

let summitStorage;
try {
  summitStorage = localStorage;
} catch {
  // Summit lookup can use its in-memory cache when browser storage is unavailable.
}
const cachedSummitLookup = createSummitLookup(lookupSummit, summitStorage);

// Keep log state in memory; only summit data and display preferences may be persisted.
const getElement = (id) => document.getElementById(id);
let combinedLog = null;
let summits = new Map();
let failedLookups = new Set();
let logRevision = 0;
let busy = false;
let mergeMappings = new Map();
let mainLog = null;
let s2sLog = null;
let mainName = '';
let s2sName = '';
let chaserLog = null;
let chaserName = '';
function setBusy(value) {
  busy = value;
  getElement('convert').setAttribute('aria-disabled', String(value));
  getElement('file').disabled = value;
  getElement('clearChaser').disabled = value || !chaserLog;
  getElement('clearMain').disabled = value || !mainLog;
  getElement('clearS2S').disabled = value || !s2sLog;
  getElement('enrich').disabled = value;
  getElement('startDate').disabled = value;
  getElement('mergeEnabled').disabled = value;
  for (const input of document.querySelectorAll('#mergeRows input')) {
    input.disabled = value;
  }
  for (const input of document.querySelectorAll('#summitRows input')) {
    input.disabled = value;
  }
  getElement('drop').setAttribute('aria-disabled', String(value));
}
async function readFiles(files) {
  if (busy || !files?.length) {
    return;
  }
  setBusy(true);
  getElement('results').hidden = true;
  // Parse the entire selection before replacing any previously loaded log.
  const pending = new Map();
  const readers = { activator: readLog, s2s: readS2S, chaser: readChaser };
  let currentName = 'CSV';
  try {
    for (const file of Array.from(files)) {
      currentName = file.name;
      const text = await file.text();
      const type = detectLogType(text, file.name);
      if (pending.has(type)) {
        throw new Error(
          `Select only one ${type} log at a time. No files from this selection were applied.`
        );
      }
      pending.set(type, {
        name: file.name,
        log: readers[type](text)
      });
    }
    if (pending.has('activator')) {
      mainLog = pending.get('activator').log;
      mainName = pending.get('activator').name;
    }
    if (pending.has('s2s')) {
      s2sLog = pending.get('s2s').log;
      s2sName = pending.get('s2s').name;
    }
    if (pending.has('chaser')) {
      chaserLog = pending.get('chaser').log;
      chaserName = pending.get('chaser').name;
    }
    rebuildLog();
  } catch (error) {
    getElement('empty').hidden = false;
    getElement('convert').disabled = !combinedLog?.qsos.length;
    getElement('resultBadge').textContent = 'FILE READ FAILED';
    getElement('status').textContent =
      `Could not read ${currentName}. Select the file again or export a new CSV. ` +
      `${error.message} Previously loaded files were retained.`;
  } finally {
    setBusy(false);
    getElement('file').value = '';
  }
}
getElement('clearS2S').addEventListener('click', () => {
  if (busy) {
    return;
  }
  s2sLog = null;
  s2sName = '';
  rebuildLog();
  setBusy(false);
  getElement('file').focus();
});
getElement('clearMain').addEventListener('click', () => {
  if (busy) {
    return;
  }
  mainLog = null;
  mainName = '';
  rebuildLog();
  setBusy(false);
  getElement('file').focus();
});
getElement('clearChaser').addEventListener('click', () => {
  if (busy) {
    return;
  }
  chaserLog = null;
  chaserName = '';
  rebuildLog();
  setBusy(false);
  getElement('file').focus();
});
function warn(messages) {
  getElement('warningBox').hidden = !messages.length;
  getElement('warningBox').open = !!messages.length;
  getElement('warningTitle').textContent =
    `${messages.length} warning${messages.length === 1 ? '' : 's'} · review excluded rows and lookups`;
  getElement('warnings').replaceChildren(
    ...messages.map((message) => {
      const item = document.createElement('li');
      item.textContent = message;
      return item;
    })
  );
}

function rebuildLog() {
  getElement('fileLabel').textContent = 'Drop your SOTA CSV files here';
  getElement('mainName').textContent = mainLog ? `Activator: ${mainName}` : '';
  getElement('s2sName').textContent = s2sLog ? `S2S: ${s2sName}` : '';
  getElement('loadedFiles').hidden = !mainLog && !s2sLog && !chaserLog;
  getElement('chaserFileRow').hidden = !chaserLog;
  getElement('chaserName').textContent = chaserLog ? `Chaser: ${chaserName}` : '';
  getElement('mainFileRow').hidden = !mainLog;
  getElement('s2sFileRow').hidden = !s2sLog;
  combinedLog = mainLog || s2sLog || chaserLog;
  const joined = mainLog && s2sLog ? joinS2S(mainLog.qsos, s2sLog.qsos) : null;
  if (joined) {
    combinedLog = {
      qsos: joined.qsos,
      warnings: mainLog.warnings,
      lookupWarnings: [...s2sLog.warnings, ...joined.warnings]
    };
  }
  getElement('s2sSummary').hidden = !s2sLog;
  getElement('s2sSummary').textContent = joined
    ? `${joined.enriched} S2S contacts matched; ${joined.unmatched} unmatched, ` +
      `${joined.ambiguous} ambiguous, ${joined.conflicts} conflicting. ` +
      'S2S-only unmatched contacts are not appended.'
    : s2sLog
      ? `${s2sLog.qsos.length} S2S contacts available for standalone conversion.`
      : '';
  const combined =
    chaserLog && (mainLog || s2sLog) ? joinChaser(combinedLog.qsos, chaserLog.qsos) : null;
  if (combined) {
    combinedLog = {
      qsos: combined.qsos,
      warnings: [...combinedLog.warnings, ...chaserLog.warnings],
      lookupWarnings: [...(combinedLog.lookupWarnings || []), ...combined.warnings]
    };
  }
  getElement('chaserSummary').hidden = !chaserLog;
  getElement('chaserSummary').textContent = combined
    ? `${combined.enriched} chaser contacts matched; ${combined.added} additional contacts; ` +
      `${combined.ambiguous} ambiguous, ${combined.conflicts} conflicting. ` +
      'Chaser-only contacts have no own summit or locator.'
    : chaserLog
      ? `${chaserLog.qsos.length} chaser contacts. Own summit and locator are omitted; ` +
        'worked summit locators can be looked up.'
      : '';
  logRevision++;
  summits = new Map();
  failedLookups = new Set();
  mergeMappings = new Map();
  renderMergeOptions();
  getElement('results').hidden = true;
  getElement('empty').hidden = false;
  getElement('resultBadge').textContent = combinedLog ? 'READY TO CONVERT' : 'WAITING FOR LOG';
  getElement('status').textContent = combinedLog
    ? `${combinedLog.qsos.length} valid QSOs found. Times are UTC. Review any warning details below.`
    : 'Choose an activator, S2S or chaser CSV file to get started.';
  getElement('convert').disabled = !combinedLog?.qsos.length;
  warn([...(combinedLog?.warnings || []), ...(combinedLog?.lookupWarnings || [])]);
  renderSummits();
}

function invalidateMerge() {
  getElement('results').hidden = true;
  getElement('empty').hidden = false;
  getElement('resultBadge').textContent = 'RECONVERT TO UPDATE';
  getElement('status').textContent = 'Export options changed. Convert again to update downloads.';
}

function renderMergeOptions() {
  getElement('mergePanel').hidden = !getElement('mergeEnabled').checked;
  const stations = [...new Set((combinedLog?.qsos || []).map((qso) => qso.station))].filter((s) =>
    s.includes('/')
  );
  getElement('mergeEmpty').hidden = !!stations.length;
  getElement('mergeRows').replaceChildren(
    ...stations.map((station, index) => {
      const row = document.createElement('div');
      row.className = 'merge-row';
      const label = document.createElement('label');
      label.className = 'check';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = mergeMappings.has(station);
      const name = document.createElement('span');
      name.textContent = `Include ${station}`;
      label.append(check, name);
      const targetLabel = document.createElement('label');
      targetLabel.textContent = `Destination for ${station}`;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = mergeMappings.get(station) || proposeMerge(station);
      input.id = `merge-target-${index}`;
      targetLabel.htmlFor = input.id;
      input.setAttribute('aria-label', `Destination for ${station}`);
      input.placeholder = 'Operating callsign';
      const error = document.createElement('span');
      error.id = `merge-error-${index}`;
      error.className = 'locator-error';
      error.hidden = true;
      input.setAttribute('aria-describedby', error.id);
      const validate = () => {
        const invalid =
          check.checked && !validMergeTarget(station, input.value.trim().toUpperCase());
        input.setAttribute('aria-invalid', String(invalid));
        error.hidden = !invalid;
        error.textContent = invalid
          ? 'Enter a different operating callsign using letters, digits and slashes, or deselect this mapping.'
          : '';
        return !invalid;
      };
      input.validateMerge = validate;
      validate();
      const update = () => {
        if (busy) {
          return;
        }
        const target = input.value.trim().toUpperCase();
        if (check.checked) {
          mergeMappings.set(station, target);
        } else {
          mergeMappings.delete(station);
        }
        validate();
        invalidateMerge();
      };
      check.addEventListener('change', update);
      input.addEventListener('input', update);
      row.append(label, targetLabel, input, error);
      return row;
    })
  );
}
getElement('mergeEnabled').addEventListener('change', () => {
  if (busy) {
    return;
  }
  renderMergeOptions();
  invalidateMerge();
});
renderMergeOptions();
function validMergeTarget(source, target) {
  return validCallsign(target) && target !== source;
}

function selectedContacts() {
  try {
    if (getElement('startDate').validity?.badInput) {
      throw new Error('Enter a complete valid date or clear the date field.');
    }
    const selection = filterByDate(combinedLog?.qsos || [], getElement('startDate').value || '');
    getElement('startDate').setAttribute('aria-invalid', 'false');
    getElement('dateError').hidden = true;
    return selection;
  } catch (error) {
    getElement('startDate').setAttribute('aria-invalid', 'true');
    getElement('dateError').textContent = error.message;
    getElement('dateError').hidden = false;
    throw error;
  }
}
getElement('startDate').addEventListener('change', () => {
  if (busy) {
    return;
  }
  getElement('results').hidden = true;
  getElement('empty').hidden = false;
  try {
    const selection = selectedContacts();
    getElement('startDate').setAttribute('aria-invalid', 'false');
    getElement('status').textContent =
      `${selection.qsos.length} valid QSOs in date selection. ` +
      `${selection.filtered} QSOs excluded by date. Convert to update the export.`;
    getElement('resultBadge').textContent = 'RECONVERT TO UPDATE';
    renderSummits();
  } catch (error) {
    getElement('startDate').setAttribute('aria-invalid', 'true');
    getElement('locators').hidden = true;
    getElement('status').textContent = error.message;
  }
});
function renderSummits() {
  if (getElement('startDate').getAttribute('aria-invalid') === 'true') {
    getElement('locators').hidden = true;
    return;
  }
  const refs = [
    ...new Set(
      selectedContacts()
        .qsos.flatMap((qso) => [qso.summit, qso.other])
        .filter(Boolean)
    )
  ].filter((ref) => !getElement('enrich').checked || failedLookups.has(ref));
  getElement('locators').hidden = !refs.length;
  getElement('summitRows').replaceChildren(
    ...refs.map((ref, index) => {
      const row = document.createElement('label');
      row.className = 'summit';
      const text = document.createElement('span');
      text.id = `locator-label-${index}`;
      const required = selectedContacts().qsos.some((qso) => qso.summit === ref);
      text.textContent =
        ref +
        ` · ${required ? 'own summit — required' : 'worked summit — optional'}` +
        (summits.get(ref)?.name ? ` · ${summits.get(ref).name}` : '');
      const input = document.createElement('input');
      input.placeholder = 'Locator';
      input.value = summits.get(ref)?.locator || '';
      input.setAttribute('aria-labelledby', text.id);
      input.required = required;
      input.setAttribute('aria-required', String(required));
      input.pattern = '[A-Ra-r]{2}[0-9]{2}([A-Xa-x]{2}([0-9]{2})?)?';
      const error = document.createElement('span');
      error.id = `locator-error-${index}`;
      error.className = 'locator-error';
      input.setAttribute('aria-describedby', error.id);
      function validate() {
        const value = input.value.trim();
        const required = selectedContacts().qsos.some((qso) => qso.summit === ref);
        const invalid = value ? !validLocator(value) : required;
        input.setAttribute('aria-invalid', String(invalid));
        error.textContent = invalid
          ? value
            ? 'Invalid locator. Use a Maidenhead locator such as IO81XW.'
            : 'Enter a Maidenhead locator, such as IO81XW.'
          : ' ';
        error.hidden = !invalid;
      }
      validate();
      input.addEventListener('input', () => {
        summits.set(ref, { locator: input.value.trim().toUpperCase() });
        validate();
        getElement('results').hidden = true;
        getElement('empty').hidden = false;
        getElement('resultBadge').textContent = 'RECONVERT TO UPDATE';
      });
      const field = document.createElement('span');
      field.className = 'locator-field';
      field.append(input, error);
      row.append(text, field);
      return row;
    })
  );
}
getElement('enrich').addEventListener('change', () => {
  if (!busy) {
    renderSummits();
  }
});
getElement('file').addEventListener('change', async (event) => {
  await readFiles(event.target.files);
});
getElement('drop').addEventListener('dragover', (event) => {
  event.preventDefault();
  if (!busy) {
    getElement('drop').classList.add('drag');
  }
});
getElement('drop').addEventListener('dragleave', () => getElement('drop').classList.remove('drag'));
getElement('drop').addEventListener('drop', async (event) => {
  event.preventDefault();
  getElement('drop').classList.remove('drag');
  await readFiles(event.dataTransfer.files);
});
function createDownloadRow(file) {
  const div = document.createElement('div');
  div.className = 'download';
  const text = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = file.station;
  const small = document.createElement('small');
  const exportLabel = file.merged ? 'Additional merged export' : 'Original export';
  small.textContent = `${file.count} QSOs · ${exportLabel} · .adi`;
  text.append(title, small);
  const button = document.createElement('button');
  button.textContent = 'Download ↓';
  button.setAttribute(
    'aria-label',
    `Download ${file.merged ? 'merged ADIF' : 'ADIF'} for ${file.station}`
  );
  button.onclick = () => {
    const url = URL.createObjectURL(new Blob([file.text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  div.append(text, button);
  return div;
}

async function convertLog() {
  if (!combinedLog || getElement('convert').getAttribute('aria-disabled') === 'true') {
    return;
  }
  // A conversion belongs to this log revision; stale asynchronous results must not replace it.
  const revision = logRevision;
  const logSnapshot = combinedLog;
  const warnings = [...logSnapshot.warnings, ...(logSnapshot.lookupWarnings || [])];
  let errorFocus = null;
  setBusy(true);
  getElement('results').hidden = true;
  getElement('status').textContent = 'Preparing summit data…';
  try {
    const { qsos, filtered } = selectedContacts();
    if (getElement('mergeEnabled').checked) {
      const invalidInputs = [...document.querySelectorAll('#mergeRows input')].filter(
        (input) => input.validateMerge && !input.validateMerge()
      );
      if (invalidInputs.length) {
        getElement('mergeOptions').open = true;
        errorFocus = invalidInputs[0];
        throw new Error(
          'Review the destination fields marked invalid, or deselect those mappings.'
        );
      }
    }
    if (!qsos.length) {
      getElement('empty').hidden = false;
      getElement('resultBadge').textContent = 'NO CONTACTS IN DATE SELECTION';
      getElement('status').textContent =
        `No valid QSOs match the date selection. ${filtered} QSOs excluded by date. ` +
        `Clear or change the date to include contacts. ${logSnapshot.warnings.length} invalid rows; review warnings.`;
      warn(warnings);
      return;
    }
    if (getElement('enrich').checked) {
      const refs = [...new Set(qsos.flatMap((qso) => [qso.summit, qso.other]).filter(Boolean))];
      for (let i = 0; i < refs.length; i++) {
        const ref = refs[i];
        if (validLocator(summits.get(ref)?.locator || '') && !summits.get(ref)?.automatic) {
          failedLookups.delete(ref);
          continue;
        }
        getElement('status').textContent = `Looking up ${ref} (${i + 1}/${refs.length})…`;
        try {
          const data = await cachedSummitLookup(ref);
          if (revision !== logRevision) {
            return;
          }
          summits.set(ref, { ...data, automatic: true });
          failedLookups.delete(ref);
        } catch (error) {
          summits.delete(ref);
          failedLookups.add(ref);
          warnings.push(`${ref}: lookup failed (${error.message}). Enter its locator manually.`);
        }
      }
    }
    if (revision !== logRevision) {
      return;
    }
    renderSummits();
    const { files, skipped, warnings: exportWarnings } = makeOutputs(qsos, summits);
    warnings.push(...exportWarnings);
    warn([...warnings, ...skipped]);
    getElement('empty').hidden = !!files.length;
    getElement('results').hidden = !files.length;
    getElement('resultBadge').textContent = files.length
      ? logSnapshot.warnings.length || skipped.length
        ? 'PARTIAL EXPORT — CONTACTS EXCLUDED'
        : filtered
          ? 'ALL SELECTED CONTACTS EXPORTED'
          : 'ALL CONTACTS EXPORTED'
      : 'NO CONTACTS EXPORTED';
    const count = files.reduce((total, file) => total + file.count, 0);
    getElement('stats').replaceChildren(
      ...[
        [count, 'QSOs exported'],
        [files.length, 'Original ADIF files'],
        [filtered, 'QSOs excluded by date'],
        [qsos.length - count + logSnapshot.warnings.length, 'Rows / QSOs excluded due to errors']
      ].map(([value, label]) => {
        const div = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = value;
        const span = document.createElement('span');
        span.textContent = label;
        div.append(strong, span);
        return div;
      })
    );
    const mergedFiles = getElement('mergeEnabled').checked
      ? makeMergedOutputs(qsos, summits, mergeMappings)
      : [];
    const downloadFiles = [...files, ...mergedFiles];
    getElement('mergeDownloadWarning').hidden = !mergedFiles.length;
    getElement('mergeDownloadWarning').textContent =
      `${mergedFiles.length} additional merged files. These repeat contacts in the original files. ` +
      'Import one set per destination to avoid duplicates.';
    getElement('downloads').replaceChildren(...downloadFiles.map(createDownloadRow));
    getElement('preview').textContent = downloadFiles.map((file) => file.text).join('\n');
    const excludedCount = logSnapshot.warnings.length + skipped.length;
    const warningCount = warnings.length + skipped.length;
    let exportSummary;
    if (excludedCount) {
      exportSummary =
        `${excludedCount} rows / QSOs excluded: this is a partial export. ` +
        'Correct the CSV rows or enter missing summit locators and convert again.';
    } else {
      exportSummary = filtered ? 'All selected contacts exported.' : 'All contacts exported.';
    }
    const mergedSummary = mergedFiles.length
      ? ` ${mergedFiles.length} additional merged files available. ` +
        'These repeat contacts in the original files; import one set per destination to avoid duplicates.'
      : '';
    getElement('status').textContent = files.length
      ? `${count} QSOs exported. ${filtered} QSOs excluded by date. ${exportSummary} ` +
        `${warningCount} warnings; review details before importing.${mergedSummary}`
      : `No QSOs exported. ${warningCount} warnings; review warning details below. ` +
        'Add valid summit locators and try again.';
  } catch (error) {
    getElement('status').textContent = error.message;
    if (getElement('startDate').getAttribute('aria-invalid') === 'true') {
      errorFocus = getElement('startDate');
    }
  } finally {
    setBusy(false);
    getElement('convert').disabled = !combinedLog?.qsos.length;
    errorFocus?.focus();
  }
}
getElement('convert').onclick = convertLog;

// Display preferences remain independent of conversion and each other.
const themeToggle = getElement('themeToggle');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
let chosenTheme = null;
try {
  chosenTheme = localStorage.getItem('sotatoadif-theme');
} catch {
  // Display preferences are optional when browser storage is unavailable.
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
  themeToggle.textContent = 'Dark mode';
  themeToggle.setAttribute('aria-label', themeToggle.textContent);
}
applyTheme(document.documentElement.dataset.theme || 'light');
themeToggle.addEventListener('click', () => {
  chosenTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(chosenTheme);
  try {
    localStorage.setItem('sotatoadif-theme', chosenTheme);
  } catch {
    // Display preferences are optional when browser storage is unavailable.
  }
});
systemTheme.addEventListener('change', (event) => {
  if (chosenTheme !== 'dark' && chosenTheme !== 'light') {
    applyTheme(event.matches ? 'dark' : 'light');
  }
});

const contrastToggle = getElement('contrastToggle');
function applyContrast(high) {
  document.documentElement.dataset.contrast = high ? 'high' : 'normal';
  contrastToggle.setAttribute('aria-pressed', String(high));
}
applyContrast(document.documentElement.dataset.contrast === 'high');
contrastToggle.addEventListener('click', () => {
  const high = document.documentElement.dataset.contrast !== 'high';
  applyContrast(high);
  try {
    localStorage.setItem('sotatoadif-contrast', high ? 'high' : 'normal');
  } catch {
    // Display preferences are optional when browser storage is unavailable.
  }
});

const readingDefaults = {
  size: '100',
  width: '80',
  text: '#163d38',
  background: '#f4f6f2',
  custom: false
};
let reading = { ...readingDefaults };
try {
  const saved = JSON.parse(localStorage.getItem('sotatoadif-reading') || 'null');
  if (saved) {
    if (['100', '150', '200'].includes(saved.size)) {
      reading.size = saved.size;
    }
    if (['40', '60', '80'].includes(saved.width)) {
      reading.width = saved.width;
    }
    if (/^#[0-9a-f]{6}$/i.test(saved.text)) {
      reading.text = saved.text;
    }
    if (/^#[0-9a-f]{6}$/i.test(saved.background)) {
      reading.background = saved.background;
    }
    reading.custom = saved.custom === true;
  }
} catch {
  // Display preferences are optional when browser storage is unavailable.
}
function contrastRatio(text, background) {
  const luminance = (hex) => {
    const channels = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const textLuminance = luminance(text);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(textLuminance, backgroundLuminance) + 0.05) /
    (Math.min(textLuminance, backgroundLuminance) + 0.05)
  );
}

function applyReading() {
  const root = document.documentElement;
  root.style.setProperty('--reading-scale', Number(reading.size) / 100);
  root.style.setProperty('--reading-width', reading.width + 'ch');
  root.style.setProperty('--reading-text', reading.text);
  root.style.setProperty('--reading-bg', reading.background);
  root.dataset.readingCustom = String(reading.custom);
  getElement('readingSize').value = reading.size;
  getElement('readingWidth').value = reading.width;
  getElement('readingText').value = reading.text;
  getElement('readingBackground').value = reading.background;
  getElement('readingCustom').checked = reading.custom;
  const ratio = contrastRatio(reading.text, reading.background);
  const contrastAdvice =
    ratio >= 4.5
      ? 'Meets the 4.5:1 minimum for normal text.'
      : 'Below the 4.5:1 minimum for normal text. Choose different colours or reset reading preferences.';
  getElement('readingContrast').textContent = reading.custom
    ? `Custom text contrast: ${ratio.toFixed(2)}:1. ${contrastAdvice}`
    : 'Custom colours are off. Theme colours are active.';
}
for (const [id, key] of [
  ['readingSize', 'size'],
  ['readingWidth', 'width'],
  ['readingText', 'text'],
  ['readingBackground', 'background'],
  ['readingCustom', 'custom']
]) {
  getElement(id).addEventListener('change', () => {
    reading[key] = key === 'custom' ? getElement(id).checked : getElement(id).value;
    applyReading();
    try {
      localStorage.setItem('sotatoadif-reading', JSON.stringify(reading));
    } catch {
      // Display preferences are optional when browser storage is unavailable.
    }
  });
}
getElement('readingReset').addEventListener('click', () => {
  reading = { ...readingDefaults };
  applyReading();
  try {
    localStorage.removeItem('sotatoadif-reading');
  } catch {
    // Display preferences are optional when browser storage is unavailable.
  }
});
applyReading();
