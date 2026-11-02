// Usage: git diff --name-only BASE HEAD | node warn-unbumped-ports.mjs <checkout of BASE>
// Prints a GitHub warning for every changed port whose version did not change. Never fails the job.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPort } from '../../cli/port.mjs';
import { unbumpedPorts } from '../../cli/unbumped.mjs';
import { buildInputsEqual } from './recipe-inputs.mjs';

const head = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = resolve(process.argv[2]);
// loadPort resolves a relative directory against the current checkout first, so always pass an absolute path.
const version = (root) => (dir) => (existsSync(join(root, dir, 'NPMBUILD')) ? loadPort(root, join(root, dir)).portVersion : null);
const changed = readFileSync(0, 'utf8').split('\n').filter(Boolean);
for (const dir of unbumpedPorts(changed, { baseVersion: version(base), headVersion: version(head) })) {
  const files = changed.filter((file) => file.startsWith(`${dir}/`) && file !== `${dir}/test.js` && file !== `${dir}/README.md`);
  if (files.length > 0 && files.every((file) => file === `${dir}/NPMBUILD`) && buildInputsEqual(process.env.BASE, process.env.HEAD, dir)) continue;
  const { portVersion } = loadPort(head, join(head, dir));
  console.log(`::warning file=${dir}/NPMBUILD::${dir} changed but stays at ${portVersion}; npm already has that version, so merging will not publish this change. Run \`cli/npm-ports revision ${dir}\` if it should be released.`);
}
