import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  const relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html';
  const target=path.resolve(root,relative);
  if(!target.startsWith(path.resolve(root)+path.sep)){res.writeHead(403);res.end();return;}
  const info=await stat(target);if(!info.isFile())throw new Error();
  res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(await readFile(target));
 }catch{res.writeHead(404);res.end('Not found');}
});
// PHONE=1 opens the server to the home network so a phone on the same Wi-Fi can try the app.
const host=process.env.PHONE?'0.0.0.0':'127.0.0.1';
server.listen(4173,host,async()=>{
 console.log('Local: http://127.0.0.1:4173');
 if(process.env.PHONE){const {networkInterfaces}=await import('node:os');for(const list of Object.values(networkInterfaces()))for(const a of list||[])if(a.family==='IPv4'&&!a.internal)console.log(`Phone (same Wi-Fi): http://${a.address}:4173`);}
});
