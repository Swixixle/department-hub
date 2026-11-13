// The Handoff tab: screens, dialogs and actions. Its report lives in its own store on this phone (handoff-store.js),
// never in the workspace `state`, so nothing the rest of the app saves, backs up, sends or records can carry it.
import { TEMPLATE, SUPPORT, WIPE_HOURS, newReport, addBed, removeBed, setFields, allowNotName, expiresAt, parseDictation, sheetOf, screenHandoff } from './handoff.js';
import { loadHandoff, saveHandoff, putHandoffPhoto, getHandoffPhoto, dropHandoffPhoto, wipeHandoff } from './handoff-store.js';

export const HANDOFF_NOTE = 'On this phone only: not sent, not backed up, not on the server. Still patient information: bed numbers, never names.';
let report = null, loaded = false, wipedNotice = '', refusals = {}, photoUrls = new Map(), pending = null, speech = { state: 'idle' };
const hour = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const defaultShift = (now = new Date()) => (now.getHours() >= 6 && now.getHours() < 18 ? 'D' : 'N');

export async function openHandoff(render) {
  if (loaded) return;
  const { report: held, wiped } = await loadHandoff();
  report = held; loaded = true;
  if (wiped) wipedNotice = 'Last shift’s handoff was wiped: its ' + WIPE_HOURS + ' hours were up.';
  for (const bed of report?.beds || []) for (const photo of bed.photos) { const blob = await getHandoffPhoto(photo.id); if (blob) photoUrls.set(photo.id, URL.createObjectURL(blob)); }
  render();
}
// Checked on every render and every action: past its hours, a report goes, even with the tab open.
async function enforceWipe() { if (report && Date.now() >= expiresAt(report)) { await wipeAll(); wipedNotice = 'This handoff was wiped: its ' + WIPE_HOURS + ' hours were up.'; } }
async function wipeAll() { for (const url of photoUrls.values()) URL.revokeObjectURL(url); photoUrls = new Map(); report = null; refusals = {}; pending = null; await wipeHandoff(); }
const save = () => saveHandoff(report);

const refusalNote = (key, bedId, { h, button, valueAttr }) => {
  const list = refusals[bedId + '|' + key];
  if (!list) return '';
  return '<p class="refusal handoff-refusal">Not saved: ' + list.map(item => h(item.sign) + ' (“' + h(item.words) + '”)' +
    (item.name ? ' ' + button('It’s not a name', 'handoff-not-name', 'class="text-button" ' + valueAttr(item.words)) : '')).join(', ') + '.</p>';
};

function fieldMarkup(bed, field, tools) {
  const { h } = tools, value = bed.fields[field.key] || '', name = 'f-' + field.key, label = '<span>' + h(field.label) + '</span>';
  const input = field.kind === 'choice'
    ? '<select name="' + name + '" data-handoff-field="' + field.key + '" data-bed="' + h(bed.id) + '"><option value="">—</option>' + field.options.map(option => '<option' + (option === value ? ' selected' : '') + '>' + h(option) + '</option>').join('') + '</select>'
    : field.long ? '<textarea name="' + name + '" rows="2" maxlength="240" data-handoff-field="' + field.key + '" data-bed="' + h(bed.id) + '" placeholder="' + h(field.hint || '') + '">' + h(value) + '</textarea>'
      : '<input name="' + name + '" maxlength="240" autocomplete="off" data-handoff-field="' + field.key + '" data-bed="' + h(bed.id) + '" placeholder="' + h(field.hint || '') + '" value="' + h(value) + '">';
  return '<label class="handoff-field' + (field.short ? ' short' : '') + (field.long ? ' long' : '') + '">' + label + input + refusalNote(field.key, bed.id, tools) + '</label>';
}

