// The Protocols screens, as markup. Nothing here changes the library; src/main.js handles the presses.
//
// Three things are kept visibly apart everywhere: the original file, the reading taken from it, and the answers a
// person mapped to it. The reading is shown beside the original so it can be checked, and every citation opens the
// original at the cited place in the exact revision cited.
import { applicable, historyOf, standing, STANDING, shortDigest, familyOf, revisionOf, bundlesOf } from './protocols.js';
import { passageAt } from './pdftext.js';
import { reviewHolds, validateBundle, wholeRule } from './bundles.js';
import { cautionsFor, searchReferences } from './references.js';
import { cardHolds, cite, passagesOf, NOT_A_PROTOCOL, CUSTODY, CARD_FORMAT } from './facts.js';

export const NOT_AUTHORITY = 'Recorded for the profile selected on this device. This prototype does not verify who that is, and a recorded review is not clinical sign-off.';
export const HELD_HERE = 'This is the copy held on this device. Department Hub cannot tell whether whoever issued a protocol has published a newer one.';
export const SYNTHETIC = 'Synthetic test material — NOT FOR CLINICAL USE';
const fileSize = bytes => bytes < 1024 ? bytes + ' bytes' : bytes < 1048576 ? Math.round(bytes / 102.4) / 10 + ' KB' : Math.round(bytes / 104857.6) / 10 + ' MB';
const day = stamp => String(stamp || '').slice(0, 10);

export const chipFor = (library, revision, today) => { const where = standing(library, revision, today); return { where, label: where === 'scheduled' ? 'Active from ' + revision.effective : STANDING[where] }; };
// The revision a protocol's page opens on: the one in force, or failing that the newest held.
export const landingRevision = (library, familyId, today) => applicable(library, familyId, today).revision || historyOf(library, familyId)[0] || null;

