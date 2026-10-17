import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
const runtimeRequire=createRequire('C:/Users/masti/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.runtime.cjs');
const sharp=runtimeRequire('sharp');
const svg=await readFile(new URL('../dist/icon.svg',import.meta.url));
for(const size of [192,512])await writeFile(new URL(`../dist/icon-${size}.png`,import.meta.url),await sharp(svg).resize(size,size).png().toBuffer());
console.log('Android icons generated.');