export function handoffScreen(tools) {
  const { h, button, valueAttr } = tools;
  void enforceWipe();
  const notice = '<div class="notice handoff-terms" role="note"><b>On this phone only.</b> Not sent anywhere, not in backups, not on the department server. ' +
    'Wiped ' + WIPE_HOURS + ' hours after you start it, or when you tap Handed off. It is still patient information: use bed numbers, never names. ' +
    'Check your hospital’s personal-device policy before using it with real patients.</div>';
  const head = '<div class="intro"><div><div class="eyebrow">HANDOFF</div><h1>Your handoff</h1></div></div>' + (wipedNotice ? '<div class="notice" role="status">' + h(wipedNotice) + '</div>' : '');
  if (!loaded) return head + notice + '<p class="subtle">Opening…</p>';
  if (!report) return head + notice + '<section class="panel handoff-start"><h2>Start this shift’s handoff</h2><p>Add each of your beds, then type, dictate or photograph what the oncoming therapist needs.</p>' +
    '<div class="actions wrap">' + button('Start a night handoff', 'handoff-start', 'class="primary big" ' + valueAttr('N')) + button('Start a day handoff', 'handoff-start', 'class="secondary" ' + valueAttr('D')) + '</div></section>';
  const beds = report.beds.map(bed => '<article class="panel handoff-bed" data-bed-card="' + h(bed.id) + '"><header><h2>Bed ' + h(bed.bed) + '</h2>' + (bed.fields.support ? '<span class="badge">' + h(bed.fields.support) + '</span>' : '') + '</header>' +
    '<div class="handoff-grid">' + TEMPLATE.map(field => fieldMarkup(bed, field, tools)).join('') + '</div>' +
    (bed.photos.length ? '<div class="handoff-photos">' + bed.photos.map(photo => '<figure><img alt="Boxed-out photo for bed ' + h(bed.bed) + '" src="' + h(photoUrls.get(photo.id) || '') + '"><figcaption>' + h(photo.boxed + ' boxed out') + ' ' +
      button('Remove', 'handoff-photo-drop', 'class="text-button" ' + valueAttr(bed.id + '|' + photo.id)) + '</figcaption></figure>').join('') + '</div>' : '') +
    '<div class="actions wrap">' + '<label class="secondary link-button handoff-photo-pick">Add a photo<input type="file" accept="image/*" capture="environment" data-handoff-photo="' + h(bed.id) + '"></label>' +
    button('Remove bed ' + h(bed.bed), 'handoff-bed-remove', 'class="text-button" ' + valueAttr(bed.id)) + '</div></article>').join('');
  return head + notice +
    '<div class="handoff-bar"><span class="subtle">' + (report.shift === 'N' ? 'Night' : 'Day') + ' handoff · started ' + h(hour(report.startedAt)) + ' · wiped at ' + h(hour(expiresAt(report))) + '</span>' +
    '<div class="actions wrap">' + button('🎙 Dictate', 'handoff-dictate', 'class="primary"') + button('Show at bedside', 'handoff-bedside', 'class="secondary"') + button('Print', 'handoff-print', 'class="secondary"') +
    button('Handed off: wipe it', 'handoff-wipe', 'class="danger"') + '</div></div>' +
    '<form class="panel handoff-add" data-form="handoff-bed"><label>Add a bed<input name="bed" maxlength="8" autocomplete="off" inputmode="text" placeholder="12, 412-2, 7B" required></label><button class="primary">Add</button></form>' +
    (beds || '<p class="subtle">No beds yet.</p>') + printSheet(tools);
}

// What prints: only this, laid out one bed per block. Screen CSS hides it; print CSS shows only it.
function printSheet({ h }) {
  if (!report) return '';
  return '<section class="handoff-print" aria-hidden="true"><h1>Handoff · ' + (report.shift === 'N' ? 'Night' : 'Day') + ' · ' + h(new Date(report.startedAt).toLocaleDateString()) + '</h1>' +
    '<p>Built on one therapist’s phone; wiped at ' + h(hour(expiresAt(report))) + '. Bed numbers only. Shred after handoff.</p>' +
    sheetOf(report).map(bed => '<div class="print-bed"><h2>Bed ' + h(bed.bed) + '</h2><dl>' + bed.lines.map(([label, value]) => '<dt>' + h(label) + '</dt><dd>' + h(value) + '</dd>').join('') + '</dl>' +
      (bed.photos ? '<p>' + bed.photos + ' photo' + (bed.photos === 1 ? '' : 's') + ' on the phone</p>' : '') + '</div>').join('') + '</section>';
}