export function libraryView({ library, today, documents, query, results, keeper, demo, sampleNext, references, cardSetOffered }, { h, button, valueAttr }) {
  const families = [...library.families].sort((a, b) => Number(library.marks.includes(b.id)) - Number(library.marks.includes(a.id)) || a.identifier.localeCompare(b.identifier));
  const card = family => {
    const now = applicable(library, family.id, today), shown = now.revision || historyOf(library, family.id)[0], marked = library.marks.includes(family.id);
    return '<article class="panel protocol-card" data-family="' + h(family.id) + '"><div><h3>' + h(shown?.title || family.identifier) + '</h3><p class="subtle">' + h([family.identifier, shown?.authority, shown?.category].filter(Boolean).join(' · ')) + '</p>' +
      '<p><span class="badge standing ' + h(now.status) + '">' + h(now.revision ? 'Revision ' + now.revision.label + ' · ' + chipFor(library, now.revision, today).label + ' · effective ' + now.revision.effective : { conflict: 'Two revisions on one date', 'not-yet': 'Not yet in effect', none: 'No revision in effect' }[now.status]) + '</span></p>' +
      (now.why ? '<p class="subtle">' + h(now.why) + '</p>' : '') + (now.upcoming ? '<p class="subtle">Revision ' + h(now.upcoming.label) + ' takes effect on ' + h(now.upcoming.effective) + '.</p>' : '') + '</div>' +
      '<div class="actions">' + button(marked ? '★ Bookmarked' : '☆ Bookmark', 'protocol-mark', 'class="secondary" aria-pressed="' + marked + '" ' + valueAttr(family.id)) + button('Open', 'protocol-open', 'class="primary" ' + valueAttr(family.id)) + '</div></article>';
  };
  return '<div class="intro"><div><div class="eyebrow">PROTOCOLS</div><h1>Protocols</h1><p>Each protocol is kept as its original file, one revision at a time.</p></div>' +
    (keeper ? '<div class="actions">' + button('Add a protocol', 'protocol-add', 'class="primary"') + '</div>' : '') + '</div>' +
    '<p class="subtle protocol-terms">Ask answers only from a revision that is in effect, whose reading was checked against the original and whose answers were reviewed here. Read the original for anything that matters: this is a way to find it, not an instruction.</p>' +
    '<form data-form="protocol-search" class="protocol-search"><label>Search the protocols held here<input name="q" maxlength="120" autocomplete="off" enterkeyhint="search" value="' + h(query || '') + '" placeholder="A word or two from the protocol"></label><button class="secondary">Search</button></form>' +
    (query ? '<div class="panel protocol-results" role="status"><p class="subtle">' + (results.length ? 'Places that mention “' + h(query) + '”, in the revisions now in effect. A passage is one part of a rule: open it and read around it. This search is not saved.' : 'Nothing held mentions “' + h(query) + '”.') + '</p>' +
      results.map(hit => '<div class="ask-item"><div><b>' + h(hit.passage.text.length > 180 ? hit.passage.text.slice(0, 177) + '…' : hit.passage.text) + '</b><small>' + h([hit.revision.identifier + ' rev ' + hit.revision.label, STANDING[hit.standing] || hit.standing, 'page ' + hit.passage.page, hit.passage.context].filter(Boolean).join(' · ')) + '</small></div>' +
        button('Open', 'protocol-cite', 'class="secondary" ' + valueAttr(hit.revision.id + '|' + hit.passage.anchor)) + '</div>').join('') + '</div>' : '') +
    (families.length ? '<div class="protocol-list">' + families.map(card).join('') + '</div>' : '<div class="panel empty"><h3>No protocols are held yet</h3><p>' + (keeper ? 'Add a protocol as a PDF. It is read on this device and goes nowhere else.' : 'A record keeper adds protocols. None has been added on this device.') + '</p></div>') +
    (keeper && sampleNext ? '<div class="panel protocol-sample"><h3>' + (sampleNext === '1' ? 'Try it with an invented protocol' : 'Replace it with revision 2') + '</h3><p>' + (sampleNext === '1'
      ? 'Adds revision 1 of a made-up training drill (' + h(SYNTHETIC) + ') exactly as a real file would be added: unchecked, unreviewed and answering nothing until you take each step.'
      : 'Adds revision 2 of the invented drill, effective 1 November 2026. From that date revision 1 is history, and nothing answers until revision 2 has been checked and reviewed.') + '</p>' +
      button(sampleNext === '1' ? 'Add the invented protocol' : 'Add revision 2 of the invented protocol', 'protocol-sample', 'class="secondary"') + '</div>' : '') +
    '<h2 class="group-head">Reference knowledge</h2><p class="subtle">Short cards for general facts such as a normal range or a definition. Each rests on passages of a page held here exactly as captured, and every figure on a card must appear in them. A card answers in Ask only after a person here has compared it with its passages. ' + h(NOT_A_PROTOCOL) + '</p>' +
    ((library.knowledge || []).filter(set => !set.withdrawn).length ? '<div class="line-list">' + library.knowledge.filter(set => !set.withdrawn).map(set => { const done = set.cards.filter(card => cardHolds(set, card)).length;
      return '<div><span><b>' + h(set.title) + '</b> <small>' + h(done + ' of ' + set.cards.length + ' cards checked · ' + set.source.publisher) + '</small></span><span class="pair">' + button('Open', 'knowledge-open', 'class="secondary" ' + valueAttr(set.id)) + '</span></div>'; }).join('') + '</div>' : '<p class="subtle">No reference cards are held.</p>') +
    (keeper && cardSetOffered ? '<p>' + button('Add the blood-gas reference cards', 'knowledge-add', 'class="secondary"') + ' <span class="subtle">Twelve cards on adult arterial blood gas values, resting on a Blinders capture of an openly licensed textbook page. They arrive unchecked.</span></p>' : '') +
    '<h2 class="group-head">Professional references</h2><p class="subtle">Published guidelines from AARC and others, and NBRC’s credentialing pages: titles and links to the official originals. Department Hub holds none of their text and answers nothing from them. They are not your hospital’s protocols.</p>' +
    (references ? '<p>' + button('Browse ' + references.records.length + ' professional references', 'reference-shelf', 'class="secondary"') + '</p>' : '<p class="subtle">The reference list is loading.</p>') +
    '<h2 class="group-head">Pasted documents</h2><p class="subtle">Added before protocols were kept as files, or pasted as plain text. Ask searches their words and quotes what it finds. They are not reviewed protocols and do not become one by being here.</p>' +
    (documents.length ? '<div class="line-list">' + documents.map(doc => '<div><span><b>' + h(doc.title) + '</b> <small>' + h(['Legacy document', doc.kind, doc.effective ? 'effective ' + doc.effective : 'no effective date given'].join(' · ')) + '</small></span><span class="pair">' +
      button('Open', 'doc-open', 'class="secondary" ' + valueAttr(doc.id)) + '</span></div>').join('') + '</div>' : '<p class="subtle">None.</p>') +
    '<p>' + button('Add or remove pasted documents', 'docs', 'class="text-button"') + '</p><p class="subtle">' + h(HELD_HERE) + (demo ? ' Public demo: everything here is fictional.' : '') + '</p>';
}

