import http from 'node:http';
import {readFileSync,readdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createVercelApplication} from './vercel-app.mjs';
import {createApplication} from './application.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const env={...process.env},port=Number(env.PORT||4173);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid PORT');
env.APP_ORIGIN ||= 'http://127.0.0.1:'+port;
const api=createVercelApplication({env}),assets={};
for(const name of readdirSync(join(root,'public')))if(/\.(html|js|css|svg)$/.test(name))assets['/'+name]=readFileSync(join(root,'public',name),'utf8');
const staticApp=createApplication({frameio:async()=>null,assets});
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,env.APP_ORIGIN);if(url.pathname==='/login')url.pathname='/login.html';
  const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(value!==undefined&&!key.startsWith('oai-authenticated-'))headers.set(key,Array.isArray(value)?value.join(','):value);
  const chunks=[];let size=0;if(!['GET','HEAD'].includes(req.method))for await(const chunk of req){size+=chunk.length;if(size>65536){res.writeHead(413);res.end();return}chunks.push(chunk)}
  const request=new Request(url,{method:req.method,headers,...(chunks.length?{body:Buffer.concat(chunks),duplex:'half'}:{})});
  const result=await(url.pathname.startsWith('/api/')?api(request):staticApp(request,env));
  res.statusCode=result.status;for(const[key,value]of result.headers)if(key!=='set-cookie')res.setHeader(key,value);
  if(result.headers.getSetCookie().length)res.setHeader('Set-Cookie',result.headers.getSetCookie());res.end(Buffer.from(await result.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Studio server unavailable')}
});
server.listen(port,'127.0.0.1',()=>console.log('GWS Studio: http://127.0.0.1:'+port+' · Login uses Neon-backed sessions.'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
