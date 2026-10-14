function parseTokens(env) {
  const tokens = {};
  if (!env) return tokens;
  for (const pair of env.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const name = trimmed.slice(0, idx).trim();
    const token = trimmed.slice(idx + 1).trim();
    if (name && token) tokens[name] = token;
  }
  return tokens;
}

function authProxyHeader(headerValue, tokens) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const [scheme, payload] = headerValue.split(' ', 2);
  if (!scheme || !payload) return null;
  const lc = scheme.toLowerCase();
  if (lc === 'basic') {
    let decoded;
    try {
      decoded = Buffer.from(payload, 'base64').toString('utf8');
    } catch {
      return null;
    }
    const idx = decoded.indexOf(':');
    if (idx <= 0) return null;
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);
    if (tokens[user] && tokens[user] === pass) return user;
    return null;
  }
  if (lc === 'bearer') {
    for (const [name, tok] of Object.entries(tokens)) {
      if (tok === payload) return name;
    }
    return null;
  }
  return null;
}

function authAdminHeader(headerValue, adminToken) {
  if (!adminToken || !headerValue) return false;
  const [scheme, payload] = headerValue.split(' ', 2);
  if (!scheme || !payload) return false;
  if (scheme.toLowerCase() !== 'bearer') return false;
  return payload === adminToken;
}

module.exports = { parseTokens, authProxyHeader, authAdminHeader };
