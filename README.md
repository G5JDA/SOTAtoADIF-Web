# SOTAtoADIF browser edition

A dependency-free, static webapp port of [G5JDA/SOTAtoADIF](https://github.com/G5JDA/SOTAtoADIF) v1.0.0. Copyright (c) 2024 Jack G5JDA. GPL-3.0-or-later; see dist/LICENSE.

Serve `dist/` with any static web server (e.g. `python3 -m http.server 8000 --directory dist`). Open http://localhost:8000. Run tests with `node --test tests/*.test.js`.

All CSV parsing, validation, ADIF generation and downloads happen in the browser. Optional summit enrichment calls api2.sota.org.uk directly, passing summit references only. No conversion backend, uploads, cookies, analytics, external assets or dependencies. Disable enrichment and enter locators manually for offline conversion after loading the page.

Supports the original implemented activator workflow, SOTA V2 CSV, UTC times, original band/mode mappings, summit locator enrichment and one ADIF file per station callsign. Chaser mode and separate S2S merging were unimplemented upstream and remain outside scope. Fixes upstream duplicate MY_SOTA_REF and wrong S2S comment. Invalid dates/modes/frequencies and missing locators are reported instead of silently producing invalid output. Files without valid QSOs produce no download.
