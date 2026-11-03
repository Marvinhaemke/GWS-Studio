import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {createStudioUser} from '../server/auth.mjs';
function args(values){const out={};for(let i=0;i<values.length;i++){if(values[i]==='--help')return {help:true};if(!['--email','--name'].includes(values[i])||!values[i+1])throw Error('Usage: npm run user:create -- --email you@example.com --name "Your Name"');out[values[i].slice(2)]=values[++i];}return out;}
async function passwords(){
  if(process.stdin.isTTY){
    const muted=new Writable({write(_chunk,_encoding,done){done();}});muted.isTTY=true;muted.columns=80;
    const rl=createInterface({input:process.stdin,output:muted,terminal:true});
    try{process.stdout.write('Password (hidden): ');const first=await rl.question('');process.stdout.write('\nConfirm password (hidden): ');const second=await rl.question('');process.stdout.write('\n');return [first,second];}finally{rl.close();}
  }
  let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>4096)throw Error('Password input too long.');}
  const lines=raw.split(/\r?\n/);return [lines[0],lines[1]];
}
try{
  const options=args(process.argv.slice(2));
  if(options.help){console.log('Usage: npm run user:create -- --email you@example.com --name "Your Name"\nPassword is read twice from hidden stdin; do not pass it as an argument or environment variable.');}
  else{
    if(!options.email||!options.name)throw Error('Both --email and --name are required.');
    const [password,confirmation]=await passwords();if(password!==confirmation)throw Error('Passwords do not match.');
    await createStudioUser({...options,password});console.log('Studio team account created. Public sign-up remains disabled.');
  }
}catch(error){console.error(error.message);process.exitCode=1;}
