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
// Resolve the fixed element IDs shared by the page markup and its UI handlers.
const getElement = (id) => document.getElementById(id);
// Associate validation with live destination fields without retaining rows after they are replaced.
const mergeValidators = new WeakMap();
let combinedLog = null;
let summits = new Map();
let failedLookups = new Set();
let logRevision = 0;
let isBusy = false;
let mergeMappings = new Map();
let activatorLog = null;
let s2sLog = null;
let activatorFilename = '';
let s2sFilename = '';
let chaserLog = null;
let chaserFilename = '';

// Lock log-changing controls; aria-disabled lets conversion keep focus while its action is blocked.
function setBusy(disabled) {
  isBusy = disabled;
  getElement('convert').setAttribute('aria-disabled', String(disabled));
  getElement('file').disabled = disabled;
  getElement('clearChaser').disabled = disabled || !chaserLog;
  getElement('clearMain').disabled = disabled || !activatorLog;
  getElement('clearS2S').disabled = disabled || !s2sLog;
  getElement('enrich').disabled = disabled;
  getElement('startDate').disabled = disabled;
  getElement('mergeEnabled').disabled = disabled;
  for (const input of document.querySelectorAll('#mergeRows input')) {
    input.disabled = disabled;
  }
  for (const input of document.querySelectorAll('#summitRows input')) {
    input.disabled = disabled;
  }
  getElement('drop').setAttribute('aria-disabled', String(disabled));
}

