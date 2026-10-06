# Repository Guidelines

## Project Structure & Module Organization

This is a dependency-free static browser port of SOTAtoADIF. `dist/` contains editable source files, not generated build output:

- `index.html` and `style.css`: page structure and responsive styling.
- `app.js`: file selection, summit lookup controls, previews, and downloads.
- `converter.js`: CSV parsing, validation, summit API requests, and ADIF generation.
- `summit-cache.js`: 24-hour local summit cache and concurrent lookup deduplication.
- `modes.js`: ADIF mode and submode mappings inherited from the Python project.
- `tests/converter.test.js`: conversion tests.

`LICENSE` and `dist/LICENSE` contain AGPLv3 text. `.openai/hosting.json` retains the previous hosted Site identity solely for removal; it is not deployment authorization.

## Build, Test, and Development Commands

No dependency installation or build step is required. Use Node.js for tests and Python for local serving:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
npm test
node --check dist/app.js
```

Open `http://127.0.0.1:8000` and refresh after edits. `npm test` runs Node's built-in test runner; `node --test tests/*.test.js` is equivalent. Syntax checks supplement behavioral tests.

## Coding Style & Naming Conventions

Use JavaScript ES modules, `const` by default, and `let` for reassignment. Use two-space indentation when expanding compact existing code. Name functions and variables in camelCase and test files `*.test.js`. Keep conversion logic separate from DOM interactions. No formatter or linter is configured. Preserve SPDX notices and original attribution.

## Testing Guidelines

Use `node:test` with `node:assert/strict`. Add focused tests for changed conversion behavior: quoted CSV, invalid rows, date/time validation, band/submode mapping, station grouping, missing locators, and S2S fields. Tests must be deterministic and independent of live API availability. No numerical coverage threshold is configured. Check UI changes locally, including automatic/manual locator visibility and failure recovery.

## Commit & Pull Request Guidelines

Automatically commit completed, verified changes as work progresses. Keep each commit focused on one logical change; do not wait for a separate request to commit. Include only files relevant to that change, and do not push without explicit authorization.

Use focused commits with concise imperative subjects, following the repository history, such as `Show manual locators only after lookup failure`. PR descriptions should explain behavior changes, validation, and limitations. Link relevant issues when available and include screenshots for visible UI changes.

## Privacy & Local-Only Operation

Keep CSV processing and ADIF generation in the browser. Send only summit references to the SOTA API; never upload logs or add telemetry. Do not publish or deploy this repository without a new explicit user request.
