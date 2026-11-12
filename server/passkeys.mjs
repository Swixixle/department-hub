// Enrollment, authentication and recovery. Implemented in server/passkeys.mjs; see docs/SIGN-IN.md.
import { Refused } from './api.mjs';
export async function handlePasskey() { throw new Refused(404, 'not found'); }
