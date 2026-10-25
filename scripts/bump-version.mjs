// Raises the ?v= number on every app file and the service-worker cache together,
// so a phone never mixes a new page with an old cached module. Run after changing dist/.
import { readFile, writeFile, readdir } from 'node:fs/promises';
const dist = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');
const next = Math.max(...[...html.matchAll(/\?v=(\d+)/g)].map(m => +m[1])) + 1;
for (const name of ['index.html', ...(await readdir(dist)).filter(n => n.endsWith('.mjs'))]) {
  const file = new URL(name, dist);
  await writeFile(file, (await readFile(file, 'utf8')).replace(/\?v=\d+/g, `?v=${next}`));
}
const sw = new URL('sw.js', dist);
await writeFile(sw, (await readFile(sw, 'utf8')).replace(/ruach-shell-v\d+/, `ruach-shell-v${next}`));
console.log(`version ${next}`);
