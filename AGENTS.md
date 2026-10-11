# Repository Guidelines

## Project Structure & Module Organization

This is a dependency-free static browser port of SOTAtoADIF. `dist/` contains editable source files, not generated build output:

- `index.html` and `style.css`: page structure and responsive styling.
- `app.js`: file selection, summit lookup controls, previews, and downloads.
- `converter.js`: CSV parsing, validation, summit API requests, and ADIF generation.
- `summit-cache.js`: 24-hour local summit cache and concurrent lookup deduplication.
- `modes.js`: ADIF mode and submode mappings inherited from the Python project.
- `manifest.webmanifest`, `icons/`, and `favicon.svg`: installation metadata and local app assets.
- `tests/`: conversion, summit cache, DOM interaction, and Git hook regression tests.
- `.githooks/pre-commit`: staged secret scanning with Gitleaks.
- `README.md` and `DEPLOYMENT.md`: user workflow, validation notes, and hosting security-header guidance.

The app has no runtime dependencies or generated build output. Do not ignore or regenerate `dist/` as a build directory. `LICENSE` and `dist/LICENSE` contain AGPLv3 text; preserve original attribution and SPDX notices.

Local tool directories, including `.openai/`, are ignored and are not repository configuration or deployment authorization. Do not force-add ignored files.

## Build, Test, and Development Commands

No application dependency installation or build step is required. Use Node.js for tests, Python for local serving, and Gitleaks for commit checks:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
npm test
node --check dist/app.js
node --check dist/converter.js
```

Open `http://127.0.0.1:8000` and refresh after edits. `npm test` runs Node's built-in test runner; `node --test tests/*.test.js` is equivalent. Syntax checks supplement behavioral tests.

Install Gitleaks on PATH and run `npm run setup:hooks` once per checkout to enable the tracked `.githooks/pre-commit` check. `npm run check:secrets` scans staged changes manually. The hook blocks commits on detected secrets, missing Gitleaks or scanner errors and redacts findings. Preserve any existing custom hook workflow when setting this up.

If npm is unavailable, use `node --test tests/*.test.js`, `git config --local core.hooksPath .githooks`, and `sh .githooks/pre-commit` respectively. Use the available bundled Node runtime if Node is not on PATH; do not add application dependencies just to run these commands.

## Coding Style & Naming Conventions

Use JavaScript ES modules, `const` by default, and `let` for reassignment. Use two-space indentation when expanding compact existing code. Name functions and variables in camelCase and test files `*.test.js`. Keep conversion logic separate from DOM interactions. Limit source-code lines to 120 characters, including indentation. Exception: in `dist/modes.js`, keep each main mode and its complete submode array on one line, even when that entry exceeds 120 characters. Wrap long HTML attribute lists and text, and split JavaScript expressions at logical boundaries. Keep structured-data strings concise rather than inserting invalid JSON line breaks. Apply the limit to new and edited code; reformat existing code when touching it. Use descriptive names, one variable declaration per statement, and braces for conditional and loop bodies. Add comments for intent and non-obvious constraints rather than restating the code. No formatter or linter is configured. Preserve SPDX notices and original attribution.

## Testing Guidelines

Use `node:test` with `node:assert/strict`. Add focused regression tests when behavior changes; documentation-only changes do not need new tests. Run the existing suite for code changes and syntax-check changed JavaScript modules. No numerical coverage threshold is configured.

Keep fixtures synthetic and tests deterministic, independent of live API availability. Cover affected behavior across activator, S2S and chaser logs, including quoted CSV, row validation, UTC dates/times, band/submode mapping, station grouping, required/optional locators, duplicate/conflicting joins, inclusive date filtering, and reviewed callsign merging. Cache tests should control time and mock summit requests.

Check UI changes locally, including keyboard operation, automatic/manual locator visibility, upload failure recovery, stale asynchronous results, and busy-control behavior. Include light/dark and high-contrast themes, mobile reflow, and reading preferences when relevant. DOM tests do not establish screen-reader behavior or actual browser download completion; report which manual checks were performed.

