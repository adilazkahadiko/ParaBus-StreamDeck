import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const plugin = 'io.github.adilazkahadiko.parabus.sdPlugin';
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const manifest = JSON.parse(await readFile(`${plugin}/manifest.json`, 'utf8'));
const sourceNotice = await readFile(`${plugin}/SOURCE.txt`, 'utf8');
if (manifest.Version !== `${version}.0` || !sourceNotice.includes(`/tree/v${version}`) || !sourceNotice.includes(`/refs/tags/v${version}.zip`)) {
  throw new Error('Package version and corresponding-source notice must match');
}
await mkdir(`${plugin}/bin`, { recursive: true });
await mkdir('dist', { recursive: true });
await copyFile('LICENSE', `${plugin}/LICENSE`);
const result = await build({
  entryPoints: ['src/plugin.ts'], outfile: `${plugin}/bin/plugin.js`, bundle: true,
  platform: 'node', format: 'esm', target: 'node24', metafile: true,
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  legalComments: 'eof'
});
// Include the exact licenses for every library actually bundled, including SDK transitives.
const packages = new Set(Object.keys(result.metafile.inputs).filter(p => p.includes('node_modules/')).map(p => {
  const parts = p.split('node_modules/').at(-1).split('/'); return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}));
let notices = 'ParaBus Stream Deck is GPL-3.0-only. Bundled third-party libraries retain their licenses.\n';
for (const name of [...packages].sort()) {
  let dir = path.dirname(require.resolve(name));
  for (;;) {
    try { const p = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')); if (p.name === name) break; } catch { /* walk up */ }
    const parent = path.dirname(dir); if (parent === dir) throw new Error('License package not found'); dir = parent;
  }
  const p = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  let license;
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT']) {
    try { license = await readFile(path.join(dir, file), 'utf8'); break; } catch { /* next spelling */ }
  }
  if (!license) throw new Error(`Missing license file for ${name}`);
  notices += `\n===== ${name}@${p.version} (${p.license}) =====\n${license}\n`;
}
await writeFile(`${plugin}/THIRD_PARTY_LICENSES.txt`, notices);
await writeFile('dist/build.json', JSON.stringify({ bundled: [...packages].sort() }, null, 2));
console.log('Built plugin and bundled license notices.');
