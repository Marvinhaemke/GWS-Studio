import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createD1Store} from '../server/store.mjs';
import {createApplication} from '../server/application.mjs';
function dbAdapter(sqlite){return {prepare(sql){return {bind(...args){let s=sqlite.prepare(sql);return {async first(){return s.get(...args)},async run(){return s.run(...args)}}}}}}}
test('SQLite/D1 persistence contract enforces expiry and atomic refresh leases', async()=>{
 let now=100;const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE frameio_kv(key TEXT PRIMARY KEY,value TEXT NOT NULL,expires_at INTEGER NOT NULL)');const store=createD1Store(dbAdapter(db),()=>now);
 await store.set('session',{encrypted:'ciphertext'},200);assert.deepEqual(await store.get('session'),{encrypted:'ciphertext'});
 assert.equal(await store.tryLock('refresh',110),true);assert.equal(await store.tryLock('refresh',120),false);now=111;assert.equal(await store.tryLock('refresh',130),true);await store.unlock('refresh');assert.equal(await store.tryLock('refresh',130),true);
 now=201;assert.equal(await store.get('session'),null);await store.cleanup();assert.equal(db.prepare('SELECT count(*) AS n FROM frameio_kv').get().n,0);db.close();
});
test('application serves exact static paths, preserves auth cookies, and applies private API headers',async()=>{
 const app=createApplication({assets:{'/index.html':'<html>GWS Studio</html>','/app.js':'void 0'},frameio:async()=>new Response('{"connected":false}',{headers:{'Content-Type':'application/json','Set-Cookie':'session=opaque; HttpOnly'}})});
 let r=await app(new Request('https://studio.example/'));assert.equal(r.status,200);assert.match(await r.text(),/GWS Studio/);assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 r=await app(new Request('https://studio.example/.env'));assert.equal(r.status,404);
 r=await app(new Request('https://studio.example/api/frameio/status'));assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.match(r.headers.get('Set-Cookie'),/HttpOnly/);
 r=await app(new Request('https://studio.example/',{method:'POST'}));assert.equal(r.status,405);
});