// Read and classify a selection locally; apply it only after every file has been parsed successfully.
async function readFiles(files) {
  if (isBusy || !files?.length) {
    return;
  }
  setBusy(true);
  getElement('results').hidden = true;
  // Parse the entire selection before replacing any previously loaded log.
  const pendingLogs = new Map();
  const logReaders = { activator: readLog, s2s: readS2S, chaser: readChaser };
  let currentFilename = 'CSV';
  try {
    for (const file of Array.from(files)) {
      currentFilename = file.name;
      const text = await file.text();
      const type = detectLogType(text, file.name);
      if (pendingLogs.has(type)) {
        throw new Error(
          `Select only one ${type} log at a time. No files from this selection were applied.`
        );
      }
      pendingLogs.set(type, {
        name: file.name,
        log: logReaders[type](text)
      });
    }
    // Replace only the supplied log types; other loaded files remain available for joining.
    if (pendingLogs.has('activator')) {
      activatorLog = pendingLogs.get('activator').log;
      activatorFilename = pendingLogs.get('activator').name;
    }
    if (pendingLogs.has('s2s')) {
      s2sLog = pendingLogs.get('s2s').log;
      s2sFilename = pendingLogs.get('s2s').name;
    }
    if (pendingLogs.has('chaser')) {
      chaserLog = pendingLogs.get('chaser').log;
      chaserFilename = pendingLogs.get('chaser').name;
    }
    rebuildLog();
  } catch (error) {
    getElement('empty').hidden = false;
    getElement('convert').disabled = !combinedLog?.qsos.length;
    getElement('resultBadge').textContent = 'FILE READ FAILED';
    getElement('status').textContent =
      `Could not read ${currentFilename}. Select the file again or export a new CSV. ` +
      `${error.message} Previously loaded files were retained.`;
  } finally {
    setBusy(false);
    // Clearing the picker permits selecting the same filename again after a read failure.
    getElement('file').value = '';
  }
}
// Removing a log rejoins the remaining files and returns focus to the upload control.
getElement('clearS2S').addEventListener('click', () => {
  if (isBusy) {
    return;
  }
  s2sLog = null;
  s2sFilename = '';
  rebuildLog();
  setBusy(false);
  getElement('file').focus();
});
getElement('clearMain').addEventListener('click', () => {
  if (isBusy) {
    return;
  }
  activatorLog = null;
  activatorFilename = '';
  rebuildLog();
  setBusy(false);
  getElement('file').focus();
});
getElement('clearChaser').addEventListener('click', () => {
  if (isBusy) {
    return;
  }
  chaserLog = null;
  chaserFilename = '';
  rebuildLog();
  setBusy(false);
  getElement('file').focus();
});
// Open actionable warning details automatically and replace messages using text nodes.
function renderWarnings(messages) {
  getElement('warningBox').hidden = !messages.length;
  getElement('warningBox').open = messages.length > 0;
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

// Rejoin the currently loaded logs and reset any conversion state tied to the previous selection.
function rebuildLog() {
  getElement('fileLabel').textContent = 'Drop your SOTA CSV files here';
  getElement('mainName').textContent = activatorLog ? `Activator: ${activatorFilename}` : '';
  getElement('s2sName').textContent = s2sLog ? `S2S: ${s2sFilename}` : '';
  getElement('loadedFiles').hidden = !activatorLog && !s2sLog && !chaserLog;
  getElement('chaserFileRow').hidden = !chaserLog;
  getElement('chaserName').textContent = chaserLog ? `Chaser: ${chaserFilename}` : '';
  getElement('mainFileRow').hidden = !activatorLog;
  getElement('s2sFileRow').hidden = !s2sLog;
  // Prefer activator records as the base; an S2S or chaser log can also stand alone.
  combinedLog = activatorLog || s2sLog || chaserLog;
  const s2sJoin = activatorLog && s2sLog ? joinS2S(activatorLog.qsos, s2sLog.qsos) : null;
  if (s2sJoin) {
    combinedLog = {
      qsos: s2sJoin.qsos,
      warnings: activatorLog.warnings,
      // Supplementary S2S warnings describe enrichment problems, not rejected base contacts.
      lookupWarnings: [...s2sLog.warnings, ...s2sJoin.warnings]
    };
  }
  getElement('s2sSummary').hidden = !s2sLog;
  getElement('s2sSummary').textContent = s2sJoin
    ? `${s2sJoin.enriched} S2S contacts matched; ${s2sJoin.unmatched} unmatched, ` +
      `${s2sJoin.ambiguous} ambiguous, ${s2sJoin.conflicts} conflicting. ` +
      'S2S-only unmatched contacts are not appended.'
    : s2sLog
      ? `${s2sLog.qsos.length} S2S contacts available for standalone conversion.`
      : '';
  // Join chaser contacts after S2S enrichment; unlike S2S, unmatched chaser contacts are appended.
  const chaserJoin =
    chaserLog && (activatorLog || s2sLog) ? joinChaser(combinedLog.qsos, chaserLog.qsos) : null;
  if (chaserJoin) {
    combinedLog = {
      qsos: chaserJoin.qsos,
      warnings: [...combinedLog.warnings, ...chaserLog.warnings],
      lookupWarnings: [...(combinedLog.lookupWarnings || []), ...chaserJoin.warnings]
    };
  }
  getElement('chaserSummary').hidden = !chaserLog;
  getElement('chaserSummary').textContent = chaserJoin
    ? `${chaserJoin.enriched} chaser contacts matched; ${chaserJoin.added} additional contacts; ` +
      `${chaserJoin.ambiguous} ambiguous, ${chaserJoin.conflicts} conflicting. ` +
      'Chaser-only contacts have no own summit or locator.'
    : chaserLog
      ? `${chaserLog.qsos.length} chaser contacts. Own summit and locator are omitted; ` +
        'worked summit locators can be looked up.'
      : '';
  // Manual locators and mapping choices belong to this selection; cached API data stays reusable.
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
  renderWarnings([...(combinedLog?.warnings || []), ...(combinedLog?.lookupWarnings || [])]);
  renderSummits();
}

// Hide downloads whose settings have changed and prompt the user to generate fresh exports.
function invalidateExports() {
  getElement('results').hidden = true;
  getElement('empty').hidden = false;
  getElement('resultBadge').textContent = 'RECONVERT TO UPDATE';
  getElement('status').textContent = 'Export options changed. Convert again to update downloads.';
}

// Build one opt-in callsign mapping with its destination field and accessible validation feedback.
function createMergeRow(station, index) {
  const mergeRow = document.createElement('div');
  mergeRow.className = 'merge-row';
  const includeLabel = document.createElement('label');
  includeLabel.className = 'check';
  const includeCheckbox = document.createElement('input');
  includeCheckbox.type = 'checkbox';
  includeCheckbox.checked = mergeMappings.has(station);
  const callsignText = document.createElement('span');
  callsignText.textContent = `Include ${station}`;
  includeLabel.append(includeCheckbox, callsignText);
  const destinationLabel = document.createElement('label');
  destinationLabel.textContent = `Destination for ${station}`;
  const destinationInput = document.createElement('input');
  destinationInput.type = 'text';
  destinationInput.value = mergeMappings.get(station) || proposeMerge(station);
  destinationInput.id = `merge-target-${index}`;
  destinationLabel.htmlFor = destinationInput.id;
  destinationInput.setAttribute('aria-label', `Destination for ${station}`);
  destinationInput.placeholder = 'Operating callsign';
  const validationMessage = document.createElement('span');
  validationMessage.id = `merge-error-${index}`;
  validationMessage.className = 'locator-error';
  validationMessage.hidden = true;
  destinationInput.setAttribute('aria-describedby', validationMessage.id);
  // An unchecked row has no effect on exports, so its destination need not pass validation.
  const validateDestination = () => {
    const isInvalid =
      includeCheckbox.checked &&
      !validMergeTarget(station, destinationInput.value.trim().toUpperCase());
    destinationInput.setAttribute('aria-invalid', String(isInvalid));
    validationMessage.hidden = !isInvalid;
    validationMessage.textContent = isInvalid
      ? 'Enter a different operating callsign using letters, digits and slashes, or deselect this mapping.'
      : '';
    return !isInvalid;
  };
  // Conversion validates the currently rendered destinations and focuses the first invalid input.
  mergeValidators.set(destinationInput, validateDestination);
  validateDestination();
  // Save only checked mappings; any change invalidates the previously generated downloads.
  const updateMapping = () => {
    if (isBusy) {
      return;
    }
    const target = destinationInput.value.trim().toUpperCase();
    if (includeCheckbox.checked) {
      mergeMappings.set(station, target);
    } else {
      mergeMappings.delete(station);
    }
    validateDestination();
    invalidateExports();
  };
  includeCheckbox.addEventListener('change', updateMapping);
  destinationInput.addEventListener('input', updateMapping);
  mergeRow.append(includeLabel, destinationLabel, destinationInput, validationMessage);
  return mergeRow;
}

// Show reviewed mappings only when requested; only slash-containing station callsigns get a merge row.
function renderMergeOptions() {
  getElement('mergePanel').hidden = !getElement('mergeEnabled').checked;
  const stations = [...new Set((combinedLog?.qsos || []).map((qso) => qso.station))].filter(
    (station) => station.includes('/')
  );
  getElement('mergeEmpty').hidden = stations.length > 0;
  getElement('mergeRows').replaceChildren(...stations.map(createMergeRow));
}
getElement('mergeEnabled').addEventListener('change', () => {
  if (isBusy) {
    return;
  }
  renderMergeOptions();
  invalidateExports();
});
renderMergeOptions();

// Require a syntactically valid destination that actually changes the source operating callsign.
function validMergeTarget(source, target) {
  return validCallsign(target) && target !== source;
}

// Validate the date control before returning contacts; invalid input also updates its error message.
function readDateSelection() {
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
// Date edits invalidate exports and recalculate which summit fields are relevant.
getElement('startDate').addEventListener('change', () => {
  if (isBusy) {
    return;
  }
  getElement('results').hidden = true;
  getElement('empty').hidden = false;
  try {
    const selection = readDateSelection();
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
// Preserve first-seen order and request each own or worked summit only once.
function getSummitReferences(qsos) {
  return [...new Set(qsos.flatMap((qso) => [qso.summit, qso.other]).filter(Boolean))];
}

// Build a manual locator field; an own-summit locator is required, but a worked-summit locator is optional.
function createSummitRow(ref, index, ownSummitRefs) {
  const summitRow = document.createElement('label');
  summitRow.className = 'summit';
  const summitLabel = document.createElement('span');
  summitLabel.id = `locator-label-${index}`;
  const isRequired = ownSummitRefs.has(ref);
  summitLabel.textContent =
    ref +
    ` · ${isRequired ? 'own summit — required' : 'worked summit — optional'}` +
    (summits.get(ref)?.name ? ` · ${summits.get(ref).name}` : '');
  const locatorInput = document.createElement('input');
  locatorInput.placeholder = 'Locator';
  locatorInput.value = summits.get(ref)?.locator || '';
  locatorInput.setAttribute('aria-labelledby', summitLabel.id);
  locatorInput.required = isRequired;
  locatorInput.setAttribute('aria-required', String(isRequired));
  locatorInput.pattern = '[A-Ra-r]{2}[0-9]{2}([A-Xa-x]{2}([0-9]{2})?)?';
  const validationMessage = document.createElement('span');
  validationMessage.id = `locator-error-${index}`;
  validationMessage.className = 'locator-error';
  locatorInput.setAttribute('aria-describedby', validationMessage.id);
  // A blank optional worked locator is valid; a missing own locator must be explained to the user.
  function validateLocator() {
    const value = locatorInput.value.trim();
    const isInvalid = value ? !validLocator(value) : isRequired;
    locatorInput.setAttribute('aria-invalid', String(isInvalid));
    validationMessage.textContent = isInvalid
      ? value
        ? 'Invalid locator. Use a Maidenhead locator such as IO81XW.'
        : 'Enter a Maidenhead locator, such as IO81XW.'
      : ' ';
    validationMessage.hidden = !isInvalid;
  }
  validateLocator();
  locatorInput.addEventListener('input', () => {
    summits.set(ref, { locator: locatorInput.value.trim().toUpperCase() });
    validateLocator();
    getElement('results').hidden = true;
    getElement('empty').hidden = false;
    getElement('resultBadge').textContent = 'RECONVERT TO UPDATE';
  });
  const locatorField = document.createElement('span');
  locatorField.className = 'locator-field';
  locatorField.append(locatorInput, validationMessage);
  summitRow.append(summitLabel, locatorField);
  return summitRow;
}

// Offer manual fields for selected summits, or only failed lookups when automatic enrichment is enabled.
function renderSummits() {
  if (getElement('startDate').getAttribute('aria-invalid') === 'true') {
    getElement('locators').hidden = true;
    return;
  }
  const { qsos } = readDateSelection();
  // A reference appearing as both own and worked retains the stricter own-summit requirement.
  const ownSummitRefs = new Set(qsos.map((qso) => qso.summit).filter(Boolean));
  const summitRefs = getSummitReferences(qsos).filter(
    (ref) => !getElement('enrich').checked || failedLookups.has(ref)
  );
  getElement('locators').hidden = !summitRefs.length;
  getElement('summitRows').replaceChildren(
    ...summitRefs.map((ref, index) => createSummitRow(ref, index, ownSummitRefs))
  );
}
// Lookup preference changes alter manual-field visibility without discarding entered locators.
getElement('enrich').addEventListener('change', () => {
  if (!isBusy) {
    renderSummits();
  }
});
// The picker and drop area share the same parsing, duplicate-type checks and busy-state guard.
getElement('file').addEventListener('change', async (event) => {
  await readFiles(event.target.files);
});
getElement('drop').addEventListener('dragover', (event) => {
  event.preventDefault();
  if (!isBusy) {
    getElement('drop').classList.add('drag');
  }
});
getElement('drop').addEventListener('dragleave', () => getElement('drop').classList.remove('drag'));
getElement('drop').addEventListener('drop', async (event) => {
  event.preventDefault();
  getElement('drop').classList.remove('drag');
  await readFiles(event.dataTransfer.files);
});

// Present one original or merged export and create its downloadable Blob only when requested.
function createDownloadRow(file) {
  const downloadRow = document.createElement('div');
  downloadRow.className = 'download';
  const summary = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = file.station;
  const details = document.createElement('small');
  const exportLabel = file.merged ? 'Additional merged export' : 'Original export';
  details.textContent = `${file.count} QSOs · ${exportLabel} · .adi`;
  summary.append(title, details);
  const downloadButton = document.createElement('button');
  downloadButton.textContent = 'Download ↓';
  downloadButton.setAttribute(
    'aria-label',
    `Download ${file.merged ? 'merged ADIF' : 'ADIF'} for ${file.station}`
  );
  downloadButton.onclick = () => {
    const url = URL.createObjectURL(new Blob([file.text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    // Give the browser time to begin the download before releasing the temporary object URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  downloadRow.append(summary, downloadButton);
  return downloadRow;
}

// Enrich unique summits sequentially and collect recoverable lookup failures for manual entry.
async function fetchSummitLocators(qsos, revision, warnings) {
  const summitRefs = getSummitReferences(qsos);
  for (let index = 0; index < summitRefs.length; index++) {
    const summitRef = summitRefs[index];
    // Keep valid manual values; automatic values still go through the cache's expiry check.
    if (validLocator(summits.get(summitRef)?.locator || '') && !summits.get(summitRef)?.automatic) {
      failedLookups.delete(summitRef);
      continue;
    }
    getElement('status').textContent =
      `Looking up ${summitRef} (${index + 1}/${summitRefs.length})…`;
    try {
      const data = await cachedSummitLookup(summitRef);
      // A resolved request must not update summit data for a replaced log selection.
      if (revision !== logRevision) {
        return;
      }
      summits.set(summitRef, { ...data, automatic: true });
      failedLookups.delete(summitRef);
    } catch (error) {
      summits.delete(summitRef);
      failedLookups.add(summitRef);
      warnings.push(`${summitRef}: lookup failed (${error.message}). Enter its locator manually.`);
    }
  }
}

// Distinguish export errors from deliberate date exclusions in the short result badge.
function getExportBadge(hasFiles, excludedCount, filteredCount) {
  if (!hasFiles) {
    return 'NO CONTACTS EXPORTED';
  }
  if (excludedCount) {
    return 'PARTIAL EXPORT — CONTACTS EXCLUDED';
  }
  return filteredCount ? 'ALL SELECTED CONTACTS EXPORTED' : 'ALL CONTACTS EXPORTED';
}

// Display counts, warning details and downloads without counting additional merged files as new contacts.
function renderConversionResults({
  qsos,
  filtered,
  invalidRowCount,
  warnings,
  output,
  mergedFiles
}) {
  const { files, skipped, warnings: exportWarnings } = output;
  const allWarnings = [...warnings, ...exportWarnings];
  renderWarnings([...allWarnings, ...skipped]);
  getElement('empty').hidden = files.length > 0;
  getElement('results').hidden = !files.length;
  // Warnings about retained fields or joins are separate from contacts excluded due to errors.
  const excludedCount = invalidRowCount + skipped.length;
  getElement('resultBadge').textContent = getExportBadge(files.length > 0, excludedCount, filtered);
  const exportedCount = files.reduce((total, file) => total + file.count, 0);
  getElement('stats').replaceChildren(
    ...[
      [exportedCount, 'QSOs exported'],
      [files.length, 'Original ADIF files'],
      [filtered, 'QSOs excluded by date'],
      [qsos.length - exportedCount + invalidRowCount, 'Rows / QSOs excluded due to errors']
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
  // Merged files repeat original contacts; list them as alternatives and warn against importing both.
  const downloadFiles = [...files, ...mergedFiles];
  getElement('mergeDownloadWarning').hidden = !mergedFiles.length;
  getElement('mergeDownloadWarning').textContent =
    `${mergedFiles.length} additional merged files. These repeat contacts in the original files. ` +
    'Import one set per destination to avoid duplicates.';
  getElement('downloads').replaceChildren(...downloadFiles.map(createDownloadRow));
  getElement('preview').textContent = downloadFiles.map((file) => file.text).join('\n');
  const warningCount = allWarnings.length + skipped.length;
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
    ? `${exportedCount} QSOs exported. ${filtered} QSOs excluded by date. ${exportSummary} ` +
      `${warningCount} warnings; review details before importing.${mergedSummary}`
    : `No QSOs exported. ${warningCount} warnings; review warning details below. ` +
      'Add valid summit locators and try again.';
}

// Coordinate validation, optional enrichment and export generation; always restore controls on exit.
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
    const { qsos, filtered } = readDateSelection();
    // Validate live mapping controls before any requests; defer error focus until controls unlock.
    if (getElement('mergeEnabled').checked) {
      const invalidInputs = [...document.querySelectorAll('#mergeRows input')].filter((input) => {
        const validate = mergeValidators.get(input);
        return validate && !validate();
      });
      if (invalidInputs.length) {
        getElement('mergeOptions').open = true;
        errorFocus = invalidInputs[0];
        throw new Error(
          'Review the destination fields marked invalid, or deselect those mappings.'
        );
      }
    }
    // An empty date selection is a recoverable result, not an API or conversion failure.
    if (!qsos.length) {
      getElement('empty').hidden = false;
      getElement('resultBadge').textContent = 'NO CONTACTS IN DATE SELECTION';
      getElement('status').textContent =
        `No valid QSOs match the date selection. ${filtered} QSOs excluded by date. ` +
        `Clear or change the date to include contacts. ${logSnapshot.warnings.length} invalid rows; review warnings.`;
      renderWarnings(warnings);
      return;
    }
    if (getElement('enrich').checked) {
      await fetchSummitLocators(qsos, revision, warnings);
    }
    if (revision !== logRevision) {
      return;
    }
    renderSummits();
    // Original station files are always generated; reviewed mappings add separate optional exports.
    const output = makeOutputs(qsos, summits);
    const mergedFiles = getElement('mergeEnabled').checked
      ? makeMergedOutputs(qsos, summits, mergeMappings)
      : [];
    renderConversionResults({
      qsos,
      filtered,
      invalidRowCount: logSnapshot.warnings.length,
      warnings,
      output,
      mergedFiles
    });
  } catch (error) {
    getElement('status').textContent = error.message;
    if (getElement('startDate').getAttribute('aria-invalid') === 'true') {
      errorFocus = getElement('startDate');
    }
  } finally {
    setBusy(false);
    getElement('convert').disabled = !combinedLog?.qsos.length;
    // Disabled destination/date controls cannot reliably receive focus until they are re-enabled.
    errorFocus?.focus();
  }
}
getElement('convert').onclick = convertLog;

// Preference persistence is best-effort; blocked storage must not prevent normal use.
// Read an optional saved value, treating inaccessible storage as an unset preference.
function readStoredPreference(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Save a display preference, or remove its saved override when value is null; storage failures are optional.
function writeStoredPreference(key, value) {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // The current preference still applies for this page session.
  }
}

// Display preferences remain independent of conversion and each other.
const themeToggle = getElement('themeToggle');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
let chosenTheme = readStoredPreference('sotatoadif-theme');
// Keep the CSS theme and the toggle's accessible pressed state in sync.
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
  writeStoredPreference('sotatoadif-theme', chosenTheme);
});
// Follow operating-system theme changes only until the user has made an explicit theme choice.
systemTheme.addEventListener('change', (event) => {
  if (chosenTheme !== 'dark' && chosenTheme !== 'light') {
    applyTheme(event.matches ? 'dark' : 'light');
  }
});

const contrastToggle = getElement('contrastToggle');
// Apply high contrast independently of the light/dark theme, preserving both choices.
function applyContrast(high) {
  document.documentElement.dataset.contrast = high ? 'high' : 'normal';
  contrastToggle.setAttribute('aria-pressed', String(high));
}
applyContrast(document.documentElement.dataset.contrast === 'high');
contrastToggle.addEventListener('click', () => {
  const high = document.documentElement.dataset.contrast !== 'high';
  applyContrast(high);
  writeStoredPreference('sotatoadif-contrast', high ? 'high' : 'normal');
});

// Validate saved reading preferences against supported options before applying them to the page.
const readingDefaults = {
  size: '100',
  width: '80',
  text: '#163d38',
  background: '#f4f6f2',
  custom: false
};
let reading = { ...readingDefaults };
try {
  const saved = JSON.parse(readStoredPreference('sotatoadif-reading') || 'null');
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
  // Ignore malformed saved JSON and retain the reading defaults.
}

// Calculate the WCAG contrast ratio for two validated six-digit sRGB hex colours.
function contrastRatio(text, background) {
  // Relative luminance combines linearized colour channels using their perceptual weights.
  const relativeLuminance = (hex) => {
    // Convert sRGB channels to linear light before applying luminance weights.
    const channels = [1, 3, 5]
      .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      );
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const textLuminance = relativeLuminance(text);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(textLuminance, backgroundLuminance) + 0.05) /
    (Math.min(textLuminance, backgroundLuminance) + 0.05)
  );
}

// Apply reading preferences to CSS and controls, and report custom-colour contrast without changing choices.
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
// Each reading control updates one preference, reapplies the complete set, and saves it locally.
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
    writeStoredPreference('sotatoadif-reading', JSON.stringify(reading));
  });
}
// Reset both the active reading settings and the saved override so the defaults apply next time.
getElement('readingReset').addEventListener('click', () => {
  reading = { ...readingDefaults };
  applyReading();
  writeStoredPreference('sotatoadif-reading', null);
});
applyReading();