export function handoffDialog(type, tools) {
  const { h, button, shell } = tools;
  if (type === 'handoff-bedside') return shell('Handoff', '<div class="bedside">' + sheetOf(report || { beds: [] }).map(bed => '<section><h3>Bed ' + h(bed.bed) + '</h3><dl>' +
    bed.lines.map(([label, value]) => '<dt>' + h(label) + '</dt><dd>' + h(value) + '</dd>').join('') + '</dl></section>').join('') + '</div>', HANDOFF_NOTE);
  if (type === 'handoff-wipe') return shell('Handed off?', '<p>This deletes the whole handoff from this phone: every bed, every note and every photo. It cannot be brought back.</p>' +
    '<div class="actions">' + button('Yes, wipe it now', 'handoff-wipe-yes', 'class="danger"') + button('Not yet', 'close', 'class="secondary"') + '</div>', HANDOFF_NOTE);
  if (type === 'handoff-photo') {
    if (!pending?.canvas) return shell('Boxing out the photo', '<p role="status">' + h(pending?.step || 'Working…') + '</p><div class="progress"><i></i></div><p class="subtle">Nothing leaves this phone. The original photo is not kept.</p>', HANDOFF_NOTE);
    const found = Object.entries(pending.settings || {});
    return shell('Look before you keep it', '<p><b>' + pending.boxed + ' words boxed out</b>, ' + pending.kept + ' kept. The reader cannot see faces, barcodes or handwriting it cannot read. ' +
      'Drag across anything else to box it out.</p><div class="mask-stage"><canvas id="handoff-mask" aria-label="The boxed-out photo. Drag to box out more."></canvas></div>' +
      (found.length ? '<fieldset class="handoff-found"><legend>Settings read from the photo</legend>' + found.map(([key, value]) => '<label class="check"><input type="checkbox" name="use-' + h(key) + '" checked> ' +
        h((TEMPLATE.find(field => field.key === key)?.label || key) + ': ' + value) + '</label>').join('') + '<p class="subtle">Ticked ones are put into bed ' + h(pending.bedLabel) + '. Check each against the vent.</p></fieldset>' : '') +
      '<div class="actions">' + button('Keep it', 'handoff-photo-keep', 'class="primary"') + button('Throw it away', 'handoff-photo-cancel', 'class="secondary"') + '</div>', HANDOFF_NOTE);
  }
  if (type === 'handoff-dictate') {
    if (speech.state === 'idle') return shell('Dictate', '<p>Dictation runs on this phone. The first time, it downloads a speech model (about 77 MB, once) from Hugging Face. ' +
      'Your voice is never sent anywhere: only the model is downloaded, and after that it works without a signal.</p><p class="subtle">Say “bed 12”, then what you would say at handoff: mode, rate, tidal volume, PEEP, FiO2, last gas, treatments, plan.</p>' +
      '<div class="actions">' + button('Download it and start', 'handoff-speech-load', 'class="primary"') + button('Not now', 'close', 'class="secondary"') + '</div>', HANDOFF_NOTE);
    if (speech.state === 'loading') return shell('Getting dictation ready', '<p role="status">' + h(speech.progress || 'Downloading the speech model…') + '</p><div class="progress"><i></i></div>', HANDOFF_NOTE);
    if (speech.state === 'ready') return shell('Dictate', '<p>Tap and talk. Tap again when you are done.</p><div class="actions center">' + button('● Start talking', 'handoff-rec', 'class="primary big"') + '</div>', HANDOFF_NOTE);
    if (speech.state === 'recording') return shell('Listening', '<div class="recording"><span class="rec-dot"></span>Talking…</div><div class="actions center">' + button('■ Done', 'handoff-rec-stop', 'class="primary big"') + '</div>', HANDOFF_NOTE);
    if (speech.state === 'working') return shell('Writing it down', '<p role="status">Turning what you said into text, on this phone…</p><div class="progress"><i></i></div>', HANDOFF_NOTE);
    if (speech.state === 'heard') {
      const found = screenHandoff(speech.text, report?.notNames || []), parsed = parseDictation(speech.text);
      return shell('What was heard', '<form data-form="handoff-heard"><label>Fix anything it got wrong<textarea name="text" rows="6" maxlength="3000">' + h(speech.text) + '</textarea></label>' +
        (found.length ? '<p class="refusal">Take these out first: ' + found.map(item => h(item.sign) + ' (“' + h(item.words) + '”)').join(', ') + '.</p>' : '') +
        '<div class="heard-plan">' + parsed.map(bed => '<p><b>' + (bed.bed ? 'Bed ' + h(bed.bed) : 'No bed said') + ':</b> ' + h(Object.entries(bed.fields).map(([key, value]) => (TEMPLATE.find(field => field.key === key)?.label || key) + ' ' + value).join(' · ') || 'nothing placed') +
          (bed.rest ? ' <span class="subtle">· not placed: ' + h(bed.rest) + '</span>' : '') + '</p>').join('') + '</div>' +
        '<div class="actions">' + button('Check it again', 'handoff-reread', 'class="secondary"') + '<button class="primary"' + (found.length ? ' disabled' : '') + '>Put it in the handoff</button></div></form>', HANDOFF_NOTE);
    }
  }
  return '';
}

