import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const path of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'img', 'icons', 'js']) {
  await cp(resolve(root, path), resolve(output, path), { recursive: true });
}

console.log('Aplicativo web copiado para dist/.');
