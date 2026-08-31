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
  session: { cookieName: 'orangehrm' },
  successStatusCodes: [302, 303],
};

// FIX-1 extractor remains fully supported.
{
  const normalized = normalizeAuthProfileConfig('login_http_json', {
    ...base,
    preflight: {
      enabled: true,
      method: 'GET',
      path: '/web/index.php/auth/login',
      preserveCookies: true,
      extract: {
        kind: 'HTML_INPUT_BY_NAME',
        name: '_token',
        injectField: '_token',
      },
    },
  });

  assert.deepEqual(normalized.preflight.extract, {
    kind: 'HTML_INPUT_BY_NAME',
    name: '_token',
    injectField: '_token',
  });
}

// FIX-1.1 generic server-rendered/component attribute extractor.
{
  const normalized = normalizeAuthProfileConfig('login_http_json', {
    ...base,
    preflight: {
      enabled: true,
      method: 'GET',
      path: '/web/index.php/auth/login',
      preserveCookies: true,
      extract: {
        kind: 'HTML_ATTRIBUTE_BY_TAG',
        tag: 'AUTH-LOGIN',
        attribute: ':token',
        injectField: '_token',
      },
    },
  });

  assert.deepEqual(normalized.preflight.extract, {
    kind: 'HTML_ATTRIBUTE_BY_TAG',
    tag: 'auth-login',
    attribute: ':token',
    injectField: '_token',
  });
  assert.equal(normalized.targetMode, 'runtime_origin');
  assert.deepEqual(normalized.successStatusCodes, [302, 303]);
}

// No arbitrary selectors/scripts: exact tag and attribute names only.
assert.throws(
  () => normalizeAuthProfileConfig('login_http_json', {
    ...base,
    preflight: {
      enabled: true,
      path: '/login',
      extract: {
        kind: 'HTML_ATTRIBUTE_BY_TAG',
        tag: 'auth-login script',
        attribute: ':token',
        injectField: '_token',
      },
    },
  }),
  (error) => error?.code === 'INVALID_AUTH_HTML_TAG',
);

assert.throws(
  () => normalizeAuthProfileConfig('login_http_json', {
    ...base,
    preflight: {
      enabled: true,
      path: '/login',
      extract: {
        kind: 'HTML_ATTRIBUTE_BY_TAG',
        tag: 'auth-login',
        attribute: 'token=value',
        injectField: '_token',
      },
    },
  }),
  (error) => error?.code === 'INVALID_AUTH_HTML_ATTRIBUTE',
);

assert.throws(
  () => normalizeAuthProfileConfig('login_http_json', {
    ...base,
    preflight: {
      enabled: true,
      path: '/login',
      extract: {
        kind: 'CSS_SELECTOR',
        selector: 'auth-login[:token]',
        injectField: '_token',
      },
    },
  }),
  (error) => error?.code === 'INVALID_AUTH_PREFLIGHT_EXTRACT_KIND',
);

// Legacy token mode is unchanged when resultMode is absent.
{
  const legacy = normalizeAuthProfileConfig('login_http_json', {
    targetMode: 'runtime_origin',
    path: '/login',
    bodyEncoding: 'json',
    usernameField: 'email',
    passwordField: 'password',
    tokenSource: 'json',
    tokenJsonPath: 'accessToken',
    targetHeader: 'Authorization',
    scheme: 'Bearer',
  });
  assert.equal(legacy.resultMode, undefined);
  assert.equal(legacy.tokenJsonPath, 'accessToken');
}

console.log('Foundation 07.7.8-A FIX-1.1 Gateway HTML Attribute CSRF config tests passed ✅');
