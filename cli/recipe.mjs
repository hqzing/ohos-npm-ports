import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let activePort = null;

export function activateRecipe(port) {
  activePort = port;
}

export function deactivateRecipe() {
  activePort = null;
}

function currentPort() {
  if (!activePort) throw new Error('Recipe helpers can only be used inside a lifecycle or test hook');
  return activePort;
}

function commandError(command, args, result) {
  const detail = result.stderr || result.stdout || result.signal || `exit code ${result.code}`;
  return new Error(`${command} ${args.join(' ')} failed: ${detail}`);
}

function environment(overrides = {}) {
  const env = { ...process.env };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) delete env[name];
    else env[name] = String(value);
  }
  return env;
}

export class Port {
  static distTag = 'latest';
  static upstreamTag = 'latest';
  static bump = true;
  static resources = [];

  constructor(context = {}) {
    Object.assign(this, context);
    this.dir ??= import.meta.dirname;
    this.slotDir ??= this.dir;
    this.projectDir ??= process.cwd();
  }

  get version() { return this.constructor.version; }
  get revision() { return this.constructor.revision; }
  get portVersion() { return `${this.constructor.version}-${this.constructor.revision}`; }

  run(command, args = [], options = {}) {
    return run(command, args, options);
  }

  runAsync(command, args = [], options = {}) {
    return runAsync(command, args, options);
  }

  shell(script, options = {}) {
    return run('bash', ['-euo', 'pipefail', '-c', script], options);
  }

  cd(path) {
    const directory = resolve(path);
    process.chdir(directory);
    return directory;
  }

  fetchSource(output) {
    download(this.constructor.source, this.constructor.sha256, output);
  }

  fetchResource(name, output) {
    const resource = this.constructor.resources.find((entry) => entry.name === name);
    if (!resource) throw new Error(`Unknown resource: ${name}`);
    download(resource.url, resource.sha256, output);
  }

  requirePackage(specifier) {
    if (!this.consumerRequire) {
      this.consumerRequire = createRequire(join(this.projectDir, 'package.json'));
    }
    return this.consumerRequire(specifier);
  }

  resolvePackage(specifier) {
    if (!this.consumerRequire) {
      this.consumerRequire = createRequire(join(this.projectDir, 'package.json'));
    }
    return this.consumerRequire.resolve(specifier);
  }

  async importPackage(specifier) {
    return import(pathToFileURL(this.resolvePackage(specifier)).href);
  }
}

export function resource(name, url, sha256) {
  return { name, url, sha256 };
}

export function run(command, args = [], options = {}) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new TypeError('run args must be a string array');
  const capture = options.capture === true;
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: environment(options.env),
    input: options.input,
    timeout: options.timeout,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
    stdio: [options.input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
  });
  if (result.error) throw result.error;
  const normalized = {
    code: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
  const allowed = options.allowExitCodes ?? [0];
  if (!allowed.includes(normalized.code)) throw commandError(command, args, normalized);
  return normalized;
}

export function runAsync(command, args = [], options = {}) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) return Promise.reject(new TypeError('runAsync args must be a string array'));
  const capture = options.capture === true;
  return new Promise((done, fail) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: environment(options.env),
      timeout: options.timeout,
      stdio: [options.input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
    });
    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
    }
    child.once('error', fail);
    child.once('close', (code, signal) => {
      const result = { code, signal, stdout, stderr };
      const allowed = options.allowExitCodes ?? [0];
      if (allowed.includes(code)) done(result);
      else fail(commandError(command, args, result));
    });
    if (options.input !== undefined) child.stdin.end(options.input);
  });
}

function download(url, sha256, output) {
  const file = resolve(output);
  mkdirSync(dirname(file), { recursive: true });
  rmSync(file, { force: true });
  try {
    run('curl', ['-fsSL', '--retry', '8', '--retry-all-errors', '--connect-timeout', '30', url, '-o', file]);
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (actual !== sha256) throw new Error(`SHA-256 mismatch for ${url}: expected ${sha256}, got ${actual}`);
  } catch (error) {
    rmSync(file, { force: true });
    throw error;
  }
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export const recipeContext = () => currentPort();
export const shell = (script, options) => currentPort().shell(script, options);
export const cd = (path) => currentPort().cd(path);
export const fetchSource = (output) => currentPort().fetchSource(output);
export const fetchResource = (name, output) => currentPort().fetchResource(name, output);
export const requirePackage = (specifier) => currentPort().requirePackage(specifier);
export const importPackage = (specifier) => currentPort().importPackage(specifier);
