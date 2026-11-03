import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resourceDeclarations } from './bump.mjs';
import { splitRecipe } from './recipe-source.mjs';

function lintPatch(file, text, port) {
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ownReference = new RegExp(`@ohos-npm-ports/${escape(port.pkgname)}[A-Za-z0-9._-]*@${escape(port.version)}-\\d+(?!\\d)`);
  if (ownReference.test(text)) {
    throw new Error(`${file}: current port revisions must be injected by npm-ports pack, not patches`);
  }
  let existingPackageJson = false;
  let repositoryIndent = -1;
  for (const line of text.split('\n')) {
    if (line.startsWith('--- ')) existingPackageJson = line.trim() !== '--- /dev/null';
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).split('\t')[0];
      existingPackageJson &&= /^(?:b\/)?(?:.*\/)?package\.json$/.test(target);
    }
    if (existingPackageJson && /^[+-]\s*"repository"\s*:/.test(line)) {
      throw new Error(`${file}: repository URL and directory are injected by npm-ports, not patches`);
    }
    const content = line.slice(1);
    const repository = existingPackageJson && /^(\s*)"repository"\s*:\s*\{/.exec(content);
    if (repository) {
      repositoryIndent = repository[1].length;
    } else if (repositoryIndent >= 0) {
      const indent = /^(\s*)/.exec(content)[1].length;
      if (/^\s*\}/.test(content) && indent <= repositoryIndent) {
        repositoryIndent = -1;
      } else if (existingPackageJson && /^[+-]\s*"(?:url|directory)"\s*:/.test(line)) {
        throw new Error(`${file}: repository URL and directory are injected by npm-ports, not patches`);
      }
    }
    if (existingPackageJson && /^[+-]\s*"name"\s*:/.test(line)) {
      throw new Error(`${file}: package names are injected by npm-ports, not patches`);
    }
    if (existingPackageJson && /^[+-]\s*"description"\s*:/.test(line)) {
      throw new Error(`${file}: patches must not change package.json description`);
    }
    if (existingPackageJson && /^[+-]\s*"version"\s*:/.test(line)) {
      throw new Error(`${file}: patches must not change package.json version; retain upstream ${port.version}`);
    }
    if (existingPackageJson && /^\s+"version"\s*:\s*"\d/.test(line)) {
      throw new Error(`${file}: patches must not pin upstream version context`);
    }
  }
}

function lintImplementation(directory, source, file, port) {
  const patches = join(directory, 'patches');
  if (!existsSync(patches)) return;
  const appliesAll = /patches\/\*\.patch|patches\/\*[^.]|readdirSync\([^)]*['"]patches['"]\)/.test(source);
  for (const entry of readdirSync(patches)) {
    if (!entry.endsWith('.patch')) continue;
    const patch = join(patches, entry);
    if (!appliesAll && !source.includes(entry)) throw new Error(`${file}: patches/${entry} is never applied`);
    lintPatch(patch, readFileSync(patch, 'utf8'), port);
  }
}

function lintDeclarations(source, file) {
  if (!source.startsWith('#!/usr/bin/env node\n')) throw new Error(`${file}: expected #!/usr/bin/env node`);
  if (!/export default class\s+[A-Za-z0-9_]+\s+extends\s+Port\s*\{/.test(source)) {
    throw new Error(`${file}: expected a default-exported class extending Port`);
  }
  const declarations = new Map();
  for (const line of source.split('\n')) {
    const match = /^(?:const\s+([A-Za-z_$][\w$]*)|  static\s+([A-Za-z_$][\w$]*))\s*=/.exec(line);
    if (!match) continue;
    const name = match[1] ?? `static ${match[2]}`;
    if (declarations.has(name)) throw new Error(`${file}: duplicate declaration ${name}`);
    declarations.set(name, true);
  }
  if (!/^const version = '[^']+';$/m.test(source)) throw new Error(`${file}: version must use a top-level literal const`);
  if (!/^  static version = version;$/m.test(source)) throw new Error(`${file}: static version must reference the shared const`);
  if (!/^  static revision = \d+;$/m.test(source)) throw new Error(`${file}: static revision must be a numeric literal`);
  const hashes = source.match(/\b[0-9a-f]{64}\b/g) ?? [];
  if (new Set(hashes).size !== hashes.length) throw new Error(`${file}: duplicate SHA-256 literal; declare it once and reference it`);
}

function lintTestLayout(source, file) {
  if (/^  (?:async\s+)?check\s*\(/m.test(source)) throw new Error(`${file}: check() is obsolete; use package assertions and test()`);
  const { testText } = splitRecipe(source);
  if (!testText) return;
  if (!/(?:async\s+)?test\s*\([^)]*\)\s*\{[\s\S]*\}\s*$/.test(testText)) {
    throw new Error(`${file}: test() must be the last class method`);
  }
  if (/^  (?:async\s+)?(?:prepare|build|package|slot_[A-Za-z0-9_]+_(?:prepare|build|package))\s*\([^)]*\)\s*\{\s*$/m.test(testText)) {
    throw new Error(`${file}: build hooks must not appear after the test section`);
  }
}

export function lintPort(port) {
  const file = join(port.dir, 'NPMBUILD');
  execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'pipe', 'inherit'] });
  const source = readFileSync(file, 'utf8');
  lintDeclarations(source, file);
  lintTestLayout(source, file);
  const declarations = resourceDeclarations(source);
  const firstHook = /^  (?:async\s+)?(?:prepare|build|package)\s*\(/m.exec(source);
  if (firstHook && /\bresource\s*\(/.test(source.slice(firstHook.index))) {
    throw new Error(`${file}: resource declarations must precede lifecycle hooks`);
  }
  for (const declaration of declarations) {
    if (declaration.url.includes(port.version) && !declaration.url.includes('${version}') && !/\$version(?![A-Za-z0-9_])/.test(declaration.url)) {
      throw new Error(`${file}: resource ${declaration.name} must reference \${version} instead of repeating ${port.version}`);
    }
  }
  if (/\breadelf\b/.test(source)) throw new Error(`${file}: readelf checks are not needed in NPMBUILD`);
  if (/binary-sign-tool|sign -selfSign|\.codesign|ohos-selfsign/.test(source)) {
    throw new Error(`${file}: ELF signing and signature checks are managed by npm-ports pack`);
  }
  if (/\n[ \t]*\n[ \t]*\n/.test(source)) throw new Error(`${file}: collapse consecutive blank lines`);
  if (source.split('\n').some((line) => !line.trimStart().startsWith('#') && line.includes('npm publish'))) {
    throw new Error(`${file}: publishing is managed by npm-ports, not NPMBUILD`);
  }
  const directories = [port.dir];
  const slots = join(port.dir, 'slots');
  if (existsSync(slots)) {
    for (const entry of readdirSync(slots, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(slots, entry.name));
    }
  }
  for (const directory of directories) {
    if (existsSync(join(directory, 'publish.sh'))) throw new Error(`${directory}: publish.sh is obsolete; declare packages in NPMBUILD`);
    lintImplementation(directory, source, file, port);
  }
  return port;
}

export function lintPublishedNames(ports) {
  const names = new Map();
  for (const port of ports) {
    if (names.has(port.pkgname) && names.get(port.pkgname) !== port.upstream) {
      throw new Error(`Published short name ${port.pkgname} maps to multiple upstream packages: ${names.get(port.pkgname)}, ${port.upstream}`);
    }
    names.set(port.pkgname, port.upstream);
  }
}
