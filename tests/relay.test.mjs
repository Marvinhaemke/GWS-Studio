import {test} from 'node:test';
import assert from 'node:assert/strict';
import relay from '../server/webhook-relay.mjs';
const env={FRAMEIO_WEBHOOK_SECRET:'signing-test-value',GWS_PRIVATE_SERVICE_TOKEN:'private-studio-service-test',GWS_STUDIO_ORIGIN:'https://private-studio.example'};
test('public relay rejects unsigned requests before using private service access',async()=>{
 const result=await relay.fetch(new Request('https://relay.example/frameio',{method:'POST',body:'{}'}),env);
 assert.equal(result.status,401);assert.doesNotMatch(await result.text(),/private-studio-service/);
});
test('valid signed webhook is forwarded only to configured studio with preserved body and service auth',async()=>{
 const raw='{"type":"comment.created"}',timestamp=String(Math.floor(Date.now()/1000)),encoder=new TextEncoder();
 const key=await crypto.subtle.importKey('raw',encoder.encode(env.FRAMEIO_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signed=await crypto.subtle.sign('HMAC',key,encoder.encode(`v0:${timestamp}:${raw}`));
 const signature='v0='+Array.from(new Uint8Array(signed),n=>n.toString(16).padStart(2,'0')).join('');
 let calls=0;const previous=globalThis.fetch;
 globalThis.fetch=async (url,options)=>{calls++;assert.equal(String(url),'https://private-studio.example/api/frameio/webhook');assert.equal(options.headers['OAI-Sites-Authorization'],'Bearer '+env.GWS_PRIVATE_SERVICE_TOKEN);assert.equal(options.headers['X-Frameio-Signature'],signature);assert.equal(new TextDecoder().decode(options.body),raw);return new Response('{}',{status:202});};
 try{const response=await relay.fetch(new Request('https://relay.example/frameio',{method:'POST',headers:{'X-Frameio-Request-Timestamp':timestamp,'X-Frameio-Signature':signature},body:raw}),env);assert.equal(response.status,202);assert.equal(calls,1);assert.equal(await response.text(),'Accepted');}
 finally{globalThis.fetch=previous;}
});