function originalPane(revision, cite, held, { h }) {
  const target = cite ? passageAt(revision.extraction, cite) : null;
  return '<div class="original-pane" aria-label="Original file">' + (held === false || held === 'changed' ? '<div class="notice" role="' + (held === 'changed' ? 'alert' : 'status') + '">' + (held === 'changed' ? 'The file stored on this device no longer matches this revision’s fingerprint, so it is not shown.'
    : 'The original file is not on this device, so it cannot be shown.') + ' Choose the same file again to restore it. It is accepted only if its fingerprint matches ' + h(shortDigest(revision.digest)) +
    '.<label class="attach"><b>Choose the original PDF</b><input id="protocol-original-file" type="file" accept="application/pdf,.pdf"></label></div>' : '') +
    revision.extraction.pages.map(page => '<figure class="protocol-page"><div class="page-frame" style="aspect-ratio:' + page.width + '/' + page.height + '" data-page-canvas="' + h(revision.digest + '|' + page.number) + '">' +
      (target?.page === page.number && target.box ? '<div class="cite-box" id="cite-mark" style="left:' + (target.box[0] / page.width * 100 - 0.6).toFixed(2) + '%;top:' + (target.box[1] / page.height * 100 - 0.3).toFixed(2) + '%;width:' + (target.box[2] / page.width * 100 + 1.2).toFixed(2) +
        '%;height:' + (target.box[3] / page.height * 100 + 0.6).toFixed(2) + '%" title="The cited passage"></div>' : '') +
      (target?.page === page.number && !target.box ? '<div class="cite-note" id="cite-mark">The cited text on this page was typed in by a reviewer. It has no marked place in the file.</div>' : '') +
      '</div><figcaption>Page ' + page.number + ' of ' + revision.extraction.pages.length + ' · original file ' + h(shortDigest(revision.digest)) + (target?.page === page.number ? ' · cited passage outlined' : '') + '</figcaption></figure>').join('') + '</div>';
}

function readingPane(revision, cite, editable, { h, button, valueAttr }) {
  const show = anchor => button('Show in original', 'protocol-cite', 'class="text-button" ' + valueAttr(revision.id + '|' + anchor));
  const cited = anchor => cite && (cite === anchor || cite.startsWith(anchor + '.')) ? ' cited' : '';
  return '<div class="reading-pane" aria-label="Reading taken from the file">' + revision.extraction.pages.map(page => '<section class="reading-page"><h4>Page ' + page.number + '</h4>' +
    (page.supplied ? '<p class="subtle">The text of this page was typed in by ' + h(page.supplied.by) + ' because the reader found none. Compare it with the original yourself.</p>' : '') +
    (page.drawn ? '<p class="subtle">This page has drawn lines or shapes. Table rows are read from where the text sits; check them against the original. Words inside a diagram are listed as labels, and its arrows are not read.</p>' : '') +
    (!page.blocks.length ? '<div class="notice" role="status">No text could be read from this page. A scanned page is not read here.' + (editable ? '<form data-form="protocol-supply"><input type="hidden" name="page" value="' + page.number + '"><label>Type the text of page ' + page.number +
      ' exactly as the original shows it, with a blank line between paragraphs<textarea name="text" rows="6" required></textarea></label><button class="secondary">Save typed text</button></form>' : '') + '</div>' : '') +
    page.blocks.map(block => block.kind === 'table'
      ? '<div class="passage table' + (cite === block.anchor ? ' cited' : '') + '" data-anchor="' + h(block.anchor) + '"><small class="anchor">' + h(block.anchor) + ' · table' + (block.under ? ' under “' + h(block.under) + '”' : '') + '</small><div class="table-scroll"><table class="reading-table"><thead><tr>' +
        block.columns.map(name => '<th scope="col">' + h(name) + '</th>').join('') + '<th><span class="sr">Place</span></th></tr></thead><tbody>' + block.rows.map(row => '<tr' + (cited(row.anchor) ? ' class="cited"' : '') + ' data-anchor="' + h(row.anchor) + '">' +
          row.cells.map((cell, index) => (index ? '<td>' : '<th scope="row">') + h(cell) + (index ? '</td>' : '</th>')).join('') + '<td>' + show(row.anchor) + '</td></tr>').join('') + '</tbody></table></div></div>'
      : '<div class="passage ' + block.kind + (block.running ? ' running' : '') + (block.figure ? ' figure' : '') + cited(block.anchor) + '" data-anchor="' + h(block.anchor) + '"><small class="anchor">' + h(block.anchor) +
        (block.kind === 'heading' ? ' · heading' : '') + (block.running ? ' · running header or footer' : '') + (block.figure ? ' · diagram label, not read as a rule' : '') + (block.supplied ? ' · typed in by a reviewer' : '') + '</small><p>' + h(block.text) + '</p>' +
        '<span class="pair">' + (block.box ? show(block.anchor) : '') + (editable && block.kind === 'text' && !block.running && !block.supplied ? button(block.figure ? 'Not a diagram label' : 'Mark as diagram label', 'protocol-figure', 'class="text-button" ' + valueAttr(block.anchor)) : '') + '</span></div>').join('') +
    '</section>').join('') + '</div>';
}

