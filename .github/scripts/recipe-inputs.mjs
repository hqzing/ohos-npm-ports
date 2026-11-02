import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recipeBuildText } from '../../cli/recipe-source.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function git(ref, args) {
  return execFileSync('git', ['-c', `safe.directory=${repo}`, ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

export function buildInputs(ref, portDir) {
  const entries = git(ref, ['ls-tree', '-r', ref, '--', portDir])
    .split('\n')
    .filter((line) => line && !line.endsWith('/test.js') && !line.endsWith('/README.md') && !line.endsWith('/NPMBUILD'));
  const recipe = git(ref, ['show', `${ref}:${portDir}/NPMBUILD`]);
  const digest = createHash('sha256').update(recipeBuildText(recipe)).digest('hex');
  return `${entries.join('\n')}\nNPMBUILD build section ${digest}`;
}

export function buildInputsEqual(left, right, portDir) {
  try { return buildInputs(left, portDir) === buildInputs(right, portDir); }
  catch { return false; }
}
