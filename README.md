# SOTAtoADIF Web

Convert Summits on the Air (SOTA) database CSV exports into ADIF files for your amateur-radio logbook, directly in your browser.

**[Use the hosted app at sotatoadif.g5jda.uk](https://sotatoadif.g5jda.uk/)**

SOTAtoADIF Web is a dependency-free browser edition based on the older [SOTAtoADIF Python project](https://github.com/G5JDA/SOTAtoADIF) by Jack G5JDA. It brings the original CSV conversion and summit-enrichment workflow to a web interface and adds support for combining activator, summit-to-summit (S2S), and chaser logs.

## Features

- Import SOTA V2 activator, S2S, and chaser CSV exports, individually or together.
- Look up summit names and Maidenhead locators through the SOTA API, with a 24-hour local cache.
- Enter summit locators manually when automatic lookup is unavailable.
- Filter contacts by an inclusive UTC start date.
- Create one ADIF file per station callsign, with optional additional exports using reviewed callsign-suffix mappings.
- Review conversion warnings and preview the ADIF before downloading.
- Choose light, dark, and high-contrast themes, plus text size and reading preferences.

## Using the app

1. Export your logs as SOTA V2 CSV files from the SOTA database.
2. Open [SOTAtoADIF Web](https://sotatoadif.g5jda.uk/) and choose or drop your files into the upload area. Log types are identified automatically; you can load one file of each type.
3. Optionally choose a start date or review additional callsign exports. Leave automatic summit lookup enabled, or disable it and enter locators manually.
4. Select **Convert to ADIF**, review any warnings, and supply missing required locators if prompted. Convert again after changing settings.
5. Download the ADIF files and review them before importing into your logging software.

When activator and S2S logs are combined, matching S2S records enrich the activator contacts; unmatched S2S contacts are reported rather than appended. Chaser logs enrich matching contacts and add contacts absent from the other log. Ambiguous matches and conflicting summit references are reported without guessing.

Own-summit locators are required for activator contacts. Worked-summit locators are optional, and chaser-only contacts omit unknown own-summit fields. Additional callsign exports repeat contacts from the originals: import only the appropriate set into each destination to avoid duplicates. Preserve overseas operating prefixes and suffixes when reviewing callsign mappings.

### Compatibility notes

For guidance on using the generated ADIF files with **Logbook of The World (LoTW)** and **Trusted QSL (TQSL)**, see the [original SOTAtoADIF project's wiki](https://github.com/G5JDA/SOTAtoADIF/wiki).

SOTA's generic `DATA` mode is exported unchanged as `MODE=DATA` for TQSL use. It is outside ADIF's standard mode enumeration, so other logging programs may reject these contacts or require their mode to be corrected before import.

ADIF comments are converted to printable ASCII: accents are removed where possible, line breaks become spaces, and unsupported characters are replaced. Warnings identify changed comments; the source CSV is unchanged. Invalid rows and contacts missing required locators are reported, and valid contacts can still be exported.

## Privacy

CSV parsing, validation, ADIF generation, and downloads happen locally in your browser. Logs are not uploaded or stored persistently. Optional summit enrichment sends only summit references to the SOTA API; successful summit data and interface preferences are stored locally on your device. There is no conversion backend or telemetry.

After the page has loaded, you can disable automatic lookup and enter locators manually to convert without API access. The app does not include a service worker or guarantee offline page availability.

## Running locally

The editable application source is in `dist/`; no build step or dependency installation is needed. With Python installed, run this from the repository root:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Static hosting and security-header guidance is available in [DEPLOYMENT.md](DEPLOYMENT.md).

## Development

Run the regression tests with Node.js:

```sh
node --test tests/*.test.js
```

`npm test` runs the same suite. Tests cover conversion, summit caching, browser interactions, and the Git secret-checking hook using synthetic fixtures. See [AGENTS.md](AGENTS.md) for contributor guidance. Do not include private logs or credentials in issues, pull requests, or test fixtures.

Install [Gitleaks](https://github.com/gitleaks/gitleaks) on your PATH, then run `npm run setup:hooks` once per checkout to enable staged secret checks before commits. If you already use custom Git hooks, integrate the check into your existing workflow. Run `npm run check:secrets` for a manual staged scan. The hook blocks commits on findings or scanner failures and redacts detected secrets; it cannot detect every kind of sensitive data.

## Licence and attribution

SOTAtoADIF Web is licensed under the **GNU Affero General Public License, version 3 or later (AGPL-3.0-or-later)**. See [LICENSE](LICENSE) for the full terms.

This browser edition is based on [G5JDA/SOTAtoADIF](https://github.com/G5JDA/SOTAtoADIF), the original Python converter, and retains its attribution. The Python project is separately licensed under GPL-3.0-or-later; see its repository for its licence and documentation.
