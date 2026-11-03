import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../server/application.mjs';
test('application serves exact static paths, preserves auth cookies, and applies private API headers',async()=>{
 const app=createApplication({assets:{'/index.html':'<html>GWS Studio</html>','/app.js':'void 0'},frameio:async()=>new Response('{"connected":false}',{headers:{'Content-Type':'application/json','Set-Cookie':'session=opaque; HttpOnly'}})});
 let r=await app(new Request('https://studio.example/'));assert.equal(r.status,200);assert.match(await r.text(),/GWS Studio/);assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 r=await app(new Request('https://studio.example/.env'));assert.equal(r.status,404);
 r=await app(new Request('https://studio.example/api/frameio/status'));assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.match(r.headers.get('Set-Cookie'),/HttpOnly/);
 r=await app(new Request('https://studio.example/',{method:'POST'}));assert.equal(r.status,405);
});
