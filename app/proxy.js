const http = require('node:http');
const net = require('node:net');
const { URL } = require('node:url');
const { authProxyHeader } = require('./auth');

function parseConnectTarget(target) {
  if (!target) return null;

  let host;
  let portText;
  if (target.startsWith('[')) {
    const closingBracket = target.indexOf(']');
    if (closingBracket < 2 || target[closingBracket + 1] !== ':') return null;
    host = target.slice(1, closingBracket);
    portText = target.slice(closingBracket + 2);
  } else {
    const separator = target.lastIndexOf(':');
    if (separator <= 0 || target.indexOf(':') !== separator) return null;
    host = target.slice(0, separator);
    portText = target.slice(separator + 1);
  }

  if (!/^\d+$/.test(portText)) return null;
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

class ProxyManager {
  constructor({ credentials, allowedHosts, audit }) {
    this.credentials = credentials;
    this.allowedHosts = allowedHosts;
    this.audit = audit;
    this.port = null;
    this.server = null;
    this.tunnels = new Map();
    this.nextId = 1;
    this.stats = {
      startedAt: null,
      totalRequests: 0,
      totalConnects: 0,
      totalBytesIn: 0,
      totalBytesOut: 0,
      authFailures: 0,
      forbidden: 0,
    };
  }

  hostAllowed(host) {
    if (!this.allowedHosts || this.allowedHosts.length === 0) return true;
    const h = host.toLowerCase();
    return this.allowedHosts.some((pat) => {
      if (pat === '*') return true;
      if (pat.startsWith('*.')) return h.endsWith(pat.slice(1));
      return h === pat;
    });
  }

  isListening() {
    return !!(this.server && this.server.listening);
  }

  state() {
    return {
      listening: this.isListening(),
      port: this.port,
      startedAt: this.stats.startedAt,
      activeTunnels: this.tunnels.size,
      ...this.stats,
    };
  }

  start(port) {
    if (this.isListening()) throw new Error('already listening');
    this.port = port;
    const server = http.createServer((req, res) => this.handleHttp(req, res));
    server.on('connect', (req, sock, head) => this.handleConnect(req, sock, head));
    server.on('clientError', (err, sock) => {
      try { sock.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {}
    });
    return new Promise((resolve, reject) => {
      const onError = (err) => { server.removeListener('listening', onListening); reject(err); };
      const onListening = () => {
        server.removeListener('error', onError);
        this.server = server;
        this.stats.startedAt = new Date().toISOString();
        this.audit.log({ kind: 'proxy.start', port });
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '0.0.0.0');
    });
  }

  async stop() {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    this.stats.startedAt = null;
    await new Promise((resolve) => srv.close(() => resolve()));
    for (const t of this.tunnels.values()) {
      try { t.client.destroy(); } catch {}
      try { t.upstream && t.upstream.destroy(); } catch {}
    }
    this.tunnels.clear();
    this.audit.log({ kind: 'proxy.stop' });
  }

  authReject(sock, reason) {
    this.stats.authFailures++;
    const body = 'Proxy authentication required';
    const resp =
      'HTTP/1.1 407 Proxy Authentication Required\r\n' +
      'Proxy-Authenticate: Basic realm="proxy-service"\r\n' +
      'Content-Length: ' + Buffer.byteLength(body) + '\r\n' +
      'Connection: close\r\n\r\n' + body;
    try { sock.end(resp); } catch {}
    this.audit.log({ kind: 'auth.fail', reason });
  }

  handleConnect(req, clientSock, head) {
    const remote = clientSock.remoteAddress;
    const target = req.url || '';
    const name = authProxyHeader(req.headers['proxy-authorization'], this.credentials);
    if (!name) return this.authReject(clientSock, 'connect:' + target);

    const parsedTarget = parseConnectTarget(target);
    if (!parsedTarget) {
      try { clientSock.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {}
      return;
    }
    const { host, port } = parsedTarget;
    if (!this.hostAllowed(host)) {
      this.stats.forbidden++;
      this.audit.log({ kind: 'forbidden', user: name, target });
      try { clientSock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); } catch {}
      return;
    }

    this.stats.totalConnects++;
    const id = this.nextId++;
    const tStart = Date.now();
    const upstream = net.connect(port, host);
    const tunnel = { id, user: name, host, port, client: clientSock, upstream, startedAt: tStart, bytesIn: 0, bytesOut: 0 };
    this.tunnels.set(id, tunnel);
    this.audit.log({ kind: 'connect.open', id, user: name, target, remote });

    const cleanup = (reason) => {
      if (!this.tunnels.has(id)) return;
      this.tunnels.delete(id);
      const dur = Date.now() - tStart;
      this.audit.log({
        kind: 'connect.close', id, user: name, target, durationMs: dur,
        bytesIn: tunnel.bytesIn, bytesOut: tunnel.bytesOut, reason,
      });
      try { clientSock.destroy(); } catch {}
      try { upstream.destroy(); } catch {}
    };

    upstream.on('connect', () => {
      try {
        clientSock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) upstream.write(head);
      } catch (e) { return cleanup('write-head:' + e.code); }
      upstream.on('data', (chunk) => { tunnel.bytesIn += chunk.length; this.stats.totalBytesIn += chunk.length; });
      clientSock.on('data', (chunk) => { tunnel.bytesOut += chunk.length; this.stats.totalBytesOut += chunk.length; });
      upstream.pipe(clientSock);
      clientSock.pipe(upstream);
    });

    upstream.on('error', (err) => {
      this.audit.log({ kind: 'connect.upstream_error', id, target, error: err.code || err.message });
      try { clientSock.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {}
      cleanup('upstream:' + (err.code || 'err'));
    });
    clientSock.on('error', () => cleanup('client-err'));
    upstream.on('end', () => cleanup('upstream-end'));
    clientSock.on('end', () => cleanup('client-end'));
  }

  handleHttp(req, res) {
    const remote = req.socket.remoteAddress;
    const name = authProxyHeader(req.headers['proxy-authorization'], this.credentials);
    if (!name) {
      this.stats.authFailures++;
      res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="proxy-service"', 'Content-Type': 'text/plain' });
      res.end('Proxy authentication required');
      this.audit.log({ kind: 'auth.fail', reason: 'http:' + req.url });
      return;
    }
    let target;
    try { target = new URL(req.url); } catch {
      res.writeHead(400); res.end('Bad request');
      return;
    }
    if (!this.hostAllowed(target.hostname)) {
      this.stats.forbidden++;
      this.audit.log({ kind: 'forbidden', user: name, target: target.hostname });
      res.writeHead(403); res.end('Forbidden');
      return;
    }
    this.stats.totalRequests++;
    const headers = { ...req.headers };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    const opts = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: target.pathname + target.search,
      headers,
    };
    const upstream = http.request(opts, (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.on('data', (c) => { this.stats.totalBytesIn += c.length; });
      upRes.pipe(res);
    });
    req.on('data', (c) => { this.stats.totalBytesOut += c.length; });
    upstream.on('error', (err) => {
      this.audit.log({ kind: 'http.upstream_error', target: target.hostname, error: err.code || err.message });
      try { res.writeHead(502); res.end('Bad gateway'); } catch {}
    });
    req.pipe(upstream);
    this.audit.log({ kind: 'http.request', user: name, method: req.method, target: target.hostname, remote });
  }
}

module.exports = { ProxyManager, parseConnectTarget };
