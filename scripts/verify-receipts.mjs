// Independent local verification of a receipt export or workspace backup. No content is uploaded.
import { readFile } from 'node:fs/promises';
import { verifyReceipts } from '../src/audit.js';

const [file, checkpoint = ''] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node scripts/verify-receipts.mjs EXPORT.json [FULL_CHECKPOINT_HASH]');
  process.exitCode = 2;
} else {
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    const events = saved.events || saved.state?.events;
    const result = await verifyReceipts(events, checkpoint);
    console.log(JSON.stringify({ ...result, assurance:checkpoint ? 'Checked against the supplied checkpoint; its origin must be trusted independently.' :
      'Internal consistency only. Without a separately retained checkpoint, tail deletion or complete replacement cannot be excluded.',
      identity:'Selected profiles and device times are not authenticated identities or trusted timestamps.' }, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch {
    // Do not echo malformed input or sensitive file contents into a diagnostic log.
    console.error('Could not read a valid receipt export or workspace backup.');
    process.exitCode = 2;
  }
}
