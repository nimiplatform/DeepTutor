import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const built=await build({entryPoints:['web/lib/recording-wav.ts'],bundle:true,platform:'browser',format:'esm',write:false});
const {encodeMonoWav}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('prepared recording preserves PCM samples with the declared WAV sample rate',async()=>{
 const blob=encodeMonoWav(new Float32Array([-1,0,0.5,1]),24000);
 const bytes=await blob.arrayBuffer();const view=new DataView(bytes);
 assert.equal(blob.type,'audio/wav');assert.equal(bytes.byteLength,52);
 assert.equal(view.getUint16(20,true),1);assert.equal(view.getUint16(22,true),1);
 assert.equal(view.getUint32(24,true),24000);assert.equal(view.getUint32(40,true),8);
 assert.deepEqual([44,46,48,50].map(offset=>view.getInt16(offset,true)),[-32768,0,16384,32767]);
});
