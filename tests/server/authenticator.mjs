// A software authenticator for the tests: real P-256 keys, real signatures, real CBOR.
//
// It stands in for a phone, not for the server. Every response it produces is checked by the actual
// @simplewebauthn/server verification code, so a test that passes here means the server accepted a genuinely signed
// assertion — not that a stub said yes. What it cannot show is a real phone: no Face ID, no fingerprint, no device
// passcode, no platform authenticator and no browser. Those remain untested until somebody holds a phone.
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const b64url = buffer => Buffer.from(buffer).toString('base64url');
const COSE_ES256 = (x, y) => isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(x)], [-3, new Uint8Array(y)]]));

export function authenticator({ rpId = 'localhost', origin = 'http://localhost:5173', userVerified = true } = {}) {
  const keys = new Map();          // credentialId -> { privateKey, counter }
  const rpIdHash = createHash('sha256').update(rpId).digest();

  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
  const flags = attested => (0x01 | (userVerified ? 0x04 : 0x00) | (attested ? 0x40 : 0x00));
  const counterBytes = value => { const buffer = Buffer.alloc(4); buffer.writeUInt32BE(value); return buffer; };

  return {
    credentialIds: () => [...new Set([...keys.values()].map(entry => entry.id))],

    // The create ceremony. options is the PublicKeyCredentialCreationOptionsJSON the server sent.
    register(options, { credentialId = 'cred-' + randomBytes(8).toString('hex') } = {}) {
      const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = publicKey.export({ format: 'jwk' });
      const cose = COSE_ES256(Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url'));
      const id = Buffer.from(credentialId, 'utf8');
      const authData = Buffer.concat([rpIdHash, Buffer.from([flags(true)]), counterBytes(0),
        Buffer.alloc(16), Buffer.from([id.length >> 8, id.length & 0xff]), id, Buffer.from(cose)]);
      const attestationObject = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]]));
      // Stored under the credential ID the server will see and under the readable name a test passes in.
      const entry = { privateKey, counter: 0, id: b64url(id) };
      keys.set(b64url(id), entry);
      keys.set(credentialId, entry);
      return { id: b64url(id), rawId: b64url(id), type: 'public-key', clientExtensionResults: {},
        authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64url(clientData('webauthn.create', options.challenge)),
          attestationObject: b64url(attestationObject), transports: ['internal'] } };
    },

    // The get ceremony. Pass { corrupt: true } to sign the wrong bytes, which is what a wrong finger or a tampered
    // response looks like to the server: a well-formed message with a signature that does not check out.
    authenticate(options, { credentialId = null, corrupt = false, userHandle = null } = {}) {
      const asked = credentialId || (options.allowCredentials?.[0]?.id ?? [...keys.values()][0]?.id);
      const key = keys.get(asked);
      if (!key) throw new Error('this authenticator holds no such credential: ' + asked);
      const id = key.id;
      key.counter += 1;
      const authData = Buffer.concat([rpIdHash, Buffer.from([flags(false)]), counterBytes(key.counter)]);
      const client = clientData('webauthn.get', options.challenge);
      const signed = Buffer.concat([authData, createHash('sha256').update(corrupt ? Buffer.from('not the real client data') : client).digest()]);
      const signature = createSign('sha256').update(signed).sign(key.privateKey);
      return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64url(client), authenticatorData: b64url(authData), signature: b64url(signature),
          userHandle: userHandle ? b64url(Buffer.from(userHandle, 'utf8')) : null } };
    }
  };
}

// What a person cancelling the prompt looks like from the server's side: nothing arrives.
export const cancelled = () => undefined;
