import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  assertPortPaths,
  assertTargetVersion,
  singlePortDirectory,
} from '../.github/scripts/ai-bump.mjs';

const workflow = readFileSync('.github/workflows/ai-bump.yml', 'utf8');
const script = readFileSync('.github/scripts/ai-bump.mjs', 'utf8');

test('AI bump accepts exactly one port including a version-line slot', () => {
  assert.equal(singlePortDirectory([
    'ports/b/bufferutil/NPMBUILD',
    'ports/b/bufferutil/patches/0001-update-package-json.patch',
  ]), 'ports/b/bufferutil');
  assert.equal(singlePortDirectory(['ports/l/lightningcss@1.32/NPMBUILD']), 'ports/l/lightningcss@1.32');
  assert.throws(() => singlePortDirectory([
    'ports/b/bufferutil/NPMBUILD',
    'ports/s/sharp/NPMBUILD',
  ]), /exactly one/);
  assert.throws(() => singlePortDirectory(['.github/workflows/ci.yml']), /one port/);
  assert.throws(() => singlePortDirectory([]), /no changed files/);
});

test('AI repair cannot modify files outside the selected port', () => {
  assert.doesNotThrow(() => assertPortPaths([
    'ports/b/bufferutil/NPMBUILD',
    'ports/b/bufferutil/patches/new.patch',
  ], 'ports/b/bufferutil'));
  assert.throws(() => assertPortPaths([
    'ports/b/bufferutil/NPMBUILD',
    'cli/build.mjs',
  ], 'ports/b/bufferutil'), /outside/);
  assert.throws(() => assertPortPaths(['ports/b/bufferutil-other/file'], 'ports/b/bufferutil'), /outside/);
});

test('AI repair cannot fix a bump by restoring the old version', () => {
  assert.doesNotThrow(() => assertTargetVersion({ version: '4.1.0' }, { version: '4.1.0' }));
  assert.throws(() => assertTargetVersion({ version: '4.1.0' }, { version: '4.0.9' }), /target version/);
});

test('AI bump is a label-triggered same-repository workflow without status labels', () => {
  assert.match(workflow, /types: \[labeled\]/);
  assert.match(workflow, /github\.event\.label\.name == 'request-ai-bump'/);
  assert.match(workflow, /head\.repo\.full_name == github\.repository/);
  assert.doesNotMatch(workflow, /pull_request_target|workflow_run/);
  assert.doesNotMatch(workflow, /ai-running|ai-success|ai-failed/);
  assert.match(workflow, /group: ai-bump-pr-/);
});

test('AI credentials are scoped to their respective steps', () => {
  const repair = workflow.slice(workflow.indexOf('- name: Repair the port'), workflow.indexOf('- name: Independently verify'));
  const publish = workflow.slice(workflow.indexOf('- name: Amend and push'));
  assert.match(repair, /DEEPSEEK_API_KEY/);
  assert.doesNotMatch(repair, /GH_TOKEN|app-token/);
  assert.match(publish, /GH_TOKEN: \$\{\{ steps\.app-token\.outputs\.token \}\}/);
  assert.doesNotMatch(publish, /DEEPSEEK_API_KEY/);
  assert.match(workflow, /persist-credentials: false/);
});

test('publishing applies the verified patch in a fresh clone', () => {
  assert.match(script, /'clone', '--depth', '2', '--branch', state\.headRef/);
  assert.match(script, /'apply', '--index', '--whitespace=error-all', state\.patch/);
  assert.match(script, /force-with-lease=refs\/heads\/\$\{state\.headRef\}:\$\{state\.headSha\}/);
  const publish = script.slice(script.indexOf('function publish'), script.indexOf('function finalize'));
  assert.doesNotMatch(publish, /AI_BUMP_PUSH_TOKEN|DEEPSEEK_API_KEY/);
});
