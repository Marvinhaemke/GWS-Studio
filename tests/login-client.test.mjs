import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/login.js',import.meta.url),'utf8');
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
async function fixture(respond){
  const nodes=new Map(),calls=[],redirects=[],intervals=[];
  for(const id of ['login-form','login-email','login-password','login-submit','login-submit-text','login-error','login-status','login-setup','login-retry'])nodes.set('#'+id,{value:'',hidden:false,disabled:false,textContent:'',listeners:{},attributes:{},addEventListener(name,fn){this.listeners[name]=fn},setAttribute(k,v){this.attributes[k]=v},focus(){this.focused=true},checkValidity(){return true}});
  const context={document:{querySelector:key=>nodes.get(key)},location:{replace:url=>redirects.push(url)},fetch:async(path,options)=>{calls.push({path,options});return respond(path,options,calls)},AbortController,setTimeout:()=>1,clearTimeout(){},setInterval:fn=>{intervals.push(fn);return intervals.length},clearInterval(){},Date,console};
  vm.runInNewContext(source,context,{filename:'login.js'});
  await new Promise(resolve=>setImmediate(resolve));
  return {nodes,calls,redirects,intervals,async submit(){await nodes.get('#login-form').listeners.submit({preventDefault(){}})},async retry(){await nodes.get('#login-retry').listeners.click()}};
}
test('missing setup never enables credential entry or posts a password',async()=>{
  const f=await fixture(()=>json({configured:false,authenticated:false,missing:['DATABASE_URL']}));
  assert.equal(f.nodes.get('#login-form').hidden,true);
  assert.equal(f.nodes.get('#login-setup').hidden,false);
  assert.equal(f.nodes.get('#login-submit').disabled,true);
  await f.submit();assert.equal(f.calls.length,1);
});
test('successful sign-in confirms a same-origin session and ignores provider token/redirect fields',async()=>{
  let sessions=0;
  const f=await fixture(path=>path==='/api/studio/session'?json({configured:true,authenticated:++sessions>1}):json({token:'must-not-be-used',url:'https://evil.example'}));
  f.nodes.get('#login-email').value=' person@example.com ';f.nodes.get('#login-password').value='keep spaces ';
  await f.submit();
  const post=f.calls.find(c=>c.path==='/api/auth/sign-in/email');
  assert.equal(post.options.method,'POST');assert.equal(post.options.credentials,'same-origin');assert.equal(post.options.redirect,'error');
  assert.deepEqual(JSON.parse(post.options.body),{email:'person@example.com',password:'keep spaces ',callbackURL:'/'});
  assert.equal(sessions,2);assert.deepEqual(f.redirects,['/']);assert.equal(f.nodes.get('#login-password').value,'');
});
test('invalid credentials disclose no provider details and never replay the request',async()=>{
  const f=await fixture(path=>path==='/api/studio/session'?json({configured:true,authenticated:false}):json({message:'Private account detail that must stay hidden'},401));
  f.nodes.get('#login-email').value='person@example.com';f.nodes.get('#login-password').value='wrong';
  await f.submit();
  assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
  assert.match(f.nodes.get('#login-error').textContent,/E-Mail-Adresse und dein Passwort/);
  assert.doesNotMatch(f.nodes.get('#login-error').textContent,/Private account/);assert.deepEqual(f.redirects,[]);
});
test('rate limiting disables repeat submissions until Retry-After passes',async()=>{
  const f=await fixture(path=>path==='/api/studio/session'?json({configured:true,authenticated:false}):json({},429,{'Retry-After':'20'}));
  f.nodes.get('#login-email').value='person@example.com';f.nodes.get('#login-password').value='test';
  await f.submit();await f.submit();
  assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(f.nodes.get('#login-submit').disabled,true);
});
test('an unconfirmed sign-in is checked with GET instead of automatically repeating the password submission',async()=>{
  let sessions=0;
  const f=await fixture(path=>path==='/api/studio/session'?json({configured:true,authenticated:++sessions>2}):json({}));
  f.nodes.get('#login-email').value='person@example.com';f.nodes.get('#login-password').value='test';
  await f.submit();assert.deepEqual(f.redirects,[]);assert.equal(f.nodes.get('#login-retry').hidden,false);
  await f.retry();assert.deepEqual(f.redirects,['/']);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
});
