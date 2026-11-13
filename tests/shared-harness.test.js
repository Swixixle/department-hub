import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowed, denied, emailHidden, hasEmail, hasPhone, noPrivateSources, normalizeEmail, phoneHidden } from './shared/support.mjs';

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

test('email checks normalize case/whitespace and catch nested, encoded and header disclosures',()=>{
  const email='  Bex+test-run@EXAMPLE.INVALID  ';
  assert.equal(normalizeEmail(email),'bex+test-run@example.invalid');
  for(const result of [
    {text:'{"email":"  BEX+TEST-RUN@example.invalid  "}',headers:{}},
    {text:'{"sources":[{"contact":{"email":"bex+test-run@example.invalid"}}]}',headers:{}},
    {text:'{"contacts":{"BEX+TEST-RUN@EXAMPLE.INVALID":{"name":"Bex"}}}',headers:{}},
    {text:'{"answer":"Write to <Bex+test-run@Example.Invalid>"}',headers:{}},
    {text:'{"answer":"Write to Bex+test-run@Example.Invalid."}',headers:{}},
    {text:'{"href":"mailto%3ABEX%2BTEST-RUN%40EXAMPLE.INVALID"}',headers:{}},
    {text:'{"email":"\\u0042ex+test-run@example.invalid"}',headers:{}},
    {text:'{}',headers:{location:'mailto:BEX+TEST-RUN@EXAMPLE.INVALID'}},
    {text:'{}',headers:{location:'https://example.invalid/contact?email=BEX%2BTEST-RUN%40EXAMPLE.INVALID'}},
    {text:'{}',headers:{'x-contact':'%20bex%2Btest-run%40example.invalid%20'}}
  ]) { assert.ok(hasEmail(result,email)); assert.throws(()=>emailHidden(result,email)); }
  emailHidden({text:'{"email":null,"sources":[{"name":"Bex"}]}',headers:{}},email);
  assert.equal(hasEmail({text:'{"email":"somebody-else@example.invalid"}',headers:{}},email),false);
  for(const other of ['notbex+test-run@example.invalid','bex+test-run@example.invalid.evil'])
    assert.equal(hasEmail({text:JSON.stringify({email:other}),headers:{}},email),false);
});

test('unconfigured shared and candidate-email contracts fail explicitly instead of skipping or passing',()=>{
  const env={...process.env}; delete env.DEPARTMENT_HUB_TEST_FIXTURE;
  for(const args of [[],['--email-contact']]) {
    const result=spawnSync(process.execPath,['scripts/check-shared.mjs',...args],{env,encoding:'utf8'});
    assert.equal(result.status,2);
    assert.match(result.stderr,/shared (permission gate|email-contact candidate contract) has NOT passed/);
  }
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
    for(const args of [[],['--email-contact']]) {
      const before=requests;
      const child=spawn(process.execPath,['scripts/check-shared.mjs',...args],{env:{...process.env,DEPARTMENT_HUB_TEST_FIXTURE:path},stdio:['ignore','pipe','pipe']});
      let output=''; child.stdout.on('data',data=>{output+=data;}); child.stderr.on('data',data=>{output+=data;});
      const [status]=await once(child,'close');
      assert.equal(status,1,output);
      assert.ok(requests>before,'Each contract must reach the real HTTP boundary');
      assert.match(output,/A legitimate control must work/);
    }
  } finally { server.close(); await rm(root,{recursive:true,force:true}); }
});

test('a live server that hides every publicly shared email fails the candidate contract',async()=>{
  const root=await mkdtemp(join(tmpdir(),'department-hub-hidden-email-'));
  const fixture=JSON.parse(await readFile('tests/shared/fixture.example.json','utf8'));
  let directoryReads=0;
  // Deliberately broken test server, not an implementation or positive backend fixture.
  const server=createServer((req,res)=>{
    const session=Object.values(fixture.sessions).find(value=>value.headers.Authorization===req.headers.authorization);
    const contact=Object.values(fixture.contacts).find(value=>value.personId===session?.personId);
    let body;
    if(req.url==='/api/session' && session) body={personId:session.personId,departmentId:session.departmentId};
    else if(req.url.endsWith('/profile') && session) body={personId:session.personId,email:session.personId===fixture.sessions.keeper.personId?null:contact?.email,shareEmail:session.personId===fixture.sessions.member.personId};
    else if(req.url.endsWith('/directory') && session) {
      directoryReads++;
      body=session.departmentId===fixture.sessions.foreign.departmentId?[{personId:session.personId}]:Object.values(fixture.contacts).map(value=>({personId:value.personId,email:null}));
    } else { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(body));
  });
  try {
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    fixture.baseUrl='http://127.0.0.1:'+server.address().port;
    const path=join(root,'fixture.json'); await writeFile(path,JSON.stringify(fixture));
    const child=spawn(process.execPath,['scripts/check-shared.mjs','--email-contact'],{env:{...process.env,DEPARTMENT_HUB_TEST_FIXTURE:path},stdio:['ignore','pipe','pipe']});
    let output=''; child.stdout.on('data',data=>{output+=data;}); child.stderr.on('data',data=>{output+=data;});
    const [status]=await once(child,'close'); assert.equal(status,1,output);
    assert.ok(directoryReads>=2,'The candidate contract must actually exercise shared-email directory lookup');
    assert.match(output,/A legitimately shared email must actually appear/);
  } finally { server.close(); await rm(root,{recursive:true,force:true}); }
});
