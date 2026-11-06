import { mkdir, writeFile } from 'node:fs/promises';
const dir = 'io.github.adilazkahadiko.parabus.sdPlugin/imgs';
await mkdir(dir, { recursive: true });
const images = {
  plugin: ['#122e32', '<path d="M35 28v62m37-62v62m37-62v62"/><path d="M25 47h20m17 25h20m17-34h20" stroke="#79e2ca" stroke-width="12"/>'],
  category: ['#122e32', '<path d="M35 28v62m37-62v62m37-62v62"/><path d="M25 47h20m17 25h20m17-34h20" stroke="#79e2ca" stroke-width="12"/>'],
  muted: ['#451e28', '<circle cx="72" cy="46" r="24"/><path d="m54 28 36 36" stroke="#ff8b99"/>'],
  open: ['#143e36', '<circle cx="72" cy="46" r="24"/><path d="m59 46 9 9 18-21" stroke="#79e2ca"/>'],
  'fader-up': ['#183b43', '<path d="M44 72V23m-12 0h24m-12 26h20m24 21V25m-13 13 13-13 13 13"/>'],
  'fader-down': ['#183b43', '<path d="M44 72V23m-12 0h24m-12 26h20m24-24v45m-13-13 13 13 13-13"/>'],
  emergency: ['#433015', '<path d="m72 18 30 53H42Z"/><path d="M72 36v16m0 9v1" stroke="#ffd274"/>'],
  'emergency-on': ['#671d28', '<path d="m72 18 30 53H42Z"/><path d="M72 36v16m0 9v1" stroke="#ffbdc4"/>'],
  offline: ['#292d35', '<path d="M48 39v16h16m32-16v16H80m-24 6 32-32" stroke="#a6aebb"/>'],
  error: ['#50321e', '<circle cx="72" cy="46" r="24"/><path d="M72 31v19m0 10v1" stroke="#ffc48e"/>']
};
for (const [name, [background, shapes]] of Object.entries(images)) {
  await writeFile(`${dir}/${name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="16" fill="${background}"/><g fill="none" stroke="#e7f6f1" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${shapes}</g></svg>\n`);
}
