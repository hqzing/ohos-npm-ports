import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Port } from './recipe.mjs';

const dir = resolve(process.argv[2]);
const log = console.log;
console.log = console.error;
const { default: Recipe } = await import(pathToFileURL(`${dir}/NPMBUILD`).href);
console.log = log;

if (typeof Recipe !== 'function' || !(Recipe.prototype instanceof Port)) {
  throw new Error(`${dir}/NPMBUILD must default-export a class extending Port`);
}
for (const key of ['pkgname', 'upstream', 'version', 'revision', 'distTag']) {
  if (Recipe[key] === undefined || Recipe[key] === '') throw new Error(`${dir}/NPMBUILD is missing static ${key}`);
}
if (!Array.isArray(Recipe.packages) || Recipe.packages.length === 0) throw new Error(`${dir}/NPMBUILD requires static packages`);
if (typeof Recipe.prototype.build !== 'function') throw new Error(`${dir}/NPMBUILD requires build()`);

const metadata = {
  pkgname: Recipe.pkgname,
  upstream: Recipe.upstream,
  version: Recipe.version,
  revision: Recipe.revision,
  distTag: Recipe.distTag,
  upstreamTag: Recipe.upstreamTag,
  source: Recipe.source ?? '',
  sha256: Recipe.sha256 ?? '',
  bump: Recipe.bump,
  packages: Recipe.packages,
  resources: Recipe.resources,
  test: null,
};

if (typeof Recipe.prototype.test === 'function') {
  metadata.test = {
    upstream: Recipe.testUpstream ?? Recipe.upstream,
    upstreamVersion: Recipe.testUpstreamVersion ?? Recipe.version,
    portPackage: Recipe.testPortPackage ?? `@ohos-npm-ports/${Recipe.pkgname}`,
    project: Recipe.testProject ?? 'node',
    fixture: Recipe.testFixture ?? '',
    prerequisites: Recipe.testPrerequisites ?? [],
    platforms: Recipe.testPlatforms ?? ['win32', 'linux', 'darwin', 'openharmony'],
    platformReason: Recipe.testPlatformReason ?? '',
    role: Recipe.testRole ?? 'primary',
    timeout: Recipe.testTimeout ?? 600_000,
    browser: Recipe.testBrowser ?? '',
    setup: typeof Recipe.prototype.testSetup === 'function',
  };
}

process.stdout.write(JSON.stringify(metadata));