// Every Handoff action. Returns true when it handled one.
export async function handoffAct(action, value, tools) {
  const { ui, render } = tools;
  if (!action.startsWith('handoff-')) return false;
  await enforceWipe();
  switch (action) {
    case 'handoff-start': report = newReport(Date.now(), value === 'D' ? 'D' : value === 'N' ? 'N' : defaultShift()); wipedNotice = ''; await save(); break;
    case 'handoff-bed-remove': report = removeBed(report, value); await save(); break;
    case 'handoff-not-name': report = allowNotName(report, value); for (const key of Object.keys(refusals)) refusals[key] = refusals[key].filter(item => item.words !== value); await save(); break;
    case 'handoff-bedside': ui.dialog = { type: 'handoff-bedside' }; break;
    case 'handoff-print': render(); setTimeout(() => window.print(), 50); return true;
    case 'handoff-wipe': ui.dialog = { type: 'handoff-wipe' }; break;
    case 'handoff-wipe-yes': await wipeAll(); ui.dialog = null; ui.notice = 'The handoff is wiped from this phone.'; break;
    case 'handoff-photo-drop': { const [bedId, photoId] = String(value).split('|'); await dropHandoffPhoto(photoId); URL.revokeObjectURL(photoUrls.get(photoId) || ''); photoUrls.delete(photoId);
      report = { ...report, beds: report.beds.map(bed => bed.id === bedId ? { ...bed, photos: bed.photos.filter(photo => photo.id !== photoId) } : bed) }; await save(); break; }
    case 'handoff-photo-cancel': pending = null; ui.dialog = null; break;
    case 'handoff-photo-keep': {
      const { canvasBlob } = await import('./handoff-photo.js');
      const blob = await canvasBlob(pending.canvas), photoId = crypto.randomUUID();
      await putHandoffPhoto(photoId, blob); photoUrls.set(photoId, URL.createObjectURL(blob));
      const use = Object.fromEntries(Object.entries(pending.settings || {}).filter(([key]) => document.querySelector('[name="use-' + key + '"]')?.checked));
      report = { ...report, beds: report.beds.map(bed => bed.id === pending.bedId ? { ...bed, photos: [...bed.photos, { id: photoId, boxed: pending.boxed }] } : bed) };
      if (Object.keys(use).length) report = setFields(report, pending.bedId, use).report;
      await save(); pending = null; ui.dialog = null; break;
    }
    case 'handoff-dictate': ui.dialog = { type: 'handoff-dictate' }; break;
    case 'handoff-reread': speech = { state: 'heard', text: String(document.querySelector('dialog [name="text"]')?.value || '') }; break;
    case 'handoff-speech-load': {
      speech = { state: 'loading' }; render();
      const { loadSpeech } = await import('./dictation.js');
      try { await loadSpeech((loaded, total) => { speech.progress = 'Downloading the speech model… ' + Math.round(loaded / 1e6) + (total ? ' of ' + Math.round(total / 1e6) : '') + ' MB'; if (ui.dialog?.type === 'handoff-dictate') render(); }); speech = { state: 'ready' }; }
      catch (error) { speech = { state: 'idle' }; throw new Error('Dictation could not start: ' + error.message); }
      break;
    }
    case 'handoff-rec': { const { startRecording } = await import('./dictation.js'); speech = { state: 'recording', recorder: await startRecording() }; break; }
    case 'handoff-rec-stop': {
      const { toSamples, transcribe } = await import('./dictation.js');
      const blob = await speech.recorder.stop(); speech = { state: 'working' }; render();
      try { speech = { state: 'heard', text: await transcribe(await toSamples(blob)) }; } catch (error) { speech = { state: 'ready' }; throw new Error('Nothing was written down: ' + error.message); }
      break;
    }
    default: return false;
  }
  render();
  return true;
}

