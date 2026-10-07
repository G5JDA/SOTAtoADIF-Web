# SOTAtoADIF browser edition

A dependency-free, static webapp port of [G5JDA/SOTAtoADIF](https://github.com/G5JDA/SOTAtoADIF) v1.0.0. Copyright (c) 2024 Jack G5JDA. AGPL-3.0-or-later; see dist/LICENSE.

Serve `dist/` with any static web server (e.g. `python3 -m http.server 8000 --bind 127.0.0.1 --directory dist`). Open http://localhost:8000. Run tests with `node --test tests/*.test.js`.

All CSV parsing, validation, ADIF generation and downloads happen in the browser. Optional summit enrichment calls api2.sota.org.uk directly, passing summit references only. Successful summit names and locators are cached in localStorage for 24 hours and reused across files and refreshes. Failed lookups are not cached. If browser storage is unavailable, an in-memory cache is used. No conversion backend, uploads, cookies, analytics, external assets or dependencies. Disable enrichment and enter locators manually for offline conversion after loading the page.

Supports the original implemented activator workflow, SOTA V2 CSV, UTC times, original band/mode mappings, summit locator enrichment and one ADIF file per station callsign. Chaser mode and separate S2S merging were unimplemented upstream and remain outside scope. Fixes upstream duplicate MY_SOTA_REF and wrong S2S comment. Invalid dates/modes/frequencies and missing locators are reported instead of silently producing invalid output. Files without valid QSOs produce no download.

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
