import {readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
for(const path of ['public/index.html','public/login.html','public/frameio.js','api/studio.js','db/migrations/001_frameio.sql','db/migrations/002_auth.sql'])await access(join(root,path));
for(const file of ['api/studio.js','server/vercel-app.mjs','server/auth.mjs','server/postgres-store.mjs','server/frameio.mjs','public/login.js','public/studio-session.js']){
 const check=spawnSync(process.execPath,['--check',join(root,file)],{encoding:'utf8'});if(check.status!==0)throw Error('Syntax check failed: '+file);
}
const config=JSON.parse(await readFile(join(root,'vercel.json'),'utf8'));
if(config.outputDirectory!=='public'||!config.functions['api/studio.js'])throw Error('Invalid Vercel build configuration');
console.log('Vercel build validated: public/ static assets + api/studio.js Node Function. No database migrations run during build.');