function answersPane(revision, keeper, sampleMapping, { h, button, valueAttr }) {
  const open = revision.state !== 'added' && revision.state !== 'withdrawn', all = bundlesOf(revision);
  const factLabel = (name, value) => revision.facts[name]?.options.find(option => option.value === value)?.label || value;
  return '<div class="answers-pane"><p class="subtle">A mapped answer ties one rule to every passage that has to travel with it. It is written by a person, checked by a person against the original, and answers nothing until then. Search results, repeated questions and “Yes” cannot change one.</p>' +
    (revision.state === 'added' ? '<div class="notice" role="status">Confirm the reading first. Answers can only be mapped to text someone has checked.</div>' : '') +
    (!all.length && open ? '<p>No answers are mapped to this revision. Ask will point to places in the original and will not answer from it.</p>' : '') +
    revision.topics.map(topic => '<section class="panel topic"><h3>' + h(topic.title) + '</h3>' + ((topic.needs || []).length ? '<p class="subtle">Asks first: ' + h(topic.needs.map(name => revision.facts[name]?.ask).join(' ')) + ' “Not known” is always offered.</p>' : '') +
      topic.bundles.map(bundle => {
        const holds = reviewHolds(revision, topic, bundle), problems = validateBundle(revision, topic, bundle), when = Object.entries(bundle.when || {}).map(([name, value]) => factLabel(name, value));
        return '<article class="bundle ' + (holds ? 'reviewed' : 'open') + '" data-bundle="' + h(bundle.id) + '"><h4>' + h(bundle.title) + ' <span class="badge ' + (holds ? '' : 'learning') + '">' + (holds ? 'Reviewed' : bundle.review ? 'Changed since review' : 'Not reviewed') + '</span></h4>' +
          (when.length ? '<p class="subtle">Applies when: ' + h(when.join(' · ')) + '</p>' : '') +
          '<div class="plain"><small>Plain-language summary, written by a person. The protocol’s own words are below.</small><p class="fair-line">' + h(bundle.plain.interpretation) + '</p>' + (bundle.plain.explanation ? '<p>' + h(bundle.plain.explanation) + '</p>' : '') + '</div>' +
          (problems.length ? '<div class="notice" role="alert">This answer does not hold against the reading and cannot be reviewed: ' + h(problems.join(' ')) + '</div>' :
            wholeRule(revision, bundle).map(section => '<div class="rule-part"><h5>' + h(section.heading) + '</h5>' + section.passages.map(passage => '<div class="ask-item"><div><b>' + h(passage.text) + '</b><small>' + h(['page ' + passage.page, passage.context, passage.anchor].filter(Boolean).join(' · ')) + '</small></div>' +
              button('Show in original', 'protocol-cite', 'class="secondary" ' + valueAttr(revision.id + '|' + passage.anchor)) + '</div>').join('') + '</div>').join('')) +
          (holds ? '<p class="subtle">Reviewed by ' + h(bundle.review.by) + ' on ' + h(day(bundle.review.at)) + '. ' + h(NOT_AUTHORITY) + '</p>' :
            keeper && open && !problems.length ? '<p class="subtle">Open each passage in the original and read it there before marking this. ' + h(NOT_AUTHORITY) + '</p>' + button('I have checked this against the original', 'protocol-review', 'class="primary" ' + valueAttr(bundle.id)) : '') + '</article>';
      }).join('') + '</section>').join('') +
    (keeper && open ? '<div class="panel"><h3>Add mapped answers</h3><p class="subtle">Answers are written as a mapping file made for this exact file (' + h(shortDigest(revision.digest)) + '). A mapping made for any other revision is refused. Writing one inside the app is not built yet.</p>' +
      '<label class="attach"><b>Choose a mapping file (.json)</b><input id="protocol-mapping-file" type="file" accept="application/json,.json"></label>' + (sampleMapping ? button('Add the mapping written for this invented file', 'protocol-sample-mapping', 'class="secondary"') : '') + '</div>' : '') + '</div>';
}

