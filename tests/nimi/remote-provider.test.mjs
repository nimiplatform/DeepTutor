import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { tsImport } from 'tsx/esm/api';
const { DeepTutorWebProvider } = await tsImport('../../electron/remote-provider.ts', import.meta.url);

async function harness(t) {
  const requests=[];
  const socketMessages=[], socketCookies=[];
  const server=createServer(async(req,res)=>{
    const chunks=[]; for await(const chunk of req)chunks.push(chunk);
    requests.push({path:req.url,cookie:req.headers.cookie,body:Buffer.concat(chunks)});
    if(req.url==='/api/auth/login'){res.setHeader('set-cookie','dt_token=business-session; HttpOnly; SameSite=Strict');res.end('{"ok":true}');return;}
    res.setHeader('content-type','application/octet-stream');res.end(Buffer.concat(chunks).length?Buffer.concat(chunks):Buffer.from('学习记录 · original'));
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    if (request.url.includes('refuse=1')) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    socketCookies.push(request.headers.cookie);
    sockets.handleUpgrade(request, socket, head, connection => {
      connection.on('message', data => { socketMessages.push(data.toString()); connection.send(JSON.stringify({ type: 'received', bytes: data.length })); });
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const root=await mkdtemp(join(tmpdir(),'deeptutor-provider-test-'));
  const provider=new DeepTutorWebProvider({integration:{registerProvider:async()=>{},pollProvider:()=>new Promise(()=>{})},aiConfig:{get:async()=>({config:null,revision:'1',effectiveSelections:[]})}},
    {ready:true,socket:(path,cookie)=>new WebSocket(origin.replace('http:','ws:')+path,{headers:cookie?{cookie:`dt_token=${cookie}`}:{}}),request:(path,init,cookie)=>fetch(origin+path,{...init,headers:{...init.headers,...(cookie?{cookie:`dt_token=${cookie}`}:{})}})},root);
  t.after(async()=>{await provider.close();await new Promise(resolve=>server.close(resolve));assert.deepEqual(await readdir(root),[]);await rmdir(root);});
  const open=async(owner)=>(await provider.dispatch(owner,'workspace.open',{})).id;
  const result=async(owner,sessionId,id)=>{
    let offset=0,bytes=[];
    for(let count=0;count<200;count++){
      const value=await provider.dispatch(owner,'request.read',{sessionId,id,offset});
      assert.notEqual(value.state,'failed',value.error);
      if(value.data){const chunk=Buffer.from(value.data,'base64');bytes.push(chunk);offset+=chunk.length;assert.equal(value.nextOffset,offset);continue;}
      if(value.state==='completed')return {body:Buffer.concat(bytes),headers:value.headers};
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    throw new Error('Test request did not complete');
  };
  const request=(owner,sessionId,id,route,operation='learning.read',bodyId)=>provider.dispatch(owner,operation,{sessionId,requestId:id,route,parameters:{},query:'',headers:{},...(bodyId?{bodyId}:{})});
  return {provider,requests,open,result,request,socketMessages,socketCookies};
}
test('consumer and business-session isolation protect transferred bodies and response records',async(t)=>{
  const h=await harness(t),a=await h.open('caller-a'),b=await h.open('caller-b');
  const upload=await h.provider.dispatch('caller-a','upload',{sessionId:a,action:'begin',size:3});
  await assert.rejects(h.provider.dispatch('caller-b','upload',{sessionId:b,action:'append',id:upload.id,offset:0,data:'YWJj'}),/Unknown/);
  await assert.rejects(h.provider.dispatch('caller-b','upload',{sessionId:a,action:'append',id:upload.id,offset:0,data:'YWJj'}),/session ended/);
  const id=randomUUID();await h.request('caller-a',a,id,'GET /api/sessions');await h.result('caller-a',a,id);
  assert.equal((await h.provider.dispatch('caller-b','request.read',{sessionId:b,id,offset:0})).state,'unknown');
});
test('ordered upload and response chunks preserve real Unicode bytes and never repeat a submitted request',async(t)=>{
  const h=await harness(t),session=await h.open('caller');const bytes=Buffer.from('雨后学习笔记\n'.repeat(35000));
  const {id:bodyId}=await h.provider.dispatch('caller','upload',{sessionId:session,action:'begin',size:bytes.length});
  for(let offset=0;offset<bytes.length;offset+=65536)await h.provider.dispatch('caller','upload',{sessionId:session,action:'append',id:bodyId,offset,data:bytes.subarray(offset,offset+65536).toString('base64')});
  await h.provider.dispatch('caller','upload',{sessionId:session,action:'finish',id:bodyId});
  const id=randomUUID();await h.request('caller',session,id,'POST /api/books','learning.write',bodyId);
  const response=await h.result('caller',session,id);assert.deepEqual(response.body,bytes);
  await assert.rejects(h.request('caller',session,id,'POST /api/books','learning.write'),/original request/);
  assert.equal(h.requests.length,1);
});
test('optional DeepTutor business login cookie stays in its own PC logical session',async(t)=>{
  const h=await harness(t),a=await h.open('caller'),b=await h.open('caller');
  const login=randomUUID();await h.request('caller',a,login,'POST /api/auth/login','accounts.write');
  const loggedIn=await h.result('caller',a,login);assert.equal(loggedIn.headers['set-cookie'],undefined);assert.equal(loggedIn.body.toString(),'{"ok":true}');
  const first=randomUUID();await h.request('caller',a,first,'GET /api/sessions');await h.result('caller',a,first);
  const second=randomUUID();await h.request('caller',b,second,'GET /api/sessions');await h.result('caller',b,second);
  assert.equal(h.requests[1].cookie,'dt_token=business-session');assert.equal(h.requests[2].cookie,undefined);
  await h.provider.dispatch('caller','workspace.close',{id:a});
  await assert.rejects(h.request('caller',a,randomUUID(),'GET /api/sessions'),/session ended/);
  assert.equal(h.requests.length,3);
});


test('a large image-grading payload crosses ordered uploads and reaches the real WebSocket once',async(t)=>{
  const h=await harness(t),session=await h.open('learner'),socketId=randomUUID();
  await h.provider.dispatch('learner','socket.open',{sessionId:session,id:socketId,path:'/ws/questions/judge'});
  const original=JSON.stringify({question:'解释图片中的解题过程',user_answer:'请逐步检查',user_answer_images:[{base64:Buffer.alloc(700*1024,165).toString('base64'),url:null,filename:'answer.png',mime_type:'image/png'}],language:'zh'});
  const bytes=Buffer.from(original);
  assert.ok(bytes.length>128*1024);
  const {id:uploadId}=await h.provider.dispatch('learner','upload',{sessionId:session,action:'begin',size:bytes.length});
  for(let offset=0;offset<bytes.length;offset+=65536)await h.provider.dispatch('learner','upload',{sessionId:session,action:'append',id:uploadId,offset,data:bytes.subarray(offset,offset+65536).toString('base64')});
  await h.provider.dispatch('learner','upload',{sessionId:session,action:'finish',id:uploadId});
  assert.deepEqual(await h.provider.dispatch('learner','socket.send',{sessionId:session,id:socketId,sequence:0,uploadId}),{sequence:1});
  for(let i=0;i<100&&!h.socketMessages.length;i++)await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(h.socketMessages,[original]);
  await assert.rejects(h.provider.dispatch('learner','socket.send',{sessionId:session,id:socketId,sequence:0,uploadId}),/sequence/);
  await assert.rejects(h.provider.dispatch('learner','upload',{sessionId:session,action:'release',id:uploadId}),/Unknown/);
  assert.equal(h.socketMessages.length,1);
  // Server receipt and client receipt are separate socket events. Poll the
  // public read sequence until the actual echo arrives, as the consumer does.
  let readSequence=0,echoReceived=false;
  for(let i=0;i<100&&!echoReceived;i++){
    const events=await h.provider.dispatch('learner','socket.read',{sessionId:session,id:socketId,sequence:readSequence});
    readSequence=events.sequence;
    echoReceived=events.messages.some(message=>JSON.parse(message).bytes===bytes.length);
    if(!echoReceived)await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.ok(echoReceived);
  await h.provider.dispatch('learner','socket.close',{sessionId:session,id:socketId});
  assert.equal(h.socketMessages.length,1,'transport close does not invent a durable-turn cancel message');
});

test('uploaded WebSocket payloads retain both consumer and logical-session ownership',async(t)=>{
  const h=await harness(t),a=await h.open('same-owner'),b=await h.open('same-owner');
  const {id:uploadId}=await h.provider.dispatch('same-owner','upload',{sessionId:a,action:'begin',size:2});
  await h.provider.dispatch('same-owner','upload',{sessionId:a,action:'append',id:uploadId,offset:0,data:'e30='});
  await h.provider.dispatch('same-owner','upload',{sessionId:a,action:'finish',id:uploadId});
  const socketId=randomUUID();await h.provider.dispatch('same-owner','socket.open',{sessionId:b,id:socketId,path:'/ws'});
  await assert.rejects(h.provider.dispatch('same-owner','socket.send',{sessionId:b,id:socketId,sequence:0,uploadId}),/Unknown/);
  assert.equal(h.socketMessages.length,0);
  await h.provider.dispatch('same-owner','socket.close',{sessionId:b,id:socketId});
});

test('refused WebSocket handshakes release capacity and unknown endpoints never connect',async(t)=>{
  const h=await harness(t),session=await h.open('learner');
  await assert.rejects(h.provider.dispatch('learner','socket.open',{sessionId:session,id:randomUUID(),path:'https://other.invalid/ws'}),/Unknown/);
  await assert.rejects(h.provider.dispatch('learner','socket.open',{sessionId:session,id:randomUUID(),path:'/api/private'}),/Unknown/);
  for(let i=0;i<18;i++)await assert.rejects(h.provider.dispatch('learner','socket.open',{sessionId:session,id:randomUUID(),path:'/ws?refuse=1'}),/unavailable/);
  const id=randomUUID();await h.provider.dispatch('learner','socket.open',{sessionId:session,id,path:'/ws'});
  await h.provider.dispatch('learner','socket.close',{sessionId:session,id});
  assert.equal(h.socketCookies.length,1);
});


test('the Web learning socket stages a large image command and sends the original data once',async(t)=>{
  const h=await harness(t),sessionId=await h.open('browser-learner'),calls=[];
  const previousLocation=globalThis.location,previousCall=globalThis.__deepTutorTestCall;
  globalThis.location={href:'https://deeptutor.test/',host:'deeptutor.test'};
  globalThis.__deepTutorTestCall=(operation,input)=>{calls.push({operation,input});return h.provider.dispatch('browser-learner',operation,{...input,sessionId});};
  t.after(()=>{if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;if(previousCall===undefined)delete globalThis.__deepTutorTestCall;else globalThis.__deepTutorTestCall=previousCall;});
  const built=await build({entryPoints:['web/lib/nimi/web-socket.ts'],bundle:true,platform:'browser',format:'esm',write:false,plugins:[{name:'public-business-port',setup(builder){
    builder.onResolve({filter:/^\.\/web-connection$/},()=>({path:'business-port',namespace:'test-port'}));
    builder.onLoad({filter:/.*/,namespace:'test-port'},()=>({contents:'export const isWebWorkspace=true; export const webBusinessCall=(operation,input)=>globalThis.__deepTutorTestCall(operation,input);'}));
  }}]});
  const {createLearningSocket}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
  const socket=createLearningSocket('wss://deeptutor.test/ws/questions/judge');
  const opened=new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(new Error('Socket did not open')),{once:true});});
  await opened;
  const original=JSON.stringify({question:'图片批改',user_answer_images:[{base64:Buffer.alloc(240*1024,137).toString('base64'),filename:'解答.png',mime_type:'image/png'}]});
  const received=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('No real WS acknowledgement')),4000);socket.addEventListener('message',()=>{clearTimeout(timer);resolve();},{once:true});});
  socket.send(original);await received;
  assert.deepEqual(h.socketMessages,[original]);
  const sent=calls.filter(call=>call.operation==='socket.send');assert.equal(sent.length,1);assert.equal(typeof sent[0].input.uploadId,'string');assert.equal(sent[0].input.data,undefined);
  assert.ok(calls.filter(call=>call.operation==='upload'&&call.input.action==='append').length>1);
  assert.ok(calls.every(call=>Buffer.byteLength(JSON.stringify({...call.input,sessionId}))<256*1024));
  socket.close();
});
