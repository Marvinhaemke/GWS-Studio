import {createAuthService} from './auth.mjs';
import {createPostgresStore} from './postgres-store.mjs';
import {createFrameioHandler} from './frameio.mjs';
import {securityHeaders} from './application.mjs';
export function deploymentEnvironment(input={}) {
  const env={...input};
  if(!env.APP_ORIGIN){
    const hostname=env.VERCEL_ENV==='production'?env.VERCEL_PROJECT_PRODUCTION_URL:(env.VERCEL_BRANCH_URL||env.VERCEL_URL);
    if(hostname && /^[a-z0-9][a-z0-9.-]*\.vercel\.app$/i.test(hostname))env.APP_ORIGIN='https://'+hostname;
  }
  env.APP_ORIGIN ||= env.BETTER_AUTH_URL;
  return env;
}
export function routedRequest(request){
  const url=new URL(request.url);
  if(url.pathname==='/api/studio'&&url.searchParams.has('__gws_path')){
    const path=url.searchParams.get('__gws_path');
    if(!/^(?:frameio|auth|studio)(?:\/[a-zA-Z0-9_.|:-]+)*$/.test(path))return null;
    url.pathname='/api/'+path;url.searchParams.delete('__gws_path');
    return new Request(url,request);
  }
  return request;
}
const failure=(code,message,status=503)=>Response.json({error:{code,message}},{status});
export function createVercelApplication({env:input=process.env,auth:providedAuth,store:providedStore,loadPool=()=>import('pg'),fetchImpl=fetch}={}){
  const env=deploymentEnvironment(input);let initialization;
  const auth=providedAuth||createAuthService({env});
  async function frameio(){
    if(!initialization)initialization=(async()=>{
      let store=providedStore;
      if(!store){if(!env.DATABASE_URL)throw Error('database_not_configured');const {Pool}=await loadPool();const pool=new Pool({connectionString:env.DATABASE_URL,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});store=createPostgresStore((text,params)=>pool.query(text,params));}
      const handler=createFrameioHandler({store,fetchImpl,resolveIdentity:request=>auth.getUser(request)});
      let nextCleanup=0;
      return async(request,configuration)=>{const response=await handler(request,configuration);if(response?.status<400&&Date.now()>nextCleanup){nextCleanup=Date.now()+300000;await store.cleanup().catch(()=>{});}return response;};
    })().catch(()=>{initialization=undefined;throw Error('integration_not_ready')});
    return initialization;
  }
  return async function handle(original){
    let response;
    try{
      const request=routedRequest(original);if(!request)return failure('not_found','Endpunkt nicht gefunden.',404);
      const url=new URL(request.url),status=auth.status();
      if(url.pathname==='/api/studio/session'&&request.method==='GET'){
        if(!status.configured)response=Response.json({configured:false,authenticated:false,missing:status.missing});
        else{const user=await auth.getUser(request);response=Response.json({configured:true,authenticated:Boolean(user),...(user?{user}:{})});}
      }else if(url.pathname.startsWith('/api/auth/'))response=await auth.handler(request);
      else if(url.pathname.startsWith('/api/frameio/')){
        if(url.pathname!=='/api/frameio/webhook'&&!status.configured)response=failure('auth_not_configured','Die Studio-Anmeldung muss zuerst eingerichtet werden.');
        else response=await (await frameio())(request,env);
      }else response=failure('not_found','Endpunkt nicht gefunden.',404);
    }catch{response=failure('service_unavailable','Das Studio ist gerade nicht verfügbar. Bitte Datenbankverbindung und Servereinrichtung prüfen.');}
    if(!response)response=failure('not_found','Endpunkt nicht gefunden.',404);
    const headers=new Headers(response.headers);for(const [key,value]of Object.entries(securityHeaders))headers.set(key,value);
    headers.set('Cache-Control','private, no-store');headers.set('Pragma','no-cache');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  };
}