export function familyView({ library, today, familyId, revisionId, pane, cite, keeper, held, sampleMapping, withdrawing, fromAsk, topics = [] }, tools) {
  const { h, button, valueAttr } = tools, family = familyOf(library, familyId), history = historyOf(library, familyId);
  const revision = revisionOf(library, revisionId) || landingRevision(library, familyId, today);
  if (!family || !revision) return '<div class="panel empty"><h3>That protocol is no longer held</h3>' + button('All protocols', 'protocol-home', 'class="secondary"') + '</div>';
  const now = applicable(library, familyId, today), chip = chipFor(library, revision, today), marked = library.marks.includes(family.id), bundles = bundlesOf(revision);
  const open = bundles.filter(({ topic, bundle }) => !reviewHolds(revision, topic, bundle)).length;
  const record = [['Effective', revision.effective + ' (the issuer’s date)'], ['Issued by', revision.authority], ['Category', revision.category], ['Came from', revision.location || 'not recorded'], ['File', revision.file.name + ' · ' + fileSize(revision.file.bytes)],
    ['Fingerprint (SHA-256)', revision.digest], ['Added here', day(revision.added.at) + ' by ' + revision.added.by], ['Reading confirmed', revision.checked ? day(revision.checked.at) + ' by ' + revision.checked.by : 'not yet'],
    ['Answers reviewed', revision.mappingsReviewed ? day(revision.mappingsReviewed.at) + ' by ' + revision.mappingsReviewed.by : 'not yet'], ['Made active', revision.activated ? day(revision.activated.at) + ' by ' + revision.activated.by : 'not yet'],
    ...(revision.withdrawn ? [['Withdrawn', day(revision.withdrawn.at) + ' by ' + revision.withdrawn.by + ': ' + revision.withdrawn.reason]] : [])];
  // The one next step for this revision, offered to a record keeper. Each is a separate, recorded action.
  const step = !keeper ? '' : revision.state === 'added' ? '<p>Compare the reading with the original, page by page. Correct any diagram labels. Then confirm it.</p>' + button('The reading matches the original', 'protocol-check', 'class="primary"')
    : revision.state === 'checked' ? '<p>' + (bundles.length ? open ? open + ' of ' + bundles.length + ' mapped answers still need review, under Answers.' : 'Every mapped answer has been reviewed.' : 'No answers are mapped. You can add a mapping under Answers, or go on without one.') + '</p>' +
      button(bundles.length ? 'All answers are reviewed' : 'Go on with no mapped answers', 'protocol-reviewed', 'class="primary"' + (open ? ' disabled' : ''))
    : revision.state === 'reviewed' ? '<p>Making it active puts it in use from its effective date, ' + h(revision.effective) + '. Earlier revisions stay in the history and stop answering from that date.</p>' + button('Make revision ' + h(revision.label) + ' active', 'protocol-activate', 'class="primary"') : '';
  const tab = (id, label) => button(label, 'protocol-pane', (pane === id ? 'class="selected" aria-pressed="true" ' : 'aria-pressed="false" ') + valueAttr(id));
  return '<p class="pair start">' + (fromAsk ? button('‹ Back to the answer', 'ask-back', 'class="secondary"') : '') + button('‹ All protocols', 'protocol-home', 'class="text-button"') + '</p><div class="intro"><div><div class="eyebrow">PROTOCOL · ' + h(family.identifier) + '</div><h1>' + h(revision.title) + '</h1>' +
    '<div class="standing-line"><span class="badge standing ' + h(chip.where) + '">Revision ' + h(revision.label) + ' · ' + h(chip.label) + '</span></div></div><div class="actions">' + button(marked ? '★ Bookmarked' : '☆ Bookmark', 'protocol-mark', 'class="secondary" aria-pressed="' + marked + '" ' + valueAttr(family.id)) + '</div></div>' +
    (now.why ? '<div class="notice" role="status">' + h(now.why) + '</div>' : '') +
    (now.revision && now.revision.id !== revision.id ? '<div class="notice" role="status">You are reading revision ' + h(revision.label) + ' (' + h(chip.label.toLowerCase()) + '). The revision in effect is ' + h(now.revision.label) + '. ' + button('Open revision ' + h(now.revision.label), 'protocol-revision', 'class="text-button" ' + valueAttr(now.revision.id)) + '</div>' : '') +
    '<div class="protocol-top"><section class="panel"><h3>Revisions</h3><div class="line-list">' + history.map(entry => { const where = chipFor(library, entry, today); return '<div class="' + (entry.id === revision.id ? 'current' : '') + '"><span><b>Revision ' + h(entry.label) + '</b> <small>' +
      h(['effective ' + entry.effective, where.label, 'file ' + shortDigest(entry.digest)].join(' · ')) + '</small></span><span class="pair">' + (entry.id === revision.id ? '<span class="subtle">Shown</span>' : button('Open', 'protocol-revision', 'class="secondary" ' + valueAttr(entry.id))) + '</span></div>'; }).join('') + '</div>' +
      '<p class="subtle">' + h(HELD_HERE) + '</p></section>' +
    '<section class="panel"><h3>This revision</h3><dl class="record">' + record.map(([name, value]) => '<dt>' + h(name) + '</dt><dd>' + h(value) + '</dd>').join('') + '</dl><p class="subtle">A fingerprint says which file this is. It does not say anyone approved it.</p></section></div>' +
    (step || (keeper && revision.state !== 'withdrawn') ? '<section class="panel protocol-step"><h3>' + (step ? 'Next step' : 'Record') + '</h3>' + step + (step ? '<p class="subtle">' + h(NOT_AUTHORITY) + '</p>' : '') +
      (withdrawing ? '<form data-form="protocol-withdraw"><label>Why is revision ' + h(revision.label) + ' being withdrawn? The reason is kept with the record.<input name="reason" maxlength="200" required autocomplete="off"></label><div class="actions inline"><button class="danger">Withdraw revision ' + h(revision.label) + '</button>' +
        button('Cancel', 'protocol-withdraw-cancel', 'class="secondary"') + '</div></form>' : '<p>' + button('Withdraw this revision…', 'protocol-withdraw', 'class="text-button"') + '</p>') + '</section>' : '') +
    (now.answerable && now.revision.id === revision.id && topics.length ? '<section class="panel protocol-ask"><h3>Ask about this protocol</h3><p class="subtle">Reviewed answers, each with its passages in the original. Ask will put a question back to you when the rule turns on something, with “Not known” always offered.</p>' +
      '<div class="chip-list"><div>' + topics.map(title => button(h(title), 'protocol-ask', 'class="chip plain" ' + valueAttr(title))).join('') + button('Ask something else', 'protocol-ask', 'class="chip plain"') + '</div></div></section>' : '') +
    '<div class="calendar-toolbar"><h2>Read</h2><div class="segments" role="group" aria-label="What to show">' + tab('both', 'Side by side') + tab('original', 'Original') + tab('reading', 'Reading') + tab('answers', 'Answers (' + bundles.length + ')') + '</div></div>' +
    (pane === 'answers' ? answersPane(revision, keeper, sampleMapping, tools) : '<div class="protocol-read ' + h(pane) + '">' + (pane !== 'reading' ? originalPane(revision, cite, held, tools) : '') + (pane !== 'original' ? readingPane(revision, cite, keeper && revision.state === 'added', tools) : '') + '</div>');
}

