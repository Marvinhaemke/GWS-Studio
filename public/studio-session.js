/* Server-verified Studio identity is separate from the prototype role views. */
(()=>{
 const button=document.createElement('a');button.className='btn small';button.href='/login';button.textContent='Studio anmelden';button.style.cssText='position:fixed;right:20px;bottom:18px;z-index:60;box-shadow:0 3px 15px #244f3e20';
 document.body.append(button);
 async function status(){try{const r=await fetch('/api/studio/session',{credentials:'same-origin',cache:'no-store'});if(!r.ok)return;const d=await r.json();if(d.authenticated){button.textContent='Abmelden · '+(d.user?.name||'Studio');button.href='#';button.addEventListener('click',async e=>{e.preventDefault();button.style.pointerEvents='none';try{const result=await fetch('/api/auth/sign-out',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});if(result.ok)location.assign('/login')}finally{button.style.pointerEvents=''}})}else if(!d.configured){button.textContent='Studio einrichten'}}catch{}}
 if(location.protocol!=='file:')status();
})();
