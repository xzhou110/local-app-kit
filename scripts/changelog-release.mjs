#!/usr/bin/env node
// Runs in the `version` lifecycle of `npm version <patch|minor|major>`, when package.json already carries the new
// version and npm has not yet committed: moves everything under "## Unreleased" in CHANGELOG.md to a
// "## [<version>] - <date>" heading, leaves a fresh empty Unreleased section, and stages the file so the commit and
// the v<version> tag npm then creates carry the changelog with them (principle 9 of the engineering standard).
// package.json:  "version": "node scripts/changelog-release.mjs"
// CHANGELOG.md is looked for beside package.json, then in the parent folders up to the repository root, so an app
// that lives in app/ keeps the changelog at the repository root.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
let dir = process.cwd();
let file = null;
for (let i = 0; i < 4 && !file; i++) {
  const candidate = path.join(dir, 'CHANGELOG.md');
  if (fs.existsSync(candidate)) file = candidate;
  else dir = path.dirname(dir);
}
if (!file) {
  console.error('CHANGELOG.md not found beside package.json or above it');
  process.exit(1);
}

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const start = lines.findIndex(l => /^## Unreleased\s*$/.test(l));
if (start < 0) {
  console.error(`${file}: no "## Unreleased" section`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
if (end < 0) end = lines.length;
const body = lines.slice(start + 1, end).join('\n').trim();
if (!body) {
  console.error(`${file}: the Unreleased section is empty; write what changed before releasing`);
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
const release = ['## Unreleased', '', `## [${pkg.version}] - ${date}`, '', body, ''];
const out = [...lines.slice(0, start), ...release, ...lines.slice(end)].join('\n');
fs.writeFileSync(file, out.endsWith('\n') ? out : out + '\n');
try {
  execFileSync('git', ['add', '--', file], { stdio: 'ignore' });
} catch {
  console.log('(not a git repository, or git is unavailable: CHANGELOG.md updated but not staged)');
}
console.log(`CHANGELOG.md: ${pkg.version} released on ${date}`);
