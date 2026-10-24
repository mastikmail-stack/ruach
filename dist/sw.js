// Cache only our static application shell. Never cache route/weather responses,
// map tiles, login redirects or authenticated documents outside this app shell.
const CACHE='ruach-shell-v8';
const SHELL=['./','./index.html','./app.css','./app.mjs','./core.mjs','./conditions.mjs','./view.mjs','./navigation.mjs','./ride3d.mjs','./icon.svg','./icon-192.png','./icon-512.png','./manifest.webmanifest','./vendor/leaflet.js','./vendor/leaflet.css'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  for(const asset of SHELL){
    try{const r=await fetch(new Request(asset,{cache:'reload'}));if(r.ok&&!r.redirected&&new URL(r.url).origin===self.location.origin)await cache.put(asset,r);}catch{}
  }
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('ruach-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const relative=url.pathname.slice(new URL(self.registration.scope).pathname.length);
  const shellPaths=SHELL.map(s=>s.replace(/^\.\//,''));
  if(!shellPaths.includes(relative))return;
  event.respondWith((async()=>{
    // Revalidate even when the browser HTTP cache still considers a file fresh.
    // GitHub Pages may otherwise mix new HTML with an older application module.
    try{return await fetch(event.request,{cache:'no-cache'});}catch{return await caches.match(event.request,{ignoreSearch:true})||new Response('נדרש חיבור לאינטרנט',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}
  })());
});
