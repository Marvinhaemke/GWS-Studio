/** Studio authentication for Vercel. Authentication records live in Neon Postgres. */
const TABLES = Object.freeze({user:'gws_auth_user',session:'gws_auth_session',account:'gws_auth_account',verification:'gws_auth_verification',rateLimit:'gws_auth_rate_limit'});
const secretKeys=new Set(['token','accesstoken','refreshtoken','idtoken','password','secret']);
export class AuthServiceError extends Error {
  constructor(code='auth_unavailable',message='Die Studio-Anmeldung ist gerade nicht verfügbar.',status=503){super(message);this.code=code;this.status=status;}
}
function configuration(env){
  const missing=[];
  if(typeof env.DATABASE_URL!=='string'||!env.DATABASE_URL)missing.push('DATABASE_URL');
  else try{if(!['postgres:','postgresql:'].includes(new URL(env.DATABASE_URL).protocol))missing.push('DATABASE_URL');}catch{missing.push('DATABASE_URL');}
  if(typeof env.BETTER_AUTH_SECRET!=='string'||env.BETTER_AUTH_SECRET.length<32)missing.push('BETTER_AUTH_SECRET');
  let origin;
  try{
    const value=env.APP_ORIGIN||env.BETTER_AUTH_URL;
    const url=new URL(value);
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!['https:','http:'].includes(url.protocol))throw Error();
    if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error();
    origin=url.origin;
    if(env.APP_ORIGIN&&env.BETTER_AUTH_URL&&new URL(env.BETTER_AUTH_URL).origin!==origin)throw Error();
  }catch{missing.push('APP_ORIGIN');}
  return {configured:missing.length===0,missing:[...new Set(missing)],origin};
}
export function createAuthOptions({env,database,allowBootstrapSignup=false}){
  const setup=configuration(env);
  if(!setup.configured)throw new AuthServiceError('auth_not_configured','Die Studio-Anmeldung muss zuerst eingerichtet werden.');
  return {
    appName:'GWS Studio',
    baseURL:setup.origin,
    basePath:'/api/auth',
    secret:env.BETTER_AUTH_SECRET,
    database,
    trustedOrigins:[setup.origin],
    user:{modelName:TABLES.user},
    session:{modelName:TABLES.session,expiresIn:7*86400,updateAge:86400,cookieCache:{enabled:false}},
    account:{modelName:TABLES.account},
    verification:{modelName:TABLES.verification},
    emailAndPassword:{enabled:true,disableSignUp:!allowBootstrapSignup,minPasswordLength:12,maxPasswordLength:128,autoSignIn:false},
    rateLimit:{enabled:true,storage:'database',modelName:TABLES.rateLimit,window:60,max:100,customRules:{'/sign-in/email':{window:60,max:5}}},
    advanced:{useSecureCookies:setup.origin.startsWith('https:'),ipAddress:{ipAddressHeaders:['x-real-ip']}},
    logger:{disabled:true}
  };
}
function publicUser(user){
  if(!user||typeof user.id!=='string'||!user.id||user.id.length>256)return null;
  return {id:user.id,name:typeof user.name==='string'?user.name.slice(0,120):'',email:typeof user.email==='string'?user.email.slice(0,320):''};
}
function sanitize(value){
  if(Array.isArray(value))return value.map(sanitize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!secretKeys.has(key.toLowerCase())).map(([key,item])=>[key,sanitize(item)]));
  return value;
}
function failure(code,message,status,extra={}){return Response.json({error:{code,message},...extra},{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
async function clientResponse(response){
  const headers=new Headers(response.headers);headers.set('Cache-Control','private, no-store');headers.delete('Content-Length');
  if(response.status>=500)return failure('auth_unavailable','Die Anmeldung ist gerade nicht verfügbar. Bitte später erneut versuchen.',503);
  if(!response.headers.get('content-type')?.includes('application/json'))return new Response(response.body,{status:response.status,headers});
  let body;try{body=await response.json();}catch{return failure('auth_unavailable','Die Anmeldung konnte nicht verarbeitet werden.',503);}
  return new Response(JSON.stringify(sanitize(body)),{status:response.status,headers});
}
/**
 * Dependency injection keeps tests independent of installed SDKs and a live database.
 * getUser() trusts only Better Auth's verified session, never caller-supplied identity headers.
 */
export function createAuthService({env=process.env,pool,loadAuth=()=>import('better-auth')}={}){
  const setup=configuration(env);let loading,ownedPool;
  async function instance(){
    if(!setup.configured)throw new AuthServiceError('auth_not_configured','Die Studio-Anmeldung muss zuerst eingerichtet werden.');
    if(!loading)loading=(async()=>{
      let database=pool;
      if(!database){const {Pool}=await import('pg');database=new Pool({connectionString:env.DATABASE_URL,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});ownedPool=database;}
      const {betterAuth}=await loadAuth();
      return betterAuth(createAuthOptions({env,database}));
    })().catch(()=>{loading=undefined;throw new AuthServiceError();});
    return loading;
  }
  return {
    status(){return {configured:setup.configured,missing:[...setup.missing]};},
    async handler(request){
      if(!setup.configured)return failure('auth_not_configured','Die Studio-Anmeldung muss zuerst eingerichtet werden.',503,{missing:[...setup.missing]});
      const path=new URL(request.url).pathname;
      if(path==='/api/auth/sign-up/email')return failure('signup_disabled','Neue Teamkonten werden durch die Studio-Verwaltung angelegt.',403);
      if(!path.startsWith('/api/auth/'))return failure('not_found','Endpunkt nicht gefunden.',404);
      if(!['GET','POST'].includes(request.method))return failure('method_not_allowed','Methode nicht unterstützt.',405);
      if(request.method==='POST'&&request.headers.get('Origin')!==setup.origin)return failure('origin_rejected','Die Anfrage konnte nicht bestätigt werden.',403);
      try{return await clientResponse(await (await instance()).handler(request));}catch{return failure('auth_unavailable','Die Anmeldung ist gerade nicht verfügbar. Bitte später erneut versuchen.',503);}
    },
    async getUser(request){
      if(!setup.configured)throw new AuthServiceError('auth_not_configured','Die Studio-Anmeldung muss zuerst eingerichtet werden.');
      try{const result=await (await instance()).api.getSession({headers:request.headers});return publicUser(result?.user);}catch(error){if(error instanceof AuthServiceError)throw error;throw new AuthServiceError();}
    },
    async close(){if(ownedPool){await ownedPool.end();ownedPool=undefined;loading=undefined;}}
  };
}
/** CLI-only operation. The HTTP auth service never enables sign-up. */
export async function createStudioUser({env=process.env,pool,loadAuth=()=>import('better-auth'),email,name,password}={}){
  const setup=configuration(env);if(!setup.configured)throw new AuthServiceError('auth_not_configured','Fehlende Einrichtung: '+setup.missing.join(', '));
  if(typeof email!=='string'||email.length>320||!/^\S+@\S+\.\S+$/.test(email)||typeof name!=='string'||!name.trim()||name.length>120)throw new AuthServiceError('invalid_user','Bitte eine gültige E-Mail-Adresse und einen Namen angeben.',400);
  if(typeof password!=='string'||password.length<12||password.length>128)throw new AuthServiceError('invalid_password','Das Passwort muss 12 bis 128 Zeichen enthalten.',400);
  let database=pool,owned;
  try{
    if(!database){const {Pool}=await import('pg');database=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:10000});owned=database;}
    const {betterAuth}=await loadAuth();
    const auth=betterAuth(createAuthOptions({env,database,allowBootstrapSignup:true}));
    const result=await auth.api.signUpEmail({body:{email:email.trim().toLowerCase(),name:name.trim(),password}});
    const user=publicUser(result?.user);if(!user)throw new AuthServiceError('user_creation_failed','Das Teamkonto konnte nicht angelegt werden.');
    return user;
  }catch(error){if(error instanceof AuthServiceError)throw error;throw new AuthServiceError('user_creation_failed','Das Teamkonto konnte nicht angelegt werden. Prüfe Datenbankeinrichtung und bestehende Konten.');}
  finally{if(owned)await owned.end();}
}
