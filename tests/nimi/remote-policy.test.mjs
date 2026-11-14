import assert from 'node:assert/strict';
import { test } from 'node:test';
import { businessRoutes, resolveBusinessRoute } from '../../electron/remote-policy.ts';

test('remote learning routes retain the backend contract without admitting PC setup', () => {
  assert.ok(businessRoutes.some(route => route.id === 'GET /api/sessions'));
  assert.ok(businessRoutes.some(route => route.id === 'POST /api/auth/login'));
  assert.ok(!businessRoutes.some(route => route.id === 'POST /api/knowledge-bases/connect-folder'));
  assert.ok(!businessRoutes.some(route => route.id === 'PUT /api/settings/workspace'));
  assert.ok(!businessRoutes.some(route => route.id === 'POST /api/system/update'));
});

test('closed method/route selection refuses write authority through a read operation', () => {
  assert.throws(() => resolveBusinessRoute('learning.read', 'POST /api/books', {}, ''), /not exposed/);
  assert.throws(() => resolveBusinessRoute('preferences.write', 'POST /api/system/update', {}, ''), /not exposed/);
});

test('route parameters preserve ordinary Unicode and cannot navigate to another endpoint', () => {
  const route = businessRoutes.find(item => item.id === 'GET /api/knowledge-bases/{kb_name}/files/{filename}');
  assert.ok(route);
  assert.equal(resolveBusinessRoute(route.operation, route.id, { kb_name:'测试资料', filename:'chapter/样本.txt' }, 'download=true').path,
    '/api/knowledge-bases/%E6%B5%8B%E8%AF%95%E8%B5%84%E6%96%99/files/chapter%2F%E6%A0%B7%E6%9C%AC.txt?download=true');
  assert.throws(() => resolveBusinessRoute(route.operation, route.id, { kb_name:'safe', filename:'../../settings' }, ''), /Invalid route parameter/);
  assert.throws(() => resolveBusinessRoute(route.operation, route.id, { kb_name:'safe', filename:'x', extra:'y' }, ''), /route parameters/);
});

test('existing Nimi media actions use their declared read and explicit recovery routes', () => {
  assert.equal(resolveBusinessRoute('learning.read', 'GET /api/sessions/{session_id}/nimi-media',
    {session_id:'unified_original'}, '').path, '/api/sessions/unified_original/nimi-media');
  assert.equal(resolveBusinessRoute('learning.write', 'POST /api/sessions/{session_id}/nimi-media/{request_id}',
    {session_id:'unified_original',request_id:'original-job'}, 'cancel=false').path,
    '/api/sessions/unified_original/nimi-media/original-job?cancel=false');
  assert.throws(()=>resolveBusinessRoute('learning.read', 'POST /api/sessions/{session_id}/nimi-media/{request_id}',
    {session_id:'unified_original',request_id:'original-job'}, ''), /not exposed/);
});

test('the current backend projection preserves the closed file and PC-setup boundaries', () => {
  assert.equal(resolveBusinessRoute('documents.read', 'GET /files/library/{file_id}/download',
    {file_id:'original-file'}, '').path, '/files/library/original-file/download');
  assert.equal(resolveBusinessRoute('preferences.write', 'PUT /api/settings/nimi-speech-voice', {}, '').path,
    '/api/settings/nimi-speech-voice');
  assert.throws(()=>resolveBusinessRoute('documents.write', 'POST /files/library/{file_id}/restore',
    {file_id:'original-file'}, ''), /not exposed/);
  assert.throws(()=>resolveBusinessRoute('learning.read', 'DELETE /api/sessions/{session_id}/purge',
    {session_id:'original-session'}, ''), /not exposed/);
  assert.throws(()=>resolveBusinessRoute('preferences.write', 'PUT /api/settings/workspace', {}, ''), /not exposed/);
});
