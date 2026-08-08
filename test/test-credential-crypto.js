import assert from 'node:assert';
import { encryptCredentialPayload, decryptCredentialPayload } from '../src/security/credentialCrypto.js';

const key = Buffer.alloc(32, 7).toString('base64url');
const env = {
  AI_CREDENTIALS_ACTIVE_KEY_VERSION: 'v1',
  AI_CREDENTIALS_KEY_V1: key,
};

const encrypted = await encryptCredentialPayload(env, { apiKey: 'customer-secret-key', extra: 'value' });
assert.ok(encrypted.ciphertext);
assert.ok(encrypted.iv);
assert.strictEqual(encrypted.keyVersion, 'v1');
assert.ok(!encrypted.ciphertext.includes('customer-secret-key'));

const decrypted = await decryptCredentialPayload(env, encrypted);
assert.deepStrictEqual(decrypted, { apiKey: 'customer-secret-key', extra: 'value' });

await assert.rejects(
  () => decryptCredentialPayload({ ...env, AI_CREDENTIALS_KEY_V1: Buffer.alloc(32, 8).toString('base64url') }, encrypted),
  (err) => err?.code === 'AI_CREDENTIALS_DECRYPT_FAILED'
);

console.log('credential crypto tests passed ✅');
