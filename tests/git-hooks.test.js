// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const hook = fileURLToPath(new URL('../.githooks/pre-commit', import.meta.url));

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sotatoadif-hooks-'));
  t.after(() => rmSync(directory, {recursive:true, force:true}));
  return directory;
}

function fakeScanner(directory, command, status=0) {
  writeFileSync(join(directory, 'gitleaks'), `#!/bin/sh
if [ "$2" = --help ]; then
  [ "$1" = "${command}" ]
  exit $?
fi
printf '%s\\n' "$@"
exit ${status}
`, {mode:0o755});
}

function check(directory, env={}) {
  return spawnSync('/bin/sh', [hook], {
    cwd:directory, env:{...process.env, ...env}, encoding:'utf8'
  });
}

for (const command of ['git', 'protect']) {
  test(`hook scans staged changes with the ${command} interface`, t => {
    const directory = fixture(t);
    fakeScanner(directory, command);
    const result = check(directory, {PATH:directory});
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [
      command, ...(command === 'git' ? ['--pre-commit'] : []),
      '--staged', '--redact', '--no-banner'
    ]);
  });
}

test('hook blocks commits when Gitleaks is unavailable', t => {
  const directory = fixture(t);
  const result = check(directory, {PATH:directory});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Commit blocked: install Gitleaks/);
});

test('hook blocks unsupported scanners and propagates scan failures', t => {
  const directory = fixture(t);
  fakeScanner(directory, 'unsupported');
  let result = check(directory, {PATH:directory});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no supported staged scanner/);
  for (const status of [1, 2]) {
    fakeScanner(directory, 'git', status);
    result = check(directory, {PATH:directory});
    assert.equal(result.status, status);
  }
});

const available = spawnSync('gitleaks', ['--help']).status === 0;
test('real Gitleaks allows clean staged content and blocks a staged secret', {
  skip: !available && 'Install Gitleaks to run the integration check'
}, t => {
  const directory = fixture(t);
  const git = (...args) => {
    const result = spawnSync('git', args, {cwd:directory, encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '--quiet');
  git('config', 'core.hooksPath', dirname(hook));
  git('config', 'user.name', 'Hook Test');
  git('config', 'user.email', 'hook-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(directory, 'clean.txt'), 'No sensitive content.\n');
  git('add', 'clean.txt');
  assert.equal(check(directory).status, 0);

  // Construct a synthetic, nonfunctional token only in the temporary fixture.
  const token = 'ghp_' + 'Ab9Cd8Ef7Gh6Ij5Kl4Mn3Op2Qr1St0UvWxYz';
  writeFileSync(join(directory, 'clean.txt'), `token = "${token}"\n`);
  // An unstaged edit must not change the staged scan's result.
  assert.equal(check(directory).status, 0);
  git('add', 'clean.txt');
  const result = check(directory);
  assert.equal(result.status, 1);
  assert.ok(!(result.stdout + result.stderr).includes(token), 'Finding must be redacted');
  const commit = () => spawnSync('git', ['commit', '--quiet', '-m', 'Synthetic hook check'], {
    cwd:directory, encoding:'utf8'
  });
  const blocked = commit();
  assert.notEqual(blocked.status, 0, 'Git must refuse the secret-bearing commit');
  assert.ok(!(blocked.stdout + blocked.stderr).includes(token));
  assert.notEqual(spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {cwd:directory}).status, 0);
  writeFileSync(join(directory, 'clean.txt'), 'No sensitive content.\n');
  git('add', 'clean.txt');
  const clean = commit();
  assert.equal(clean.status, 0, clean.stderr);
});
