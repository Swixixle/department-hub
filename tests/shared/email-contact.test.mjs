// Exploratory contract for the contact-email option, NOT a selected product/schema decision.
// Run separately with fresh real HTTP fixtures; see docs/EMAIL-OPTIONS.md.
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { allowed, client, denied, emailHidden, hasEmail, loadFixture, normalizeEmail } from './support.mjs';

const f=loadFixture(process.env.DEPARTMENT_HUB_TEST_FIXTURE,{contactEmail:true}), request=client(f), s=f.sessions, c=f.contacts;
const a=s.member.departmentId,b=s.foreign.departmentId;
const route=(dept,kind,id='')=>'/api/departments/'+encodeURIComponent(dept)+'/'+kind+(id?'/'+encodeURIComponent(id):'');
const json=result=>JSON.parse(result.text);
const question=contact=>({question:'What is '+contact.name+"'s email address?"});
const noEmailHeaders=result=>{
  for(const contact of Object.values(c)) emailHidden({text:'',headers:result.headers},contact.email);
};
async function profile(session) {
  const result=await request(session,route(a,'profile')); allowed(result); noEmailHeaders(result);
  assert.equal(json(result).personId,session.personId); return result;
}
async function lookups(viewer,contact) {
  return [
    await request(viewer,route(a,'directory')),
    await request(viewer,route(a,'directory',contact.personId)),
    await request(viewer,route(a,'search')+'?q='+encodeURIComponent(contact.name)),
    await request(viewer,route(a,'ask'),{method:'POST',body:question(contact)}),
    await request(viewer,route(a,'exports/directory'))
  ];
}
async function visible(viewer,contact) {
  const results=await lookups(viewer,contact);
  for(const result of results) {
    allowed(result); noEmailHeaders(result);
    assert.ok(hasEmail(result,contact.email),'A legitimately shared email must actually appear; hiding all addresses cannot pass');
  }
  assert.ok(json(results[0]).some(person=>person.personId===contact.personId && normalizeEmail(person.email)===normalizeEmail(contact.email)));
  assert.equal(normalizeEmail(json(results[1]).email),normalizeEmail(contact.email));
}
async function withheld(viewer,contact) {
  if(viewer.personId===contact.personId) return; // Self-profile access is allowed.
  const results=await lookups(viewer,contact);
  for(const [index,result] of results.entries()) {
    if(index===1) assert.ok([200,403,404].includes(result.status));
    else allowed(result);
    noEmailHeaders(result); emailHidden(result,contact.email);
  }
  const directory=json(results[0]); assert.ok(Array.isArray(directory));
  for(const record of directory.filter(person=>person.personId===contact.personId))
    assert.ok(record.email==null,'Withheld email fields must be absent/null, not partially revealed');
  if(results[1].status===200) assert.ok(json(results[1]).email==null);
}
async function fairnessWithout(contacts) {
  const result=await request(s.keeper,route(a,'exports/fairness')); allowed(result); noEmailHeaders(result);
  assert.ok(json(result).people.some(person=>person.personId===s.partner.personId && person.weekendTurns===f.fairness.partnerWeekendTurns),'The authorized fairness export must contain actual seeded records');
  for(const contact of contacts) emailHidden(result,contact.email);
}

describe('candidate contact-email contract: purpose still open, real HTTP fixtures required',{concurrency:false},()=>{
  before(async()=>{
    for(const session of Object.values(s)) {
      const result=await request(session,'/api/session'); allowed(result); noEmailHeaders(result);
      assert.equal(json(result).personId,session.personId); assert.equal(json(result).departmentId,session.departmentId);
    }
    allowed(await request(s.foreign,route(b,'directory')),s.foreign.personId);
    for(const [session,contact,sharing] of [[s.member,c.shared,true],[s.partner,c.private,false],[s.outsider,c.defaultPrivate,false]]) {
      const own=await profile(session); assert.ok(hasEmail(own,contact.email)); assert.equal(json(own).shareEmail,sharing);
    }
    const missing=await profile(s.keeper); assert.ok(json(missing).email==null); assert.equal(json(missing).shareEmail,false);
    await visible(s.outsider,c.shared);
  });

  test('contact email is private by default, including administrator/custodian views and both exports',async()=>{
    const added=await request(s.keeper,route(a,'profile'),{method:'PATCH',body:{email:'  '+c.newPrivate.email.toUpperCase()+'  '}});
    allowed(added); noEmailHeaders(added); assert.ok(hasEmail(added,c.newPrivate.email)); assert.equal(json(added).shareEmail,false);
    for(const viewer of [s.member,s.partner,s.outsider,s.keeper,s.admin])
      for(const contact of [c.private,c.defaultPrivate,c.newPrivate]) await withheld(viewer,contact);
    await fairnessWithout([c.private,c.defaultPrivate,c.newPrivate]);
  });

  test('withdrawal immediately removes an email from warmed lookups and exports without erasing the owner copy',async()=>{
    const originalPhoneConsent=json(await profile(s.partner)).sharePhone;
    const shared=await request(s.partner,route(a,'profile'),{method:'PATCH',body:{shareEmail:true}});
    allowed(shared); noEmailHeaders(shared); assert.equal(json(shared).shareEmail,true); assert.equal(json(shared).sharePhone,originalPhoneConsent);
    await visible(s.outsider,c.private);
    const withdrawn=await request(s.partner,route(a,'profile'),{method:'PATCH',body:{shareEmail:false}});
    allowed(withdrawn); noEmailHeaders(withdrawn); assert.equal(json(withdrawn).shareEmail,false);
    for(const viewer of [s.member,s.outsider,s.keeper,s.admin]) await withheld(viewer,c.private);
    await fairnessWithout([c.private,c.defaultPrivate,c.newPrivate]);
    const own=await profile(s.partner); assert.ok(hasEmail(own,c.private.email)); assert.equal(json(own).sharePhone,originalPhoneConsent);
  });

  test('self-profile hints cannot read or change somebody else’s email or sharing choice',async()=>{
    for(const viewer of [s.member,s.keeper,s.admin]) {
      const targeted=await request(viewer,route(a,'profile')+'?personId='+encodeURIComponent(s.partner.personId));
      allowed(targeted); noEmailHeaders(targeted); assert.equal(json(targeted).personId,viewer.personId); emailHidden(targeted,c.private.email);
    }
    const original=json(await profile(s.partner));
    const forged=await request(s.member,route(a,'profile'),{method:'PATCH',body:{personId:s.partner.personId,email:'attacker+'+f.runId+'@example.invalid',shareEmail:true}});
    if(forged.status===200) assert.equal(json(forged).personId,s.member.personId);
    else assert.ok([400,403].includes(forged.status));
    noEmailHeaders(forged); emailHidden(forged,c.private.email);
    const after=json(await profile(s.partner)); assert.equal(normalizeEmail(after.email),normalizeEmail(original.email)); assert.equal(after.shareEmail,false);
  });

  test('shared contact emails remain inside their department and never become header metadata',async()=>{
    for(const path of [route(a,'directory'),route(a,'directory',c.shared.personId),route(a,'search')+'?q='+encodeURIComponent(c.shared.name),route(a,'exports/directory'),route(a,'exports/fairness')]) {
      const result=await request(s.foreign,path); denied(result); noEmailHeaders(result);
      for(const contact of Object.values(c)) emailHidden(result,contact.email);
    }
    const answer=await request(s.foreign,route(a,'ask'),{method:'POST',body:question(c.shared)}); denied(answer); noEmailHeaders(answer);
    for(const contact of Object.values(c)) emailHidden(answer,contact.email);
  });
});
