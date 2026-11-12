import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowed, denied, hasPhone, noPrivateSources, phoneHidden } from './shared/support.mjs';

test('permission assertions reject deny-everything controls, successful leaks, redirects and server errors',()=>{
  assert.throws(()=>allowed({status:403,text:''},'seeded record'));
  assert.throws(()=>allowed({status:200,text:'empty'},'seeded record'));
  for(const status of [200,302,500]) assert.throws(()=>denied({status,text:'',headers:{}}));
  assert.throws(()=>denied({status:403,text:'private marker',headers:{}},['private marker']));
  assert.throws(()=>denied({status:403,text:'',headers:{location:'/private marker'}},['private marker']));
  denied({status:404,text:'Not found',headers:{}},['private marker']);
});

test('search and Ask source checks reject hidden restricted references',()=>{
  const hidden=[{kind:'fairness',id:'test-person'}];
  assert.throws(()=>noPrivateSources({status:200,text:JSON.stringify({sources:hidden})},hidden));
  assert.throws(()=>noPrivateSources({status:200,text:'{}'},hidden));
  noPrivateSources({status:200,text:JSON.stringify({sources:[{kind:'post',id:'public-test'}]})},hidden);
});

test('phone checks catch formatted, encoded and header disclosures while allowing redacted fields',()=>{
  const phone='3175550102';
  for(const result of [
    {text:'{"phone":"3175550102"}',headers:{}},
    {text:'{"answer":"Call (317) 555-0102"}',headers:{}},
    {text:'{"href":"tel%3A3175550102"}',headers:{}},
    {text:'{"phone":"\\u0033175550102"}',headers:{}},
    {text:'{}',headers:{location:'tel:317-555-0102'}}
  ]) { assert.ok(hasPhone(result,phone)); assert.throws(()=>phoneHidden(result,phone)); }
  phoneHidden({text:'{"personId":"test-bex","phone":null}',headers:{}},phone);
});

test('the unconfigured shared gate fails explicitly instead of skipping or passing',()=>{
  const env={...process.env}; delete env.DEPARTMENT_HUB_TEST_FIXTURE;
  const result=spawnSync(process.execPath,['scripts/check-shared.mjs'],{env,encoding:'utf8'});
  assert.equal(result.status,2);
  assert.match(result.stderr,/shared permission gate has NOT passed/);
});

test('a live HTTP server that denies everybody cannot satisfy the shared contract',async()=>{
  const root=await mkdtemp(join(tmpdir(),'department-hub-deny-all-'));
  let requests=0;
  const server=createServer((req,res)=>{requests++;res.writeHead(403,{'Content-Type':'application/json'});res.end('{"error":"Forbidden"}');});
  try {
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    const fixture=JSON.parse(await readFile('tests/shared/fixture.example.json','utf8'));
    fixture.baseUrl='http://127.0.0.1:'+server.address().port;
    const path=join(root,'fixture.json'); await writeFile(path,JSON.stringify(fixture));
    const child=spawn(process.execPath,['scripts/check-shared.mjs'],{env:{...process.env,DEPARTMENT_HUB_TEST_FIXTURE:path},stdio:['ignore','pipe','pipe']});
    let output=''; child.stdout.on('data',data=>{output+=data;}); child.stderr.on('data',data=>{output+=data;});
    const [status]=await once(child,'close');
    assert.equal(status,1,output);
    assert.ok(requests>0,'The contract must reach the real HTTP boundary');
    assert.match(output,/A legitimate control must work/);
  } finally { server.close(); await rm(root,{recursive:true,force:true}); }
});
