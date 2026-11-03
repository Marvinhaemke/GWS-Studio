const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'};
export const securityHeaders = {
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self' https: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://ims-na1.adobelogin.com"
};
export function createApplication({frameio, assets}) {
  return async function application(request, env = {}) {
    const url = new URL(request.url);
    let response;
    try {
      if (url.pathname.startsWith('/api/frameio')) response = await frameio(request, env);
      else if (url.pathname.startsWith('/api/')) response = Response.json({error:{code:'NOT_FOUND',message:'Endpunkt nicht gefunden.'}},{status:404});
      else if (request.method !== 'GET' && request.method !== 'HEAD') response = new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
      else {
        const path = url.pathname === '/' ? '/index.html' : url.pathname;
        const content = assets[path];
        if (typeof content !== 'string') response = new Response('Not found',{status:404});
        else response = new Response(request.method==='HEAD'?null:content,{headers:{'Content-Type':MIME[path.slice(path.lastIndexOf('.'))]||'application/octet-stream','Cache-Control':'no-store'}});
      }
      if (!response) response = new Response('Not found',{status:404});
    } catch {
      response = Response.json({error:{code:'SERVER_ERROR',message:'Die Anfrage konnte nicht verarbeitet werden. Bitte erneut laden.'}},{status:500});
    }
    const headers = new Headers(response.headers);
    for (const [key,value] of Object.entries(securityHeaders)) headers.set(key,value);
    if (url.pathname.startsWith('/api/')) { headers.set('Cache-Control','private, no-store'); headers.set('Pragma','no-cache'); }
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  };
}
