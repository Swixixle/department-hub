// One synthetic department for the evaluation sets. Invented people, invented shifts, and built so that the shift
// filter, the exclusions, the period and the choice of metric each change the answer.
const row = (date, shift, person, extra = {}) => ({ date, shift, person, ...extra });
const assignments = [];
const put = (dates, shift, person, extra) => { for (const date of dates) assignments.push(row(date, shift, person, extra)); };

put(['2026-11-08', '2026-11-14', '2026-11-15', '2026-11-21', '2026-11-22', '2026-11-28'], 'D', 'Avery');
put(['2026-11-07', '2026-11-08', '2026-11-14', '2026-11-21', '2026-12-05'], 'D', 'Blair');
put(['2026-11-07', '2026-11-08', '2026-11-14', '2026-11-21', '2026-12-05'], 'D', 'Jamie');
put(['2026-11-07', '2026-11-15', '2026-12-12', '2026-12-13'], 'D', 'Casey');
put(['2026-12-19', '2026-12-20'], 'D', 'Emery');
put(['2026-11-10', '2026-11-11', '2026-11-17', '2026-11-18', '2026-11-24'], 'D', 'Indigo');
put(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30',
  '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-07', '2026-12-08'], 'D', 'Blair');
put(['2026-11-06', '2026-11-07', '2026-11-13', '2026-11-14', '2026-11-20', '2026-11-21'], 'N', 'Morgan');
put(['2026-11-08', '2026-11-15', '2026-11-22'], 'N', 'Jordan');
put(['2026-12-04', '2026-12-05', '2026-12-06'], 'N', 'Parker');
put(['2026-11-17', '2026-11-18'], 'N', 'Parker', { role: 'charge' });
put(['2026-11-19', '2026-11-20'], 'N', 'Morgan', { role: 'icu' });

export const world = {
  today: '2026-11-12', now: '2026-11-12T15:00:00-05:00', actor: 'Riley', assignments, posts: [],
  documents: [{ id: 'leave', title: 'Time off', kind: 'Policy', effective: '2026-01-01',
    text: 'Leave\n\nA leave request is entered four weeks before the schedule is posted.' },
    { id: 'thin', title: 'Thin liquids', kind: 'Protocol', effective: '2026-01-01',
      text: 'Thin liquids\n\nThin liquids are withheld until the swallow study is read.' }],
  directory: {}, people: [], links: {}, releases: [], requests: [], rules: {}, answers: [], learned: [],
  corrections: [], versions: {}, keeper: true,
  trade: { roster: assignments.map((entry, index) => ({ ...entry, key: 'k' + index })), directory: {},
    policy: { version: 'pilot-3', minimumRestMinutes: 480, overtimeLimitMinutes: 2400 }, committed: [], today: '2026-11-12', offers: [] }
};
