import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const built = await build({ entryPoints: ['electron/business-media.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { DeepTutorBusinessMedia } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

test('media uses only four closed public Jobs and preserves task controls', async () => {
  const media = new DeepTutorBusinessMedia(); const calls = [];
  const services = { aiConfig: { listOptions: async () => ({kind:"preset-voices",options:[{voiceId:"selected-preset",name:"Selected"}]}) }, ai: { scenarioJobs: { submit: async (spec, options) => {
    calls.push({spec,options}); return {job:{jobId:'job',scenarioType:spec.type,status:'submitted',artifacts:[]}};
  } } } };
  await media.request('media.submit', {requestId:'speech',type:'speech-synthesize',parameters:{text:'中文朗读',voice:'selected-preset',format:'wav'}},services,()=>{});
  await media.request('media.submit', {requestId:'image',type:'image-generate',parameters:{prompt:'学习插图',size:'',quality:'',style:'',n:3}},services,()=>{});
  await media.request('media.submit', {requestId:'video',type:'video-generate',parameters:{prompt:'运动轨迹',ratio:'16:9',durationSec:5,resolution:'720p'}},services,()=>{});
  assert.equal(calls[0].spec.voiceRef.id,'selected-preset'); assert.equal(calls[0].spec.text,'中文朗读');
  assert.equal(calls[1].spec.n,3); assert.equal(calls[1].spec.size,'');
  assert.equal(calls[2].spec.mode,'t2v'); assert.equal(calls[2].spec.options.durationSec,5); assert.equal(calls[2].spec.options.ratio,'16:9');
  assert.deepEqual(calls.map(c=>c.options.clientSubmissionId),['speech','image','video']);
  await assert.rejects(media.request('media.submit',{requestId:'missing-voice',type:'speech-synthesize',parameters:{text:'hello',voice:'',format:''}},services,()=>{}),/Choose a voice/);
  assert.equal(calls.length,3);
  await assert.rejects(media.request('media.submit',{requestId:'bad',type:'voice-create',parameters:{}},services,()=>{}),/Unsupported/);
  await assert.rejects(media.request('media.submit',{requestId:'bad',type:'image-generate',parameters:{prompt:'x',n:1,provider:'private'}},services,()=>{}),/Invalid/);
});

test('audio larger than a pipe frame reaches the SDK unchanged and out-of-order chunks fail', async () => {
  const media = new DeepTutorBusinessMedia(); const bytes=Buffer.alloc(2*1024*1024+17,137);
  let received;
  const services={ai:{scenarioJobs:{submit:async spec=>{received=spec;return {job:{scenarioType:spec.type,status:'submitted',artifacts:[]}};}}}};
  const {id}=await media.request('media.audio.begin',{sizeBytes:bytes.length},services,()=>{});
  await assert.rejects(media.request('media.audio.chunk',{id,offset:1,bytes:'YQ=='},services,()=>{}),/Invalid/);
  for(let offset=0;offset<bytes.length;offset+=512*1024) await media.request('media.audio.chunk',{id,offset,bytes:bytes.subarray(offset,offset+512*1024).toString('base64')},services,()=>{});
  await media.request('media.submit',{requestId:'transcription',type:'speech-transcribe',audioId:id,parameters:{mimeType:'audio/wav',language:'zh',timestamps:true}},services,()=>{});
  assert.deepEqual(received.audioSource.bytes,bytes);assert.equal(received.timestamps,true);assert.equal(received.mimeType,'audio/wav');
  await assert.rejects(media.request('media.submit',{requestId:'again',type:'speech-transcribe',audioId:id,parameters:{mimeType:'audio/wav',timestamps:false}},services,()=>{}),/Incomplete/);
});

test('completed artifact bytes round-trip in bounded chunks, and invalidation retires uploads', async()=>{
  const media=new DeepTutorBusinessMedia();const bytes=Buffer.alloc(2*1024*1024+39,211);let reads=0;
  const services={ai:{scenarioJobs:{get:async()=>({job:{status:'completed',artifacts:[{artifactId:'artifact'}]}})},artifacts:{read:async()=>{reads++;return {bytes,mimeType:'video/mp4'};}}}};
  const parts=[];for(let offset=0;offset<bytes.length;offset+=512*1024){
    const result=await media.request('media.artifact',{jobId:'job',artifactId:'artifact',offset},services,()=>{});
    assert.equal(result.sizeBytes,bytes.length);assert.equal(result.offset,offset);parts.push(Buffer.from(result.bytes,'base64'));
  }
  assert.deepEqual(Buffer.concat(parts),bytes);assert.equal(reads,1);
  const {id}=await media.request('media.audio.begin',{sizeBytes:1},services,()=>{});media.clear();
  await assert.rejects(media.request('media.audio.chunk',{id,offset:0,bytes:'YQ=='},services,()=>{}),/Invalid/);
  await assert.rejects(media.request('media.artifact',{jobId:'job',artifactId:'foreign',offset:0},services,()=>{}),/not a completed/);
});
