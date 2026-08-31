import assert from 'node:assert/strict';
import { normalizeAuthProfileConfig } from '../src/lib/authProfileConfig.js';

const base = {
  targetMode: 'runtime_origin',
  path: '/web/index.php/auth/validate',
  bodyEncoding: 'form',
  usernameField: 'username',
  passwordField: 'password',
  staticBody: {},
  resultMode: 'cookie_session',
  preflight: {
    enabled: true,
    method: 'GET',
    path: '/web/index.php/auth/login',
    preserveCookies: true,
    extract: {
      kind: 'HTML_ATTRIBUTE_BY_TAG',
      tag: 'auth-login',
      attribute: ':token',
      injectField: '_token',
    },
  },
  successStatusCodes: [302, 303],
};

{
  const normalized = normalizeAuthProfileConfig('login_http_json', {
    ...base,
    session: {
      cookieName: 'orangehrm',
      requireRotation: true,
    },
  });

  assert.deepEqual(normalized.session, {
    cookieName: 'orangehrm',
    requireRotation: true,
  });
}

{
  const normalized = normalizeAuthProfileConfig('login_http_json', {
    ...base,
    session: {
      cookieName: 'orangehrm',
    },
  });

  assert.deepEqual(normalized.session, {
    cookieName: 'orangehrm',
    requireRotation: false,
  });
}

assert.throws(
  () => normalizeAuthProfileConfig('login_http_json', {
    ...base,
    session: {
      cookieName: 'orangehrm',
      requireRotation: 'true',
    },
  }),
  (error) => error?.code === 'INVALID_AUTH_COOKIE_SESSION_REQUIRE_ROTATION',
);

assert.throws(
  () => normalizeAuthProfileConfig('login_http_json', {
    ...base,
    session: {
      requireRotation: true,
    },
  }),
  (error) => error?.code === 'AUTH_COOKIE_ROTATION_COOKIE_NAME_REQUIRED',
);

// Legacy token behavior remains untouched.
{
  const legacy = normalizeAuthProfileConfig('login_http_json', {
    targetMode: 'runtime_origin',
    path: '/login',
    bodyEncoding: 'json',
    usernameField: 'email',
    passwordField: 'password',
    tokenSource: 'json',
    tokenJsonPath: 'accessToken',
  });
  assert.equal(legacy.resultMode, undefined);
  assert.equal(legacy.session, undefined);
}

console.log('Foundation 07.7.8-A FIX-1.2 Gateway session confirmation tests passed ✅');
