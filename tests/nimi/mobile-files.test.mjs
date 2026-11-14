import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tsImport } from 'tsx/esm/api';
const { IdentityFiles } = await tsImport('../../web/components/nimi/identity-files.ts', import.meta.url);

test('picker files survive Runtime ending and require an explicit current-document handoff',()=>{
  const identity=new AbortController(),old=new AbortController(),current=new AbortController();
  const files=new IdentityFiles(identity.signal,()=>{}),oldMessages=[],messages=[];
  files.bind('workspace-a');files.request('old',old.signal,value=>oldMessages.push(value));old.abort();
  const selected=new File(['original study notes'],'notes.txt');files.selected([selected]);files.deliver();
  assert.deepEqual(oldMessages,[]);assert.equal(files.canDeliver(),false);assert.equal(files.files[0],selected);
  files.request('current',current.signal,value=>messages.push(value));assert.deepEqual(messages,[]);
  files.deliver();assert.equal(messages[0].files[0],selected);assert.equal(files.delivering,true);
  files.accepted('current');assert.deepEqual(files.files,[]);assert.equal(files.delivering,false);
});

test('a detached upload control keeps the file; an interrupted handoff is not silently replayed',()=>{
  const identity=new AbortController(),scope=new AbortController();
  const files=new IdentityFiles(identity.signal,()=>{});files.bind('workspace-a');
  files.selected([new File(['private'],'source.txt')]);files.request('closed-control',scope.signal,()=>{});files.deliver();
  files.accepted('closed-control','Reopen upload');assert.equal(files.files.length,1);assert.equal(files.canDeliver(),false);
  files.request('another',scope.signal,()=>{});files.deliver();scope.abort();
  assert.equal(files.files.length,1);assert.equal(files.canDeliver(),false);assert.match(files.notice,/Check the original PC task/);
});

test('identity and workspace replacement discard drafts and pending files',()=>{
  const identity=new AbortController(),scope=new AbortController();const files=new IdentityFiles(identity.signal,()=>{});
  files.bind('a');files.drafts['chat:new']={text:'unsent'};files.selected([new File(['a'],'a.txt')]);
  files.request('a',scope.signal,()=>assert.fail('old recipient'));files.bind('b');files.deliver();
  assert.deepEqual(files.files,[]);assert.deepEqual(files.drafts,{});
  files.selected([new File(['b'],'b.txt')]);files.drafts['chat:new']={text:'second'};identity.abort();
  assert.deepEqual(files.files,[]);assert.deepEqual(files.drafts,{});
});
