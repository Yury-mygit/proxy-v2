const crypto = require('node:crypto');

function safeEqual(actual, expected) {
  const left = Buffer.from(actual, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authProxyHeader(headerValue, credentials) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const [scheme, payload] = headerValue.split(' ', 2);
  if (!scheme || !payload) return null;
  if (scheme.toLowerCase() !== 'basic') return null;

  let decoded;
  try {
    decoded = Buffer.from(payload, 'base64').toString('utf8');
  } catch {
    return null;
  }
  const idx = decoded.indexOf(':');
  if (idx <= 0) return null;
  const login = decoded.slice(0, idx);
  const password = decoded.slice(idx + 1);
  if (!safeEqual(login, credentials.login)) return null;
  if (!safeEqual(password, credentials.password)) return null;
  return login;
}

function authAdminHeader(headerValue, adminToken) {
  if (!adminToken || !headerValue) return false;
  const [scheme, payload] = headerValue.split(' ', 2);
  if (!scheme || !payload) return false;
  if (scheme.toLowerCase() !== 'bearer') return false;
  return payload === adminToken;
}

module.exports = { authProxyHeader, authAdminHeader };
