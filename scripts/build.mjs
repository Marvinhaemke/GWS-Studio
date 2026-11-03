import {readFile,readdir,mkdir,writeFile,rm,copyFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dist=join(root,'dist');
// Build always starts from public/, never from a previous generated artifact.
const assets={};
for(const name of await readdir(join(root,'public'))){
 if(/\.(html|js|css|svg)$/.test(name))assets['/'+name]=await readFile(join(root,'public',name),'utf8');
}
const files=[['server/frameio.mjs','createFrameioHandler'],['server/store.mjs','createD1Store'],['server/application.mjs','createApplication'],['worker/index.mjs','createWorker']];
let output='// GWS Studio · generated Worker ESM. Edit source under public/, server/, worker/.\n';
for(const [file,name]of files){let code=await readFile(join(root,file),'utf8');code=code.replace(/^import .*?;\s*$/gm,'').replace(/\bexport (async )?function /g,(_,a)=>`${a||''}function `).replace(/\bexport const /g,'const ');if(/\bexport\s/.test(code))throw new Error(`Unsupported export in ${file}`);output+=`const ${name}=(()=>{\n${code}\nreturn ${name};\n})();\n`;}
output+='const assets='+JSON.stringify(assets)+';\nexport default createWorker(assets);\n';
await rm(dist,{recursive:true,force:true});
await mkdir(join(dist,'server'),{recursive:true});
await mkdir(join(dist,'.openai'),{recursive:true});
await writeFile(join(dist,'server/index.js'),output);
await copyFile(join(root,'.openai/hosting.json'),join(dist,'.openai/hosting.json'));
await copyFile(join(root,'server/schema.sql'),join(dist,'.openai/frameio-schema.sql'));
console.log(`Built Worker ESM with ${Object.keys(assets).length} static assets.`);
