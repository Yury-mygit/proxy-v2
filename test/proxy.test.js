const test = require('node:test');
const assert = require('node:assert/strict');

const { parseConnectTarget } = require('../app/proxy');

test('parses DNS and IPv4 CONNECT targets', () => {
  assert.deepEqual(parseConnectTarget('example.com:443'), { host: 'example.com', port: 443 });
  assert.deepEqual(parseConnectTarget('192.0.2.10:8443'), { host: '192.0.2.10', port: 8443 });
});

test('parses a bracketed IPv6 CONNECT target', () => {
  assert.deepEqual(
    parseConnectTarget('[2600:1901:0:5ae7::]:443'),
    { host: '2600:1901:0:5ae7::', port: 443 },
  );
});

test('rejects malformed targets and invalid ports', () => {
  assert.equal(parseConnectTarget('2600:1901:0:5ae7:::443'), null);
  assert.equal(parseConnectTarget('[2600:1901::1]'), null);
  assert.equal(parseConnectTarget('example.com:0'), null);
  assert.equal(parseConnectTarget('example.com:65536'), null);
});
