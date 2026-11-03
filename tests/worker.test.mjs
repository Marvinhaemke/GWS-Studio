import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/index.mjs';
test('Worker serves the studio without a local mock identity and blocks anonymous API access',async()=>{
 const worker=createWorker({'/index.html':'GWS Studio','/frameio.js':'// Frame.io client'});
 let response=await worker.fetch(new Request('https://studio.example/'),{},{});
 assert.equal(response.status,200);assert.equal(await response.text(),'GWS Studio');
 response=await worker.fetch(new Request('https://studio.example/api/frameio/status'),{},{});
 assert.equal(response.status,401);
 response=await worker.fetch(new Request('https://studio.example/api/frameio/status',{headers:{'oai-authenticated-user-id':'real-sites-visitor'}}),{},{});
 const status=await response.json();assert.equal(status.connected,false);assert.ok(status.missing.includes('DB'));assert.ok(status.missing.includes('FRAMEIO_CLIENT_SECRET'));assert.equal(status.csrfToken,null);
 response=await worker.fetch(new Request('https://studio.example/api/frameio/review?accountId=x&fileId=y',{headers:{'oai-authenticated-user-id':'real-sites-visitor'}}),{},{});
 assert.equal(response.status,503);
});
