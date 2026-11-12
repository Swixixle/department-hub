import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, route } from './harness.mjs';

test('HTTP Ask per-person counts are available to the custodian and denied to ordinary members/admins',async()=>{
  const h=await boot();
  try {
    const path=route(h.s.member.departmentId,'ask');
    const body={question:'How many weekend shifts has each person worked?'};
    const control=await h.request(h.s.keeper,path,{method:'POST',body});
    assert.equal(control.status,200);
    assert.ok(control.json.items.length>1,'A legitimate custodian must receive actual named counts');
    for(const viewer of [h.s.member,h.s.partner,h.s.outsider,h.s.admin]) {
      const result=await h.request(viewer,path,{method:'POST',body});
      assert.equal(result.status,200);
      assert.match(result.json.title,/kept by whoever keeps the record/);
      assert.deepEqual(result.json.items,[]);
      assert.deepEqual(result.json.sources,[]);
    }
  } finally {h.stop();}
});

test('HTTP threshold answers require the custodian in both directions',async()=>{
  const h=await boot();
  try {
    const path=route(h.s.member.departmentId,'ask');
    const question='Who has more shifts than Arden?';
    const control=await h.request(h.s.keeper,path,{method:'POST',body:{question}});
    assert.equal(control.status,200);
    assert.match(control.json.understood,/Everybody with more shifts than Arden/);
    assert.ok(control.json.items.some(row=>/^Arden: \d+ shifts?/.test(row.text)));
    for(const viewer of [h.s.member,h.s.partner,h.s.outsider,h.s.admin]) {
      for(const body of [{question},{question:'Who has fewer shifts than Bexley?'}]) {
        const result=await h.request(viewer,path,{method:'POST',body});
        assert.equal(result.status,200);
        assert.match(result.json.title,/kept by whoever keeps the record/);
        assert.deepEqual(result.json.items,[]);
        assert.deepEqual(result.json.sources,[]);
      }
    }
  } finally {h.stop();}
});
