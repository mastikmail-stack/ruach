import {mkdir,writeFile} from 'node:fs/promises';
const target=new URL('../dist/vendor/',import.meta.url);
await mkdir(target,{recursive:true});
for(const [file,url] of [
 ['leaflet.js','https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'],
 ['leaflet.css','https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'],
 ['LICENSE','https://unpkg.com/leaflet@1.9.4/LICENSE']
]){
 const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Download failed: ${file} (${response.status})`);
 await writeFile(new URL(file,target),await response.text());console.log(`Saved ${file}`);
}
