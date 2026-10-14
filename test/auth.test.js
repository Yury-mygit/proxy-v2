const test = require('node:test');
const assert = require('node:assert/strict');

const { authProxyHeader } = require('../app/auth');

const credentials = {
  login: 'proxy-v2@test.raft',
  password: 'test-password',
};

function basic(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;
}

test('accepts the configured login and password', () => {
  assert.equal(
    authProxyHeader(basic(credentials.login, credentials.password), credentials),
    credentials.login,
  );
});

test('rejects a wrong login or password', () => {
  assert.equal(authProxyHeader(basic('other@test.raft', credentials.password), credentials), null);
  assert.equal(authProxyHeader(basic(credentials.login, 'wrong'), credentials), null);
});

test('rejects bearer authentication', () => {
  assert.equal(authProxyHeader('Bearer old-token', credentials), null);
});
