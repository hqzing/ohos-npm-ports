import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { activateRecipe, deactivateRecipe } from './recipe.mjs';

const [directory, phase, mode, primary, report] = process.argv.slice(2);
const dir = resolve(directory);
const projectDir = process.cwd();
const { default: Recipe } = await import(pathToFileURL(`${dir}/NPMBUILD`).href);
const projectRequire = createRequire(resolve(projectDir, 'package.json'));
const tools = phase === 'setup' ? null : createRequire(projectRequire.resolve('consumer-deps/package.json'));
const port = new Recipe({
  dir,
  projectDir,
  mode,
  primary: primary === 'true',
  npmCli: process.env.PORT_TEST_NPM_CLI,
  helper: process.env.PORT_TEST_HELPER,
  tools,
});

try {
  activateRecipe(port);
  if (phase === 'setup') {
    if (typeof port.testSetup === 'function') await port.testSetup(port);
  } else {
    const result = await port.test(port);
    assert.ok(result && typeof result.result === 'object', `Invalid report from ${dir}`);
    result.assets ??= [];
    writeFileSync(report, JSON.stringify(result));
  }
} finally {
  deactivateRecipe();
}
