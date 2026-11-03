/** Optional public edge receiver for an owner-private Sites deployment.
 * Not part of the private Studio Worker. Deploy separately, with secrets set by its owner.
 * The private backend re-verifies the unchanged Frame.io signature after forwarding.
 */
export default {
  async fetch(request,env) {
    if(request.method!=='POST'||new URL(request.url).pathname!=='/frameio')return new Response('Not found',{status:404});
    if(!env.FRAMEIO_WEBHOOK_SECRET||!env.GWS_PRIVATE_SERVICE_TOKEN||!env.GWS_STUDIO_ORIGIN)return new Response('Receiver not configured',{status:503});
    const timestamp=request.headers.get('X-Frameio-Request-Timestamp')||'',signature=request.headers.get('X-Frameio-Signature')||'';
    if(!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300||!/^v0=[a-f0-9]{64}$/i.test(signature))return new Response('Unauthorized',{status:401});
    if(Number(request.headers.get('content-length'))>65536)return new Response('Too large',{status:413});
    const reader=request.body?.getReader();if(!reader)return new Response('Bad request',{status:400});
    const chunks=[];let length=0;
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>65536){await reader.cancel();return new Response('Too large',{status:413})}chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const raw=new TextDecoder().decode(bytes),encoder=new TextEncoder();
    const key=await crypto.subtle.importKey('raw',encoder.encode(env.FRAMEIO_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const digest=await crypto.subtle.sign('HMAC',key,encoder.encode(`v0:${timestamp}:${raw}`));
    const expected='v0='+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    let mismatch=expected.length^signature.length;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^(signature.toLowerCase().charCodeAt(i)||0);
    if(mismatch)return new Response('Unauthorized',{status:401});
    let target;try{const u=new URL(env.GWS_STUDIO_ORIGIN);if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error();target=new URL('/api/frameio/webhook',u)}catch{return new Response('Receiver not configured',{status:503})}
    try {
      const response=await fetch(target,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','X-Frameio-Request-Timestamp':timestamp,'X-Frameio-Signature':signature,'OAI-Sites-Authorization':'Bearer '+env.GWS_PRIVATE_SERVICE_TOKEN},body:bytes,signal:AbortSignal.timeout(4000)});
      return new Response(response.ok?'Accepted':'Delivery failed',{status:response.ok?202:503,headers:{'Cache-Control':'no-store'}});
    }catch{return new Response('Delivery failed',{status:503})}
  }
};
