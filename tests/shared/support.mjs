import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export function loadFixture(path) {
  assert.ok(path,'A synthetic backend fixture manifest is required');
  const fixture = JSON.parse(readFileSync(path,'utf8'));
  assert.equal(fixture.version,1);
  assert.equal(fixture.synthetic,true);
  assert.match(fixture.runId,/^test-[a-zA-Z0-9-]+$/);
  assert.ok(['http:','https:'].includes(new URL(fixture.baseUrl).protocol));
  for (const name of ['member','partner','outsider','keeper','admin','foreign','revocable','revocableSecond']) {
    const session = fixture.sessions[name];
    assert.ok(session.personId && session.membershipId && session.departmentId,name);
    assert.ok(Object.keys(session.headers).length,name+' needs actual test session credentials');
    assert.ok(Object.keys(session.headers).every(key=>/^(authorization|cookie)$/i.test(key)),name+' must authenticate, not supply a trusted person/role header');
  }
  for (const name of ['post','document','file','privateFile','conversation','foreignPost','foreignDocument','foreignFile']) {
    assert.ok(fixture.records[name]?.id && fixture.records[name]?.marker,name);
    assert.ok(fixture.records[name].marker.includes(fixture.runId),'Fresh fixture markers must include the run ID');
  }
  assert.notEqual(fixture.sessions.member.departmentId,fixture.sessions.foreign.departmentId);
  assert.equal(new Set(['member','partner','outsider','keeper','admin','foreign','revocable'].map(name=>fixture.sessions[name].personId)).size,7);
  assert.ok(fixture.records.conversation.exchangeId,'Seed a real pending exchange linked to the conversation');
  assert.equal(fixture.sessions.revocable.personId,fixture.sessions.revocableSecond.personId);
  assert.equal(fixture.sessions.revocable.membershipId,fixture.sessions.revocableSecond.membershipId);
  for(const name of ['member','partner','outsider','keeper','admin','revocable','revocableSecond']) assert.equal(fixture.sessions[name].departmentId,fixture.sessions.member.departmentId);
  assert.ok(Number.isInteger(fixture.fairness.memberWeekendTurns) && Number.isInteger(fixture.fairness.partnerWeekendTurns));
  for(const [name,session] of [['shared','member'],['private','partner'],['defaultPrivate','outsider'],['newPrivate','keeper']]) {
    const contact=fixture.contacts[name];
    assert.equal(contact.personId,fixture.sessions[session].personId);
    assert.ok(contact.name,name+' requires a fixture display name');
    assert.match(contact.phone,/^\d{3}55501\d{2}$/,name+' must use fictional 555-01xx numbers');
  }
  assert.equal(new Set(Object.values(fixture.contacts).map(contact=>contact.phone)).size,4);
  return fixture;
}

export function client(fixture) {
  return async (session,path,{method='GET',body,headers={}}={}) => {
    const response = await fetch(new URL(path,fixture.baseUrl), {method,redirect:'manual',signal:AbortSignal.timeout(10000),
      headers:{...session?.headers,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,text:await response.text(),headers:Object.fromEntries(response.headers)};
  };
}

export function allowed(result,marker) {
  assert.equal(result.status,200,'A legitimate control must work; denying everybody cannot pass');
  if (marker) assert.ok(result.text.includes(marker),'The control must retrieve the actual seeded record');
}

export function denied(result,needles=[]) {
  assert.ok([401,403,404].includes(result.status),'Denied requests require 401/403/404, not success, redirects or server errors; got '+result.status);
  const visible=result.text+JSON.stringify(result.headers);
  for(const needle of needles) assert.equal(visible.includes(needle),false,'A denied response leaked protected content');
}

export function noPrivateSources(result,restricted) {
  allowed(result);
  const body=JSON.parse(result.text);
  const sources=Array.isArray(body)?body:body.sources;
  assert.ok(Array.isArray(sources),'Search and Ask must identify their returned sources');
  for(const source of sources) {
    assert.ok(source.kind && source.id,'Each source needs kind and id');
    assert.ok(['post','document','file','conversation','fairness','schedule','person'].includes(source.kind),'New source kinds require an explicit permission-contract update');
    assert.ok(!restricted.some(item=>item.kind===source.kind && item.id===source.id),'A restricted record reached search or Ask');
  }
}

function visibleValues(result) {
  const values=Object.values(result.headers||{});
  const visit=value=>{
    if(typeof value==='string' || typeof value==='number') values.push(String(value));
    else if(Array.isArray(value)) value.forEach(visit);
    else if(value && typeof value==='object') Object.values(value).forEach(visit);
  };
  try { visit(JSON.parse(result.text)); } catch { values.push(result.text); }
  return values.flatMap(value=>{
    try { return [value,decodeURIComponent(value)]; } catch { return [value]; }
  });
}

export function hasPhone(result,phone) {
  return visibleValues(result).some(value=>value.replace(/\D/g,'').includes(phone));
}

export function phoneHidden(result,phone) {
  assert.equal(hasPhone(result,phone),false,'An unshared phone number appeared in content or headers');
}
