# SOTAtoADIF browser edition

A dependency-free, static webapp port of [G5JDA/SOTAtoADIF](https://github.com/G5JDA/SOTAtoADIF) v1.0.0. Copyright (c) 2024 Jack G5JDA. AGPL-3.0-or-later; see dist/LICENSE.

Serve `dist/` with any static web server (e.g. `python3 -m http.server 8000 --bind 127.0.0.1 --directory dist`). Open http://localhost:8000. Run tests with `node --test tests/*.test.js`.

All CSV parsing, validation, ADIF generation and downloads happen in the browser. Optional summit enrichment calls api2.sota.org.uk directly, passing summit references only. Successful summit names and locators are cached in localStorage for 24 hours and reused across files and refreshes. Failed lookups are not cached. If browser storage is unavailable, an in-memory cache is used. No conversion backend, uploads, cookies, analytics, external assets or dependencies. Disable enrichment and enter locators manually for offline conversion after loading the page.

Supports the original implemented activator workflow, SOTA V2 CSV, UTC times, original band/mode mappings, summit locator enrichment and one ADIF file per station callsign. Chaser imports are supported. Optional S2S imports can enrich activator contacts or be converted alone. Fixes upstream duplicate MY_SOTA_REF and wrong S2S comment. Invalid dates/modes/frequencies and missing locators are reported instead of silently producing invalid output. Files without valid QSOs produce no download.

SOTA's generic `DATA` mode is accepted in all log types and exported unchanged as `<MODE:4>DATA`, without assigning a specific digital mode or submode. This is an intentional extension outside ADIF's standard mode enumeration; other logging programs may reject these contacts or require their mode to be corrected before importing. The page includes a compatibility note for users. It remains `DATA` when matching, filtering and merging contacts.

## Hosting preference

Run this project locally only. Do not publish or deploy it to ChatGPT Sites. The previous Site identity in .openai/hosting.json is retained solely to identify the existing hosted copy for removal; it does not authorize deployment.

## License

This browser port is licensed under the GNU Affero General Public License, version 3 or (at your option) any later version. See LICENSE (also served as dist/LICENSE). Original project attribution is retained; the upstream Python repository remains under its own GPL-3.0-or-later license.

## Home-screen installation

The manifest uses relative URLs and includes Android and Apple home-screen icons. Open the app on a phone-accessible URL and use the browser’s installation or Add to Home Screen option (on iOS, Share → Add to Home Screen). Installation availability depends on the browser and secure-origin requirements. No service worker or offline app-shell caching is provided.

## Date selection

Use “Include contacts on or after” to export a portion of a full log. The selected UTC date is inclusive; leave it blank for the whole log. Older valid contacts are filtered before summit lookups and counted separately from errors. Invalid CSV rows remain reported. Changing the date requires another conversion.

## Optional suffix merging

Expand “Additional callsign exports” and enable merging to review mappings. Select each source and edit its destination if needed. All trailing suffixes can be merged; overseas prefixes are preserved (EA/G1ABC/P → EA/G1ABC). Review trailing overseas locations such as G1ABC/EA/P and keep the location in the destination. Ambiguous formats need a manually entered destination. Originals remain available; additional files contain only selected source contacts, excluding contacts already logged under the destination. Import one set per destination to avoid duplicates. Date filtering also applies to merged exports.

## Feature validation

Automated conversion and DOM tests cover inclusive UTC date boundaries (including year changes and leap days), empty selections, mixed home/overseas callsigns, unchanged ADIF contact fields, distinct original/merged filenames, accessible mapping/download names, and control locking during asynchronous lookups. Run `node --test tests/*.test.js`.

Manual browser checks covered date entry and focus, keyboard merge toggling and tab navigation, all four light/dark and normal/high-contrast combinations, desktop and 390px mobile layouts, and merge mappings at 200% reading text size. Synthetic logs verified filtered and empty selections and separate home/overseas merged downloads. Browser automation did not confirm actual file download completion; generated download contents are tested in the DOM suite. These checks do not constitute a WCAG conformance claim.

## S2S imports

Use the shared picker or drop area for an activator, S2S or chaser CSVs, together or in either order. The 12-column layout or points header identifies S2S exports; the original filename provides a fallback for S2S, and normal V2 records identify activator logs. Loaded filenames and roles are shown with individual removal controls. Selecting a new file replaces that role; duplicate roles in one selection or read errors reject the entire selection and retain existing logs. Its header and trailing points columns are accepted. With both files, the activator list is authoritative: matches enrich existing contacts; unmatched S2S rows are not appended. Matching uses normalized station/worked callsigns, own summit, UTC date/time, band, mode and submode. Comments are preserved from the activator file. Repeated matching keys are reported as ambiguous; conflicting worked summit references retain the original. The summary applies to the full input before date filtering.

The worked summit becomes SOTA_REF; cached lookup or manual entry supplies GRIDSQUARE. A missing worked locator does not exclude the contact. Date filtering and optional suffix merging use the enriched contacts. Removing or replacing the S2S file invalidates prior results. The shared picker and both removal controls lock during conversion. No logs are uploaded or stored persistently, and private example logs must never be committed or used to derive test fixtures.

S2S verification used synthetic fixtures only. Tests cover standalone/both-file imports, removal and read-failure recovery, duplicate prevention, ambiguity/conflicts, date filtering, merged exports, locator enrichment and failed DX lookups. Browser checks verified matching counts, manual locators, keyboard focus, all four themes and mobile layout on local port 8003.

## Chaser imports and combinations

The shared area also accepts chaser V2 exports (empty own summit, worked summit, and optional trailing points). Chaser-only contacts export SOTA_REF and optional worked GRIDSQUARE, omitting unknown MY_SOTA_REF and MY_GRIDSQUARE. No own locator is guessed.

Any log can be used alone. Activator + S2S enriches matched activator contacts without appending unmatched S2S records. Activator + chaser and S2S + chaser match on station/worked callsigns, UTC date/time, band, mode and submode; matching contacts retain their own summit and receive the worked reference. Additional chaser contacts are appended. All three first joins S2S to activator, then merges chaser. Repeated matching keys and conflicting references are reported without guessing or adding duplicate overlaps. Matching summaries precede date filtering; suffix merging preserves unknown own fields.

Chaser verification uses synthetic data only: standalone exports, all-three overlap/new-contact handling, S2S + chaser after activator removal, ambiguity/conflicts, and missing own fields. Browser checks covered standalone conversion, role/removal labels, keyboard focus and mobile themes on port 8005. Private sample logs and derivatives are not included.

The DOM regression suite exercises date filtering and reviewed suffix merging across all seven non-empty combinations of activator, S2S and chaser uploads. It checks cutoff inclusion, empty selections, clearing the date, disabling merging, separate home/overseas exports, exclusion of plain callsign contacts from additional files, accurate contact counts and preserved S2S/locator fields. Matching summaries describe full inputs before date selection; export counts describe selected contacts.

## Search and sharing metadata

The HTML includes a descriptive title, description, Open Graph and Twitter summary metadata, plus WebApplication structured data. The manifest description covers all three supported log types. Metadata is static and contains no uploaded log data. Before a future authorized public launch, add the chosen absolute HTTPS canonical URL and og:url, and an absolute social-preview image URL if a dedicated image is created. No public domain or localhost canonical is assumed. Metadata alone does not guarantee search indexing or rich results.

`dist/robots.txt` permits crawling and contains no assumed public sitemap URL. Localhost remains inaccessible to public crawlers; robots.txt is not access control. `dist/humans.txt` provides project credits and technology notes and is linked from the HTML head.

Accessibility recovery checks cover incomplete native dates, associated merge errors with focus recovery, file-removal focus, required/optional locator labels, merged-export live announcements and custom-colour contrast feedback. Reading recovery controls keep fixed readable colours when custom colours are active. Browser checks on port 8006 verified merge-error focus, removal focus and mobile recovery at 1:1 custom contrast. These checks do not constitute a screen-reader audit or conformance claim.

ADIF comments use printable ASCII: accents are removed where possible, line breaks and tabs become spaces, and unsupported characters become `?`. Export warnings identify changed comments; source CSV text remains unchanged. Invalid worked locators are omitted with a warning while retaining the contact. Rejected uploads preserve manual locators and callsign mappings.

Input callsigns must contain letters and digits and may have slash-separated operating prefixes or suffixes; no national prefix list is assumed. Contact dates must be valid UTC dates in 1930 or later. Summit references must have the form `G/CE-001`; malformed references are rejected before export or API lookup.
