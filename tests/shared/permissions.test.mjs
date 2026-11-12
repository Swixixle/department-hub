// This is a real HTTP backend contract, intentionally outside the current local-app test glob.
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { allowed, client, denied, loadFixture, noPrivateSources } from './support.mjs';

const f=loadFixture(process.env.DEPARTMENT_HUB_TEST_FIXTURE), request=client(f), s=f.sessions, r=f.records;
const a=s.member.departmentId,b=s.foreign.departmentId;
const route=(dept,kind,id='')=>'/api/departments/'+encodeURIComponent(dept)+'/'+kind+(id?'/'+encodeURIComponent(id):'');
const foreignNeedles=[r.foreignPost.marker,r.foreignDocument.marker,r.foreignFile.marker];
const foreignSources=[{kind:'post',id:r.foreignPost.id},{kind:'document',id:r.foreignDocument.id},{kind:'file',id:r.foreignFile.id}];
const restricted=[{kind:'conversation',id:r.conversation.id},{kind:'file',id:r.privateFile.id},{kind:'fairness',id:s.partner.personId}];

describe('shared permission launch gate: real backend, synthetic records', {concurrency:false}, () => {
  before(async()=>{
    // Prove credentials, records and routes are live before accepting any negative result.
    for(const session of Object.values(s)) {
      const result=await request(session,'/api/session'); allowed(result);
      const identity=JSON.parse(result.text);
      assert.equal(identity.personId,session.personId); assert.equal(identity.departmentId,session.departmentId);
    }
    for(const [kind,record] of [['posts',r.post],['documents',r.document],['files',r.file]]) allowed(await request(s.member,route(a,kind,record.id)),record.marker);
    for(const [kind,record] of [['posts',r.foreignPost],['documents',r.foreignDocument],['files',r.foreignFile]]) allowed(await request(s.foreign,route(b,kind,record.id)),record.marker);
    allowed(await request(s.member,route(a,'conversations',r.conversation.id)),r.conversation.marker);
    allowed(await request(s.partner,route(a,'conversations',r.conversation.id)),r.conversation.marker);
    allowed(await request(s.member,route(a,'files',r.privateFile.id)),r.privateFile.marker);
    allowed(await request(s.partner,route(a,'files',r.privateFile.id)),r.privateFile.marker);
    allowed(await request(s.member,route(a,'directory')),s.member.personId);
    allowed(await request(s.member,route(a,'posts')),r.post.marker);
    allowed(await request(s.foreign,route(b,'fairness',s.foreign.personId)));
    for(const [viewer,subject,weekends] of [[s.member,s.member,f.fairness.memberWeekendTurns],[s.keeper,s.partner,f.fairness.partnerWeekendTurns]]) {
      const result=await request(viewer,route(a,'fairness',subject.personId)); allowed(result);
      const record=JSON.parse(result.text); assert.equal(record.personId,subject.personId); assert.equal(record.weekendTurns,weekends);
    }
    const exported=await request(s.keeper,route(a,'exports/fairness')); allowed(exported);
    assert.ok(JSON.parse(exported.text).people.some(person=>person.personId===s.partner.personId && person.weekendTurns===f.fairness.partnerWeekendTurns));
    allowed(await request(s.member,route(a,'exchanges',r.conversation.exchangeId)));
    const messageBody='fixture-signal private reply control '+f.runId;
    const reply=await request(s.member,route(a,'conversations',r.conversation.id)+'/messages',{method:'POST',body:{body:messageBody}});
    assert.equal(reply.status,201); assert.equal(JSON.parse(reply.text).authorId,s.member.personId);
    allowed(await request(s.partner,route(a,'conversations',r.conversation.id)),messageBody);
    // Exercise the real write routes too; unimplemented routes returning 404 must not pass the negative checks.
    const body='fixture-signal write control '+f.runId;
    const created=await request(s.member,route(a,'posts'),{method:'POST',body:{body}});
    assert.equal(created.status,201);
    const post=JSON.parse(created.text); assert.ok(post.id); assert.equal(post.authorId,s.member.personId); assert.equal(post.departmentId,a);
    allowed(await request(s.member,route(a,'posts',post.id)),body);
    allowed(await request(s.member,route(a,'posts',post.id),{method:'PATCH',body:{body:body+' edited'}}),body+' edited');
    const removed=await request(s.member,route(a,'posts',post.id),{method:'DELETE'}); assert.ok([200,204].includes(removed.status));
    assert.equal((await request(s.member,route(a,'posts',post.id))).status,404);
  });

  test('missing or invalid authentication cannot read a known record',async()=>{
    denied(await request(null,route(a,'posts',r.post.id)),[r.post.marker]);
    denied(await request({headers:{Authorization:'Bearer invalid-test-session'}},route(a,'posts',r.post.id)),[r.post.marker]);
  });

  test('department IDs and record IDs cannot cross read or download boundaries',async()=>{
    for(const [kind,record] of [['posts',r.foreignPost],['documents',r.foreignDocument],['files',r.foreignFile]]) {
      denied(await request(s.member,route(b,kind,record.id)),foreignNeedles);
      denied(await request(s.member,route(a,kind,record.id)),foreignNeedles);
    }
    denied(await request(s.member,route(b,'posts')),foreignNeedles);
    denied(await request(s.member,route(b,'directory')),foreignNeedles);
    denied(await request(s.member,route(b,'exports/fairness')),foreignNeedles);
    denied(await request(s.member,route(b,'fairness',s.foreign.personId)));
    denied(await request(s.member,route(a,'fairness',s.foreign.personId)));
    for(const options of [{method:'HEAD'},{headers:{Range:'bytes=0-16'}},{headers:{'If-None-Match':'*'}}])
      denied(await request(s.member,route(b,'files',r.foreignFile.id),options),foreignNeedles);
    for(const suffix of ['', '?departmentId='+encodeURIComponent(b)]) {
      const result=await request(s.member,route(a,'posts')+suffix);
      if(result.status!==200) assert.ok([400,403,404].includes(result.status));
      for(const needle of foreignNeedles) assert.equal((result.text+JSON.stringify(result.headers)).includes(needle),false);
    }
  });

  test('denied writes and deletes leave the foreign record unchanged',async()=>{
    const original=await request(s.foreign,route(b,'posts',r.foreignPost.id));
    for(const path of [route(b,'posts',r.foreignPost.id),route(a,'posts',r.foreignPost.id)]) {
      denied(await request(s.member,path,{method:'PATCH',body:{body:'unauthorized test mutation'}}),foreignNeedles);
      denied(await request(s.member,path,{method:'DELETE'}),foreignNeedles);
    }
    const after=await request(s.foreign,route(b,'posts',r.foreignPost.id)); allowed(after,r.foreignPost.marker);
    assert.deepEqual(JSON.parse(after.text),JSON.parse(original.text));
  });

  test('a nonparticipant, including a membership administrator, cannot fetch or join a trade thread',async()=>{
    const exchangePath=route(a,'exchanges',r.conversation.exchangeId);
    const originalThread=await request(s.partner,route(a,'conversations',r.conversation.id));
    const originalExchange=await request(s.partner,exchangePath);
    for(const outsider of [s.outsider,s.admin]) {
      const path=route(a,'conversations',r.conversation.id);
      denied(await request(outsider,path),[r.conversation.marker]);
      denied(await request(outsider,route(a,'files',r.privateFile.id)),[r.privateFile.marker]);
      denied(await request(outsider,path+'/messages',{method:'POST',body:{body:'unauthorized test reply',personId:s.member.personId}}),[r.conversation.marker]);
      denied(await request(outsider,exchangePath),[r.conversation.marker]);
      denied(await request(outsider,exchangePath+'/accept',{method:'POST',body:{personId:s.member.personId}}),[r.conversation.marker]);
    }
    allowed(await request(s.partner,route(a,'conversations',r.conversation.id)),r.conversation.marker);
    assert.deepEqual(JSON.parse((await request(s.partner,route(a,'conversations',r.conversation.id))).text),JSON.parse(originalThread.text));
    assert.deepEqual(JSON.parse((await request(s.partner,exchangePath)).text),JSON.parse(originalExchange.text));
  });

  test('named fairness and exports require the custodian role, while your own sheet remains available',async()=>{
    for(const member of [s.member,s.outsider,s.admin]) {
      denied(await request(member,route(a,'fairness',s.partner.personId)));
      denied(await request(member,route(a,'exports/fairness')));
    }
    allowed(await request(s.partner,route(a,'fairness',s.partner.personId)));
    allowed(await request(s.keeper,route(a,'fairness',s.partner.personId)));
  });

  test('client role, actor and department hints do not grant authority',async()=>{
    const headers={'X-Actor':s.keeper.personId,'X-Role':'custodian','X-Department-ID':b};
    denied(await request(s.member,route(a,'fairness',s.partner.personId),{headers}));
    denied(await request(s.member,route(b,'posts',r.foreignPost.id),{headers}),foreignNeedles);
    denied(await request(s.member,route(a,'fairness',s.partner.personId)+'?keeper=true&actor='+encodeURIComponent(s.keeper.personId)));
    const forged=await request(s.member,route(a,'posts'),{method:'POST',body:{body:'fixture-signal forged identity '+f.runId,authorId:s.foreign.personId,departmentId:b}});
    if(forged.status===201) {
      const post=JSON.parse(forged.text); assert.equal(post.authorId,s.member.personId); assert.equal(post.departmentId,a);
      denied(await request(s.member,route(b,'posts',post.id)));
      const removed=await request(s.member,route(a,'posts',post.id),{method:'DELETE'}); assert.ok([200,204].includes(removed.status));
    } else assert.ok([400,403].includes(forged.status),'Reject forged ownership or ignore it and use the authenticated principal');
  });

  test('a participant acceptance is attributed to the authenticated participant only',async()=>{
    const path=route(a,'exchanges',r.conversation.exchangeId);
    const accepted=await request(s.partner,path+'/accept',{method:'POST',body:{}}); allowed(accepted);
    const saved=await request(s.member,path); allowed(saved);
    const exchange=JSON.parse(saved.text);
    assert.ok(exchange.acceptedBy.includes(s.partner.personId));
    assert.equal(exchange.acceptedBy.includes(s.member.personId),false);
  });

  test('search and Ask filter inaccessible records before returning results or sources',async()=>{
    for(const session of [s.member,s.outsider]) {
      const search=await request(session,route(a,'search')+'?q=fixture-signal');
      allowed(search,r.post.marker);
      const forbidden=session===s.member?restricted.filter(item=>item.kind==='fairness'):restricted;
      noPrivateSources(search,[...foreignSources,...forbidden]);
      for(const marker of [...foreignNeedles,...(session===s.outsider?[r.conversation.marker,r.privateFile.marker]:[])]) assert.equal(search.text.includes(marker),false);
      const answer=await request(session,route(a,'ask'),{method:'POST',body:{question:'What is new on the board?'}});
      allowed(answer,r.post.marker); noPrivateSources(answer,[...foreignSources,...forbidden]);
      for(const marker of [...foreignNeedles,...(session===s.outsider?[r.conversation.marker,r.privateFile.marker]:[])]) assert.equal(answer.text.includes(marker),false);
    }
    denied(await request(s.member,route(b,'search')+'?q=fixture-signal'),foreignNeedles);
    denied(await request(s.member,route(b,'ask'),{method:'POST',body:{question:'What is new on the board?'}}),foreignNeedles);
  });

  test('removing the custodian role takes effect for an existing session',async()=>{
    const before=await request(s.keeper,route(a,'fairness',s.partner.personId)); allowed(before);
    const changed=await request(s.admin,route(a,'memberships',s.keeper.membershipId),{method:'PATCH',body:{roles:['member']}});
    assert.ok([200,204].includes(changed.status));
    denied(await request(s.keeper,route(a,'fairness',s.partner.personId)));
    denied(await request(s.keeper,route(a,'exports/fairness')));
    allowed(await request(s.keeper,route(a,'posts',r.post.id)),r.post.marker);
  });

  test('membership revocation rejects both existing sessions on their next request',async()=>{
    const sessions=[s.revocable,s.revocableSecond], path=route(a,'files',r.file.id);
    for(const session of sessions) allowed(await request(session,path),r.file.marker);
    const revoked=await request(s.admin,route(a,'memberships',s.revocable.membershipId),{method:'DELETE'});
    assert.ok([200,204].includes(revoked.status),'An authorized administrator must actually revoke membership');
    // No logout, refresh, wait or new credentials: the same live sessions must immediately lose access.
    for(const session of sessions) {
      denied(await request(session,'/api/session'));
      denied(await request(session,path),[r.file.marker]);
      denied(await request(session,route(a,'posts')), [r.post.marker]);
      denied(await request(session,route(a,'posts'),{method:'POST',body:{body:'revoked test write'}}));
      denied(await request(session,route(a,'search')+'?q=fixture-signal'),[r.post.marker]);
      denied(await request(session,route(a,'ask'),{method:'POST',body:{question:'What is new on the board?'}}),[r.post.marker]);
    }
    const posts=await request(s.member,route(a,'posts')); allowed(posts,r.post.marker);
    assert.equal(posts.text.includes('revoked test write'),false,'A denied write must not have saved anything');
  });
});
