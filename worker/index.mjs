import {createFrameioHandler} from '../server/frameio.mjs';
import {createD1Store} from '../server/store.mjs';
import {createApplication} from '../server/application.mjs';
export function createWorker(assets) {
  const applications=new WeakMap();
  return {
    async fetch(request,env,ctx) {
      if (!env.DB && new URL(request.url).pathname.startsWith('/api/frameio')) {
        const user=request.headers.get('oai-authenticated-user-id');
        if (!user && !new URL(request.url).pathname.endsWith('/webhook')) return Response.json({error:{code:'sign_in_required',message:'Bitte zuerst am Studio anmelden.'}},{status:401,headers:{'Cache-Control':'private, no-store'}});
        if(new URL(request.url).pathname==='/api/frameio/status')return Response.json({configured:false,connected:false,csrfToken:null,missing:['DB',...['FRAMEIO_CLIENT_ID','FRAMEIO_CLIENT_SECRET','APP_ORIGIN','SESSION_SECRET'].filter(k=>!env[k])]},{headers:{'Cache-Control':'private, no-store'}});
        return Response.json({error:{code:'storage_not_configured',message:'Die serverseitige Frame.io-Sitzungsdatenbank ist noch nicht eingerichtet.'}},{status:503,headers:{'Cache-Control':'private, no-store'}});
      }
      let entry=env.DB?applications.get(env.DB):null;
      if(!entry){const store=createD1Store(env.DB);entry={store,application:createApplication({frameio:createFrameioHandler({store}),assets}),nextCleanup:0};if(env.DB)applications.set(env.DB,entry);}
      if(env.DB && Date.now()>entry.nextCleanup){entry.nextCleanup=Date.now()+300000;const cleanup=entry.store.cleanup().catch(()=>{});if(ctx?.waitUntil)ctx.waitUntil(cleanup);else await cleanup;}
      const response=await entry.application(request,env);
      return response;
    }
  };
}