export function addDialog({ busy }, { h }) {
  if (busy) return '<p role="status">' + h(busy) + '</p><div class="progress"><i></i></div><p>The file is read on this device. Nothing is sent anywhere.</p>';
  return '<p>Add one revision of a protocol as the PDF it was issued as. Add only what the department is allowed to keep here. Do not add anything that names or describes a patient.</p>' +
    '<form data-form="protocol-add"><label class="attach"><b>The protocol, as a PDF</b><input id="protocol-file" name="file" type="file" accept="application/pdf,.pdf" required></label>' +
    '<label>Title, as printed<input name="title" maxlength="160" required autocomplete="off"></label>' +
    '<div class="cell-when"><label>Protocol identifier<input name="identifier" maxlength="60" required autocomplete="off" placeholder="RT-000"></label><label>Revision<input name="label" maxlength="30" required autocomplete="off" placeholder="3"></label></div>' +
    '<div class="cell-when"><label>Effective date, as printed<input name="effective" type="date" required></label><label>Category<input name="category" maxlength="60" autocomplete="off" placeholder="Protocol"></label></div>' +
    '<label>Issued by<input name="authority" maxlength="160" required autocomplete="off" placeholder="The committee or department named on it"></label>' +
    '<label>Where this file came from<input name="location" maxlength="200" autocomplete="off" placeholder="For example: the policy library, downloaded today"></label>' +
    '<p class="subtle">These are the document’s own details, typed from what it says. They are recorded separately from when it was added here. A PDF that is a scan (a picture of pages) will read as empty; you can type its text in afterwards. ' + h(NOT_AUTHORITY) + '</p>' +
    '<div class="actions inline"><button class="primary">Read and add</button></div></form>';
}