// Typed fields save as soon as they change, each through the screen.
export async function handoffChange(target, tools) {
  if (target.dataset.handoffField && report) {
    const bedId = target.dataset.bed, key = target.dataset.handoffField, result = setFields(report, bedId, { [key]: target.value });
    report = result.report;
    if (result.refused.length) refusals[bedId + '|' + key] = result.refused[0].found; else delete refusals[bedId + '|' + key];
    await save();
    if (result.refused.length || key === 'support') tools.render();
    return true;
  }
  if (target.dataset.handoffPhoto && target.files?.[0] && report) {
    const bed = report.beds.find(entry => entry.id === target.dataset.handoffPhoto);
    pending = { bedId: bed.id, bedLabel: bed.bed, step: 'Starting…' };
    tools.ui.dialog = { type: 'handoff-photo' }; tools.render();
    const { maskPhoto } = await import('./handoff-photo.js');
    try { Object.assign(pending, await maskPhoto(target.files[0], step => { pending.step = step; tools.render(); })); }
    catch (error) { pending = null; tools.ui.dialog = null; throw error; }
    tools.render();
    return true;
  }
  return false;
}

export async function handoffSubmit(form, data, tools) {
  const { ui } = tools;
  if (form.dataset.form === 'handoff-bed') {
    const result = addBed(report, data.bed);
    if (!result.ok) { ui.notice = result.why; return true; }
    report = result.report; await save(); return true;
  }
  if (form.dataset.form === 'handoff-heard') {
    const text = String(data.text || '');
    if (screenHandoff(text, report.notNames).length) { speech = { state: 'heard', text }; return true; }
    const notes = [];
    for (const said of parseDictation(text)) {
      let bed = said.bed ? report.beds.find(entry => entry.bed === said.bed) : null;
      if (said.bed && !bed) { const added = addBed(report, said.bed); if (added.ok) { report = added.report; bed = report.beds.find(entry => entry.bed === said.bed); } }
      if (!bed) { if (said.rest || Object.keys(said.fields).length) notes.push((said.bed ? 'Bed ' + said.bed + ': ' : '') + [Object.values(said.fields).join(' '), said.rest].filter(Boolean).join(' ')); continue; }
      const fields = { ...said.fields };
      if (said.rest) fields.events = [bed.fields.events, fields.events, said.rest].filter(Boolean).join('; ');
      else if (fields.events && bed.fields.events) fields.events = bed.fields.events + '; ' + fields.events;
      report = setFields(report, bed.id, fields).report;
    }
    await save();
    speech = { state: 'ready' }; ui.dialog = null;
    ui.notice = notes.length ? 'Put in the handoff. Not placed (no bed said): ' + notes.join(' / ') : 'Put in the handoff. Check each bed.';
    return true;
  }
  return false;
}

// After the dialog is drawn: the boxed-out photo, and a finger drag that boxes out more.
export function afterHandoffRender() {
  const canvas = document.getElementById('handoff-mask');
  if (!canvas || !pending?.canvas) return;
  canvas.width = pending.canvas.width; canvas.height = pending.canvas.height;
  const context = canvas.getContext('2d');
  context.drawImage(pending.canvas, 0, 0);
  let start = null;
  const at = event => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; };
  canvas.onpointerdown = event => { start = at(event); canvas.setPointerCapture(event.pointerId); };
  canvas.onpointermove = event => { if (!start) return; const now = at(event); context.drawImage(pending.canvas, 0, 0); context.fillStyle = 'rgba(0,0,0,.6)'; context.fillRect(start.x, start.y, now.x - start.x, now.y - start.y); };
  canvas.onpointerup = event => { if (!start) return; const now = at(event); const box = { x: Math.min(start.x, now.x), y: Math.min(start.y, now.y), w: Math.abs(now.x - start.x), h: Math.abs(now.y - start.y) };
    if (box.w > 4 && box.h > 4) { const ctx = pending.canvas.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(box.x, box.y, box.w, box.h); pending.boxed++; }
    context.drawImage(pending.canvas, 0, 0); start = null; };
}
export { SUPPORT };
