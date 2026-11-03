import http from 'node:http';
import {readFileSync,readdirSync,mkdirSync,chmodSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createFrameioHandler} from './frameio.mjs';
import {createApplication} from './application.mjs';
import {createD1Store} from './store.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const runtime=join(root,'.gws-runtime');
mkdirSync(runtime,{recursive:true,mode:0o700});
const database=new DatabaseSync(join(runtime,'frameio.sqlite'));
chmodSync(join(runtime,'frameio.sqlite'),0o600);
database.exec(readFileSync(join(root,'server/schema.sql'),'utf8'));
// Small adapter uses exactly the D1 SQL store contract, without an npm dependency.
const db={prepare(sql){return {bind(...params){const stmt=database.prepare(sql);return {async first(){return stmt.get(...params)||null},async run(){return stmt.run(...params)}}}}}};
const store=createD1Store(db);
const cleanupTimer=setInterval(()=>store.cleanup().catch(()=>{}),5*60*1000);cleanupTimer.unref();
const assets={};
for (const name of readdirSync(join(root,'public'))) if (/\.(html|js|css|svg)$/.test(name)) assets['/'+name]=readFileSync(join(root,'public',name),'utf8');
const env={...process.env};
const port=Number(env.PORT||4173);
if (!Number.isInteger(port)||port<1024||port>65535) throw new Error('PORT must be between 1024 and 65535');
env.APP_ORIGIN ||= `http://127.0.0.1:${port}`;
// Local identity is intentionally confined to this loopback-only dev adapter.
const app=createApplication({frameio:createFrameioHandler({store,allowLocalIdentity:true}),assets});
const server=http.createServer(async (req,res)=>{
  try {
    if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {res.writeHead(403);res.end();return;}
    const headers=new Headers();
    for (const [key,value] of Object.entries(req.headers)) if (value!==undefined && !key.startsWith('oai-authenticated-')) headers.set(key,Array.isArray(value)?value.join(','):value);
    let body;
    if (!['GET','HEAD'].includes(req.method)) {
      const chunks=[];let size=0;
      for await (const chunk of req) {size+=chunk.length;if(size>1048576){res.writeHead(413);res.end();return;}chunks.push(chunk);}
      body=Buffer.concat(chunks);
    }
    const request=new Request(new URL(req.url,env.APP_ORIGIN),{method:req.method,headers,...(body?{body}:{}),duplex:'half'});
    const response=await app(request,env);
    res.statusCode=response.status;
    for (const [key,value] of response.headers) if (key.toLowerCase()!=='set-cookie') res.setHeader(key,value);
    if(response.headers.getSetCookie().length)res.setHeader('Set-Cookie',response.headers.getSetCookie());
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'SERVER_ERROR',message:'Lokaler Serverfehler.'}}));}
});
server.listen(port,'127.0.0.1',()=>console.log(`GWS Studio: http://127.0.0.1:${port}\nLocal development identity enabled only on loopback.\nFrame.io OAuth requires a registered HTTPS callback; see FRAMEIO-SETUP.md.`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{clearInterval(cleanupTimer);database.close();process.exit(0)}));