// The reference shelf. Every entry leaves the app to the publisher's own copy; nothing of the document is shown here.
export function referencesView({ list, query, section, retired, today }, { h, button, valueAttr }) {
  const found = searchReferences(list.records, query, { retired, section, groups: true }), hidden = list.records.filter(record => record.retired && (!section || record.section === section)).length;
  return '<p class="pair start">' + button('‹ All protocols', 'protocol-home', 'class="text-button"') + '</p><div class="intro"><div><div class="eyebrow">PROFESSIONAL REFERENCES</div><h1>Published references</h1><p>Where a guideline is, not what it says.</p></div></div>' +
    '<div class="notice reference-terms" role="note"><b>These are not your hospital’s protocols.</b> Each entry is a title, a year and a link to the publisher’s own copy. Department Hub holds none of the text, does not summarise it and answers nothing from it. ' +
      'A listing does not show that a document is current, or that your hospital has adopted it.</div>' +
    '<form data-form="reference-search" class="reference-search"><label>Search titles and topics<input name="q" maxlength="120" autocomplete="off" enterkeyhint="search" value="' + h(query || '') + '" placeholder="Try suction, oxygen, ventilator or asthma"></label>' +
      '<label>Collection<select name="section" id="reference-section"><option value="">All collections</option>' + list.sections.map(name => '<option' + (name === section ? ' selected' : '') + '>' + h(name) + '</option>').join('') + '</select></label>' +
      '<label class="check"><span><input type="checkbox" name="retired" id="reference-retired"' + (retired ? ' checked' : '') + '> Include retired documents (' + hidden + ')</span></label><button class="secondary">Search</button></form>' +
    '<p class="subtle" role="status">' + (query ? found.filter(hit => hit.hits >= 1).length + ' matched by title' + (found.some(hit => hit.hits < 1) ? ', ' + found.filter(hit => hit.hits < 1).length + ' more filed under a related subject' : '') + ', of ' + list.records.length
      : found.length + ' of ' + list.records.length + ' shown') + (retired ? '' : ' · retired documents are left out') + (query ? ' · this search is not saved' : '') + '</p>' +
    (found.length ? '<div class="reference-list">' + found.map(({ record, hits }, index) => { const cautions = cautionsFor(record, list.records, today), grouped = Boolean(query) && hits < 1;
      // A match on the broad subject group alone is set apart: the title does not say it covers what was typed.
      return (grouped && (index === 0 || found[index - 1].hits >= 1) ? '<p class="subtle group-divider">' + (index ? 'Not matched by title. Filed under a related subject:' : 'No title matches. Filed under a related subject:') + '</p>' : '') +
        '<article class="panel reference' + (record.retired ? ' retired' : '') + (grouped ? ' grouped' : '') + '" data-reference="' + h(record.id) + '"><div><span class="badge standing ' + (record.retired ? 'withdrawn' : 'superseded') + '">' + (record.retired ? 'RETIRED · ' : '') + h(record.section) + '</span>' +
        '<h3>' + h(record.title) + '</h3><p class="subtle">' + h([record.kind === 'external_guideline_or_standard' ? 'Another organization’s document, listed by AARC' : record.issuer, record.topic, record.year ? 'listed year ' + record.year : 'no year listed'].filter(Boolean).join(' · ')) + '</p>' +
        cautions.map(caution => '<p class="caution">' + h(caution) + '</p>').join('') +
        '<details><summary>What this listing does and does not establish</summary><p class="subtle">Found on ' + h(record.foundAt) + ' on ' + h(list.collectedOn) + '. Whether it is still current was not checked. ' + h(record.rights) +
          ' Nothing of the document is copied into Department Hub.</p></details></div>' +
        '<div class="actions"><a class="secondary link-button" href="' + h(record.url) + '" target="_blank" rel="noopener noreferrer">Open official source ↗</a></div></article>'; }).join('') + '</div>' :
      '<div class="panel empty"><h3>No title matches</h3><p>The list is searched by title and topic only, because none of the documents themselves are held here.</p></div>') +
    '<p class="subtle">Collected ' + h(list.collectedOn) + ' from AARC’s guideline index and guidance page and from NBRC’s site. ' + h(list.checked.aarcGuidelineIndex) + ' ' + h(list.checked.aarcHostedLinks) + ' ' + h(list.checked.otherLinks) + ' ' + h(list.checked.nbrc) +
      ' Opening a source needs an internet connection and takes you to its publisher.</p>';
}

