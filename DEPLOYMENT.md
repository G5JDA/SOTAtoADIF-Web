# Deployment and Response Headers

Serve the contents of `dist/` as a static site over HTTPS. There is no build step, backend, log upload endpoint, or service worker. Keep `LICENSE`, the manifest, and icons available. This document describes header configuration; it does not configure or publish a deployment.

## Content Security Policy

The production URL is `https://sotatoadif.g5jda.uk/`. The following restrictive policy names its exact asset URLs. For another host or a subdirectory installation, update every local asset URL to match. The SOTA API URL stays unchanged. Send the policy as one HTTP response header on HTML responses:

```http
Content-Security-Policy: default-src 'none'; script-src https://sotatoadif.g5jda.uk/app.js https://sotatoadif.g5jda.uk/converter.js https://sotatoadif.g5jda.uk/modes.js https://sotatoadif.g5jda.uk/summit-cache.js 'sha256-OGKj8hcHljRo1ODFOOzcavDOqwD0eM0uPp3HKWRw8wA=' 'sha256-PAu9B/nsmQIQShmL+9uYuG4+oeQta7/MKRgcnIzu3Us=' 'sha256-VResxdVMPjMNKfZLwEn3zy+hNrfbPYSLbfrsNIttHyQ='; script-src-attr 'none'; style-src https://sotatoadif.g5jda.uk/style.css; style-src-attr 'none'; img-src https://sotatoadif.g5jda.uk/favicon.svg https://sotatoadif.g5jda.uk/icons/icon-192.png https://sotatoadif.g5jda.uk/icons/icon-512.png https://sotatoadif.g5jda.uk/icons/apple-touch-icon.png; manifest-src https://sotatoadif.g5jda.uk/manifest.webmanifest; connect-src https://api2.sota.org.uk/api/summits/; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'none'
```

This avoids broad `'self'` resource permissions: only the four JavaScript modules, stylesheet, manifest, and image files are allowed. Inline scripts are allowed only by their exact SHA-256 hashes. The three hashes cover the JSON-LD metadata, initial theme selection, and initial contrast selection, in that order. There is no `unsafe-inline`, `unsafe-eval`, wildcard host, or unrestricted HTTPS permission. Unlisted resource types, including frames, fonts, and media, inherit `default-src 'none'`. System fonts and inline SVG artwork do not need external resource permission.

`connect-src` permits only the SOTA summit API path. It does not need the site's own origin. CSP does not replace summit-reference validation or the API's CORS permissions. Path restrictions are not preserved after redirects, so retain the API's direct endpoint and verify unexpected redirects. See [CSP source matching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy).

Reading preferences set CSS properties through `element.style.setProperty()`, which works with inline style attributes forbidden; do not add `unsafe-inline` for this. See [CSSOM style changes and CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src).

ADIF downloads use a generated Blob URL as an anchor download. They do not require `blob:` in `connect-src`, `script-src`, or `img-src`. Do not add CSP `sandbox`: its default restrictions would break scripts, storage, and downloads. Ordinary external links remain usable.

### Maintaining inline hashes

Any change to inline script contents, including whitespace, requires updated hashes. HTML minification or response rewriting can invalidate them. Keep the deployed HTML and policy in sync. Run this from the repository root to generate the hash sources in document order:

```sh
python3 - <<'PY'
import base64
import hashlib
from html.parser import HTMLParser
from pathlib import Path

class InlineScripts(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.active = False
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script' and 'src' not in dict(attrs):
            self.active = True
            self.scripts.append('')

    def handle_data(self, data):
        if self.active:
            self.scripts[-1] += data

    def handle_endtag(self, tag):
        if tag == 'script':
            self.active = False

parser = InlineScripts()
parser.feed(Path('dist/index.html').read_text(encoding='utf-8'))
for script in parser.scripts:
    digest = hashlib.sha256(script.encode('utf-8')).digest()
    print("'sha256-" + base64.b64encode(digest).decode('ascii') + "'")
PY
```

A static site should use hashes rather than a fixed nonce. A secure nonce must be fresh for every response. Future modules, icons, endpoints, or workers require corresponding policy updates.

## Other Security Headers

Recommended header values:

```http
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Strict-Transport-Security: max-age=31536000
```

- `nosniff` prevents MIME guessing; correct content types are essential for ES modules.
- `no-referrer` avoids sending the page URL to the API or linked external sites.
- `DENY` complements CSP `frame-ancestors 'none'` for older browsers.
- The Permissions Policy disables device features that the app does not use. It does not disable the file picker, storage, or downloads.
- HSTS applies to a production HTTPS host. Add `includeSubDomains` only if every subdomain supports HTTPS; add `preload` only after deliberately committing the domain to preload requirements. Do not use production HSTS configuration for local HTTP development.

Optional isolation headers are `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin`. They isolate opener relationships and restrict other sites embedding these static assets, respectively. Recheck them if integrations or cross-origin asset reuse are introduced. Cross-origin isolation via COEP is not required by this app.

Deliver CSP and framing restrictions as response headers, not just HTML metadata. Avoid conflicting duplicate policies: browsers enforce all received CSP policies together. See the [HTTP header reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers).

## Content Types and Caching

| Files | Content-Type |
| --- | --- |
| `index.html` | `text/html; charset=utf-8` |
| `*.js` | `text/javascript; charset=utf-8` |
| `style.css` | `text/css; charset=utf-8` |
| `manifest.webmanifest` | `application/manifest+json` |
| `favicon.svg` | `image/svg+xml` |
| `icons/*.png` | `image/png` |
| `robots.txt`, `humans.txt`, `LICENSE` | `text/plain; charset=utf-8` |

Use `Cache-Control: no-cache` with ETag or Last-Modified validators for HTML, JavaScript, CSS, and the manifest. This permits storage but requires revalidation before reuse. Current asset filenames are not content-versioned: avoid long-lived `immutable` caching unless asset URLs change with their contents. Deploy matching HTML, modules, and CSP together.

No public CORS header is needed for same-origin assets. Adding `Access-Control-Allow-Origin` to this site will not fix a CORS failure on the SOTA API. Do not add cookies, telemetry, or third-party CSP reporting endpoints that could expose user information. The application's 24-hour summit cache is separate from HTTP asset caching.

## Verification

Before enabling enforcement, use the policy as `Content-Security-Policy-Report-Only` on a test deployment and inspect browser console violations. This checks policy compatibility; it does not provide enforcement. Then test the enforced header itself.

Verify module loading, icons and manifest, light/dark and contrast preferences, text size and custom colours, file selection and drag-and-drop, manual locators, live summit lookups, all log combinations, date filtering, merged exports, and actual ADIF downloads. Check after a reload to exercise persisted preferences. Confirm response headers and MIME types in the browser network panel. Test current mobile Safari and Chrome before launch; a manifest alone does not guarantee identical home-screen behaviour across browsers.

The supplied hashes were generated from the repository's current HTML. Recompute them whenever inline metadata or preference scripts change.

Local verification used an enforced CSP response header with the asset origin changed to loopback. Module loading, theme/contrast toggles, text scaling, file selection, manual-locator conversion, and the download button worked. Download completion, live API lookup, and mobile home-screen installation still require verification on the final HTTPS deployment.
