# Security Policy

## Supported versions

Security fixes are made on the latest `main` branch. Older commits, forks, and independently hosted copies do not receive separate security updates; users maintaining their own copies should update to the latest code.

This policy covers SOTAtoADIF Web. The [original Python project](https://github.com/G5JDA/SOTAtoADIF) and the SOTA API are separate projects; report vulnerabilities specific to them to their respective maintainers.

## Reporting a vulnerability

Please do not disclose vulnerability details in a public issue or pull request.

Open the repository's [Security tab](https://github.com/G5JDA/SOTAtoADIF-Web/security). If **Report a vulnerability** is available, use it to send a private report through GitHub's private vulnerability reporting feature.

If private reporting is unavailable, [open an issue](https://github.com/G5JDA/SOTAtoADIF-Web/issues) asking the maintainer for a private security contact. Include no exploit details, sensitive data, or proof of concept in that public request. Wait for a private channel before sharing the report.

In your private report, include:

- A description of the vulnerability and its potential impact.
- The affected commit or hosted version, browser, and relevant configuration.
- Steps to reproduce it, preferably with a minimal synthetic example.
- Any suggested mitigation or fix, if available.

Do not include private radio logs, passwords, tokens, or signing keys. Use synthetic data and redact sensitive information. Reproduce issues locally where possible, and avoid testing that accesses other people's data or disrupts the hosted app or SOTA API.

## What to expect

The maintainer will review the report, request further information if needed, and coordinate a fix and disclosure for confirmed vulnerabilities. Please allow time for investigation before publishing details. This is a volunteer-maintained project; response and resolution times are not guaranteed.

Ordinary conversion errors, feature requests, and other issues without a security impact can be reported through [GitHub issues](https://github.com/G5JDA/SOTAtoADIF-Web/issues), using synthetic examples.
