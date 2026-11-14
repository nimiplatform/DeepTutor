// No credentials, cached product data or global caller ID. The actual requesting document owns each request.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||!/^\/(api|files)\//.test(url.pathname))return;
  // The official identity/SDP coordination remains owned by the App Tools proxy.
  if(/^\/api\/(?:runtime-access\/|auth\/runtime-clients\/)/.test(url.pathname))return;
  event.respondWith((async()=>{
    const client=event.clientId?await self.clients.get(event.clientId):null;
    // Download navigations without a verified initiating document cannot inherit another tab's account.
    if(!client || new URL(client.url).origin !== self.location.origin)return new Response('Open this result from the connected DeepTutor workspace.',{status:403});
    const channel=new MessageChannel();let controller,headersResolve,headersReject,ended=false;
    const headers=new Promise((resolve,reject)=>{headersResolve=resolve;headersReject=reject;});
    const stream=new ReadableStream({start(value){controller=value;},pull(){channel.port1.postMessage({type:'pull'});},cancel(){ended=true;channel.port1.postMessage({type:'cancel'});}});
    channel.port1.onmessage=message=>{const data=message.data;if(ended)return;if(data.type==='headers')headersResolve(data);else if(data.type==='data')controller.enqueue(new Uint8Array(data.bytes));else if(data.type==='end'){ended=true;controller.close();channel.port1.close();}else if(data.type==='error'){ended=true;const error=new Error(data.error);headersReject(error);controller.error(error);channel.port1.close();}};
    event.request.signal.addEventListener('abort',()=>{channel.port1.postMessage({type:'cancel'});},{once:true});
    const body=event.request.method==='GET'||event.request.method==='HEAD'?undefined:await event.request.arrayBuffer();
    const allowedHeaders={};for(const name of ['content-type','range']){const value=event.request.headers.get(name);if(value)allowedHeaders[name]=value;}
    client.postMessage({type:'deeptutor-business-fetch',path:url.pathname+url.search,method:event.request.method,headers:allowedHeaders,body},[channel.port2,...(body?[body]:[])]);
    try{const response=await headers;return new Response([204,205,304].includes(response.status)?null:stream,{status:response.status,headers:response.headers});}
    catch(error){return new Response(JSON.stringify({detail:String(error)}),{status:503,headers:{'content-type':'application/json'}});}
  })());
});
