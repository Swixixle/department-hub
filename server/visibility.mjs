// What one caller may see of another person's records. Every route that returns a person, a fairness total or a
// searchable passage goes through here, so a number is filtered out before the text leaves the process rather than
// hidden in the page afterwards.
//
// A phone number is the owner's to publish. There is no administrator or custodian exception: a withheld number is
// withheld from everyone except its owner, and withdrawing consent applies to the next request on every route.
export const phoneFor = (session, person) => {
  if (!person) return null;
  if (person.person_id === session.personId || person.id === session.personId) return person.phone ?? null;
  return person.share_phone ? (person.phone ?? null) : null;
};

export const canReadNamedFairness = (session, personId) => session.personId === personId || session.has('custodian');
export const canExportNamedRecords = session => session.has('custodian');
export const canAdministerMembership = session => session.has('admin');

export const directoryPerson = (session, row) => ({
  personId: row.person_id,
  name: row.name,
  phone: phoneFor(session, row),
  sharePhone: row.person_id === session.personId ? Boolean(row.share_phone) : undefined
});
