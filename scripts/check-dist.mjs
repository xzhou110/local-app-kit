#!/usr/bin/env node
// Fails when the committed dist/ differs from a fresh build. `npm run check` runs it right after `npm run build`:
// a consumer installs this package from a git tag and runs dist/ (Node refuses to strip types under node_modules),
// so dist/ must be exactly what src/ says, in every commit. Nothing is written here; git reports the drift.
import { execFileSync } from 'node:child_process';

const drift = execFileSync('git', ['status', '--porcelain', '--', 'dist'], { encoding: 'utf8' }).trim();
if (drift) {
  console.error('dist/ is out of date with src/. The build changed these files; commit them with the change:\n' + drift);
  process.exit(1);
}
console.log('dist/ matches src/');