// One set of reference cards, laid out for checking against its source: the card, where on the page its figures
// are, how many times they were read, and one button a person presses after looking.
export function knowledgeView({ set, keeper, withdrawing }, { h, button, valueAttr }) {
  if (!set) return '<div class="panel empty"><h3>Those cards are no longer held</h3>' + button('All protocols', 'protocol-home', 'class="secondary"') + '</div>';
  const done = set.cards.filter(card => cardHolds(set, card)).length, captured = set.format === CARD_FORMAT && set.held, capture = set.source.capture;
  const quote = text => '<blockquote class="source-quote">' + h(text) + '</blockquote>';
  return '<p class="pair start">' + button('‹ All protocols', 'protocol-home', 'class="text-button"') + '</p><div class="intro"><div><div class="eyebrow">REFERENCE KNOWLEDGE</div><h1>' + h(set.title) + '</h1>' +
    '<div class="standing-line"><span class="badge standing ' + (set.withdrawn ? 'withdrawn' : done === set.cards.length ? 'active' : 'added') + '">' + (set.withdrawn ? 'Withdrawn' : done + ' of ' + set.cards.length + ' cards checked') + '</span></div></div></div>' +
    '<div class="notice reference-terms" role="note"><b>' + h(NOT_A_PROTOCOL) + '</b> ' + h(set.applies) + '</div>' +
    (set.withdrawn ? '<div class="notice" role="status">Withdrawn by ' + h(set.withdrawn.by) + ': ' + h(/[.!?]$/.test(set.withdrawn.reason) ? set.withdrawn.reason : set.withdrawn.reason + '.') + ' These cards no longer answer.</div>' : '') +
    '<section class="panel knowledge-source"><h3>Where these come from</h3><p>' + h(cite(set)) + '</p>' +
      (captured ? '<p>Held here as the exact text of the page, captured with ' + h(capture.tool) + ' on ' + h(capture.savedAt.slice(0, 16).replace('T', ' ')) + ' UTC: ' + h(capture.of) + '</p>' +
        '<dl class="record"><dt>Capture</dt><dd>' + h(capture.id) + '</dd><dt>SHA-256</dt><dd class="digest">' + h(capture.sha256) + '</dd><dt>Size</dt><dd>' + h(capture.bytes.toLocaleString('en-US')) + ' bytes</dd></dl>' +
        '<p class="subtle">When the cards were added, the held text was hashed and matched this receipt, and every figure on every card was found in the passages it cites.</p>' +
        (set.held.licence ? '<p class="subtle">The page’s licence line, as captured: “' + h(set.held.licence.trim()) + '” Card wording is Department Hub’s; quoted passages are unchanged. <a href="' + h(set.source.licenceUrl) + '" target="_blank" rel="noopener noreferrer">The licence ↗</a></p>' : '')
        : '<p class="notice">These cards are in the earlier format. Their figures were read from the page by an AI assistant and the page’s text is not held, so they no longer answer. Add the cards built on a captured copy instead.</p>') +
      '<p><a class="secondary link-button" href="' + h(set.source.url) + '" target="_blank" rel="noopener noreferrer">Open the live page ↗</a></p><p class="subtle">The live page may have changed since it was captured. The captured text is what these cards rest on.</p></section>' +
    '<h2 class="group-head">Cards</h2><p class="subtle">To check a card: read it, then read the passages under it, which are the captured page’s own words. Record the check only if the card says what they say, with every figure and unit the same. ' + h(CUSTODY) + '</p>' +
    '<div class="reference-list">' + set.cards.map(card => { const holds = cardHolds(set, card);
      return '<article class="panel bundle ' + (holds ? 'reviewed' : 'open') + '" data-card="' + h(card.id) + '"><h4>' + h(card.title) + ' <span class="badge ' + (holds ? '' : 'learning') + '">' + (holds ? 'Checked' : card.review ? 'Changed since it was checked' : 'Not checked') + '</span></h4>' +
        '<p class="fair-line">' + h(card.answer) + '</p>' +
        (captured ? '<p class="subtle">The source’s own words · ' + h(card.where) + '</p>' + passagesOf(set, card).map(quote).join('') : '<p class="subtle">In the source: ' + h(card.where) + '</p>') +
        (holds ? '<p class="subtle">Checked against these passages by ' + h(card.review.by) + ' on ' + h(String(card.review.at).slice(0, 10)) + '.</p>' :
          keeper && captured && !set.withdrawn ? button('The card says what these passages say', 'knowledge-check', 'class="primary" ' + valueAttr(card.id)) : '') + '</article>'; }).join('') + '</div>' +
    (keeper && !set.withdrawn ? '<section class="panel protocol-step"><h3>Record</h3>' + (withdrawing ? '<form data-form="knowledge-withdraw"><label>Why are these cards being withdrawn? The reason is kept with the record.<input name="reason" maxlength="200" required autocomplete="off"></label>' +
      '<div class="actions inline"><button class="danger">Withdraw these cards</button>' + button('Cancel', 'protocol-withdraw-cancel', 'class="secondary"') + '</div></form>' : '<p>' + button('Withdraw these cards…', 'protocol-withdraw', 'class="text-button"') + '</p>') + '</section>' : '');
}
