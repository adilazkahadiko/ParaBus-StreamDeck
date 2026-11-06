import { readFile, writeFile } from 'node:fs/promises';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const rows = [];
for (const [location, p] of Object.entries(lock.packages)) {
  if (!location) continue;
  const name = location.split('node_modules/').at(-1);
  let license = p.license;
  if (!license) { try { license = JSON.parse(await readFile(`${location}/package.json`, 'utf8')).license; } catch { /* optional other-platform package */ } }
  if (!license) throw new Error(`Missing license for ${name}`);
  rows.push(`| ${name} | ${p.version} | ${license} | ${p.dev ? 'development' : 'runtime'}${p.optional ? ', optional' : ''} |`);
}
await writeFile('docs/DEPENDENCIES.md', '# Locked dependencies\n\nGenerated from package-lock.json by `npm run licenses`. Includes transitive and optional platform packages. Runtime library license texts are included in every pack.\n\n| Package | Exact version | License | Use |\n| --- | --- | --- | --- |\n' + rows.sort().join('\n') + '\n');
console.log(`Recorded ${rows.length} locked dependency entries.`);
