import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activateRecipe, deactivateRecipe } from './recipe.mjs';

const [directory, slot, slotDirectory, phasesText] = process.argv.slice(2);
const dir = resolve(directory);
const slotDir = resolve(slotDirectory);
const phases = JSON.parse(phasesText);
const { default: Recipe } = await import(pathToFileURL(`${dir}/NPMBUILD`).href);
const port = new Recipe({ root: process.env.NPM_PORTS_ROOT, dir, slot, slotDir });
const prefix = slot === 'main' ? '' : `slot_${slot.replace(/[^A-Za-z0-9]/g, '_')}_`;

process.chdir(slotDir);
try {
  for (const phase of phases) {
    if (phase === 'normalize') {
      execFileSync(process.execPath, [fileURLToPath(new URL('./normalize.mjs', import.meta.url))], {
        env: {
          ...process.env,
          NPM_PORTS_ROOT: port.root,
          NPMBUILD_DIR: dir,
          NPMBUILD_SLOT: slot,
        },
        stdio: 'inherit',
      });
      continue;
    }
    if (!['prepare', 'build', 'package'].includes(phase)) throw new Error(`Unknown JS recipe phase: ${phase}`);
    const hook = `${prefix}${phase}`;
    if (typeof port[hook] !== 'function') continue;
    if (phase === 'package') process.chdir(slotDir);
    console.log(`==> ${dir}${slot === 'main' ? '' : `/${slot}`}: ${hook}`);
    activateRecipe(port);
    await port[hook](port);
  }
} finally {
  deactivateRecipe();
}