Git hook tests cover rejection of direct and squash commits on `main`, current and legacy scanner interfaces, missing/unsupported scanners and scan failures. The real Gitleaks integration test checks staged-only scanning, redaction and commit rejection; it skips when Gitleaks is unavailable. A skipped integration test is not evidence that secret scanning passed.

## Commit & Pull Request Guidelines

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for the complete Git workflow. The default branch is `main`; the human maintainer approving the branch is the operator. Never commit or push directly to `main`. Use one feature branch per open theme, preferring `codex/<theme>` for agent-created branches. Continue related work on an open branch; start a new branch from current `main` for a different theme or after an earlier branch has merged.

Automatically commit completed, verified changes on the feature branch as work progresses. Keep each commit focused on one logical change and explain what changed and why. Clean up unpublished commits before offering the branch for review. Preserve pushed history and all commits on `main`: never force-push or rewrite published commits. Use follow-up commits for review feedback.

When ready, summarize the branch's changes, validation and limitations. Push the feature branch or open a PR only with explicit authorization. All changes require a human-reviewed GitHub PR targeting `main`; the operator manually merges that specific PR using **Create a merge commit**. Agents must not merge, enable auto-merge, squash, rebase-merge or push a local merge to `main`. Approval of one branch does not carry over to another.

After a confirmed merge, fetch and fast-forward local `main`, verify the feature branch is contained in `origin/main`, and delete it with `git branch -d`. Never use `git branch -D`; keep the branch and report failures. Report every commit and merge outcome plainly.

Inspect the working tree before editing and stage explicit paths so unrelated user changes are preserved. Review the staged diff and run `git diff --cached --check` before committing. Do not remove recovery data or change remote/account settings unless the user requests it. Do not bypass hooks with `--no-verify`; fix failures before retrying.

Use the contributor's configured Git identity and signing key. Keep personal signing and SSH settings outside tracked files; never copy private keys into the repository or change global Git settings without a request. Preserve enabled commit signing. If signing fails, resolve the configuration or report the blocker rather than silently creating an unsigned commit. Verify signed commits with `git verify-commit HEAD`.

Keep the Gitleaks pre-commit check enabled. Resolve findings before committing; do not bypass the hook or introduce broad secret-scanning exclusions. Never commit private logs or signing keys, even if the scanner reports no findings.

Gitleaks scans staged changes, not the entire history or every kind of personal data. `.gitignore` does not protect already tracked files and can be overridden; review staged content as well as scanner results.

Use focused commits with concise imperative subjects, following the repository history, such as `Show manual locators only after lookup failure`. PR descriptions should explain behavior changes, validation, and limitations. Link relevant issues when available and include screenshots for visible UI changes.

## Accessibility Requirements

Aim to meet WCAG 2.2 Level AA requirements. Level A requirements are non-negotiable for all new and changed functionality. Include accessibility in implementation and review: keyboard operation, accessible names, focus visibility, contrast, reflow, and understandable error/status messages. Use automated checks and relevant manual testing to identify gaps. Do not claim WCAG conformance; describe the requirements we aim to meet and the checks actually performed.

## Privacy & Local-Only Operation

Keep CSV processing and ADIF generation in the browser. Send only summit references to the SOTA API; never upload logs or add telemetry. Do not publish or deploy this repository without a new explicit user request.

Never use private logs, or data derived from them, as test fixtures, screenshots, or committed examples. Do not persist uploaded logs in browser storage. Local storage is limited to summit caching and interface preferences.

When changing inline scripts in `dist/index.html`, recompute the CSP hashes using the instructions in `DEPLOYMENT.md`. Keep documented asset URLs and API permissions synchronized with source changes. Do not broaden the CSP or add external assets to avoid resolving a compatibility issue. Deployment documentation and a configured Git remote do not authorize publishing or pushing.
