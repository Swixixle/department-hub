import test from 'node:test';
import assert from 'node:assert/strict';
import { documentVersion, fileFingerprint, postVersion, sha256, verifyContent, verifyReceipts } from '../src/audit.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function chain(count=3) {
  const events=[];
  for (let i=0;i<count;i++) {
    const event={id:'event-'+i,time:'2026-11-11T11:00:00Z',type:'Test',previousHash:events.at(-1)?.hash||null,details:{index:i}};
    events.push({...event,hash:await sha256(JSON.stringify(event))});
  }
  return events;
}

test('SHA-256 matches a known vector and chain checks expose edits and missing middle entries', async () => {
  assert.equal(await sha256('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const events=await chain();
  assert.equal((await verifyReceipts(events)).ok,true);
  const changed=structuredClone(events); changed[1].details.index=99;
  assert.equal((await verifyReceipts(changed)).at,2);
  assert.equal((await verifyReceipts([events[0],events[2]])).ok,false);
});

test('tail deletion needs a separately retained full checkpoint and later entries are checked too', async () => {
  const events=await chain(), checkpoint=events.at(-1).hash;
  assert.equal((await verifyReceipts(events.slice(0,2))).ok,true);
  assert.equal((await verifyReceipts(events.slice(0,2),checkpoint)).ok,false);
  assert.equal((await verifyReceipts(events,checkpoint)).checkpoint,3);
  assert.equal((await verifyReceipts(events,checkpoint.slice(0,12))).ok,false);
  const changed=structuredClone(events); changed[2].type='Changed';
  assert.equal((await verifyReceipts(changed,events[0].hash)).ok,false);
  assert.equal((await verifyReceipts([],checkpoint)).ok,false);
});

test('build identity is hash-covered without changing a legacy receipt or its checkpoint', async () => {
  const events = await chain(1), checkpoint = events[0].hash, original = structuredClone(events[0]);
  const payload = { id:'new-build-event', time:'2026-11-11T12:00:00Z', type:'Rule change', previousHash:checkpoint,
    build:{version:14,fingerprint:'a'.repeat(64),mode:'production'}, details:{} };
  events.push({...payload,hash:await sha256(JSON.stringify(payload))});
  assert.equal((await verifyReceipts(events,checkpoint)).ok,true);
  assert.deepEqual(events[0],original);
  events[1].build.fingerprint = 'b'.repeat(64);
  assert.equal((await verifyReceipts(events,checkpoint)).at,2);
});

test('a full re-created chain cannot satisfy the previously saved checkpoint', async () => {
  const original=await chain(), replacement=await chain(4);
  replacement[0].details.index=400;
  for(let i=0;i<replacement.length;i++) {
    const {hash,...event}=replacement[i]; event.previousHash=replacement[i-1]?.hash||null;
    replacement[i]={...event,hash:await sha256(JSON.stringify(event))};
  }
  assert.equal((await verifyReceipts(replacement)).ok,true);
  assert.equal((await verifyReceipts(replacement,original.at(-1).hash)).ok,false);
});

test('chunk fingerprints cover middle bytes as well as file ends', async () => {
  const one=new Blob(['abcdefghijk']), two=new Blob(['abcdeXghijk']);
  const a=await fileFingerprint(one,{wholeLimit:4,chunkBytes:3}), b=await fileFingerprint(two,{wholeLimit:4,chunkBytes:3});
  assert.equal(a.method,'sha256-chunks-v1');
  assert.equal(a.chunks,4);
  assert.notEqual(a.sha256,b.sha256);
  assert.equal((await fileFingerprint(one)).sha256,await sha256(await one.arrayBuffer()));
  await assert.rejects(fileFingerprint(one,{chunkBytes:0}),/Invalid fingerprint/);
});

test('the standalone verifier checks exported receipts and rejects truncation against a checkpoint', async () => {
  const folder=await mkdtemp(join(tmpdir(),'department-hub-audit-'));
  try {
    const events=await chain(), path=join(folder,'export.json'), checkpoint=events.at(-1).hash;
    await writeFile(path,JSON.stringify({format:1,events}));
    const run=()=>spawnSync(process.execPath,['scripts/verify-receipts.mjs',path,checkpoint],{encoding:'utf8'});
    const valid=run();
    assert.equal(valid.status,0);
    assert.equal(JSON.parse(valid.stdout).checkpoint,3);
    await writeFile(path,JSON.stringify({format:1,events:events.slice(0,2)}));
    assert.equal(run().status,1);
    await writeFile(path,'not valid JSON with private marker');
    const invalid=run();
    assert.equal(invalid.status,2);
    assert.equal(invalid.stderr.includes('private marker'),false);
  } finally { await rm(folder,{recursive:true,force:true}); }
});

test('source versions include metadata and stored content can be checked against receipts', async () => {
  const doc={id:'d',title:'Test procedure',kind:'Procedure',effective:'2026-01-01',text:'Synthetic source text.'};
  assert.notEqual(await documentVersion(doc),await documentVersion({...doc,effective:'2027-01-01'}));
  const file=new Blob(['synthetic file']);
  const post={id:'p',author:'Jordan',created:'2026-11-11',body:'Synthetic post',media:[{id:'f',name:'demo.txt'}]};
  const events=[{type:'Document added',details:{id:'d',sha256:await sha256(doc.text),version:await documentVersion(doc)}},
    {type:'Board update',details:{id:'p',fingerprint:await sha256(post.body),postHash:await postVersion(post),files:[await fileFingerprint(file)]}}];
  const base={events,documents:[doc],posts:[post],file:async()=>file};
  assert.equal((await verifyContent(base)).checked,3);
  assert.equal((await verifyContent(base)).ok,true);
  assert.equal((await verifyContent({...base,documents:[{...doc,text:'Changed'}]})).ok,false);
  assert.equal((await verifyContent({...base,posts:[{...post,when:{kind:'due',date:'2027-01-01'}}]})).ok,false);
  assert.equal((await verifyContent({...base,file:async()=>new Blob(['changed'])})).ok,false);
  assert.equal((await verifyContent({...base,file:async()=>null})).unavailable.length,1);
  assert.equal((await verifyContent({...base,documents:[{...doc,id:'older'}]})).legacy.length,1);
});
