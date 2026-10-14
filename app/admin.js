const http = require('node:http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { authAdminHeader } = require('./auth');

function createAdmin({ proxy, audit, adminToken, proxyPort }) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok', listening: proxy.isListening(), port: proxy.port });
  });

  const requireAuth = (req, res, next) => {
    if (!authAdminHeader(req.headers.authorization, adminToken)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  };

  app.get('/admin/stats', requireAuth, (req, res) => {
    res.json(proxy.state());
  });

  app.post('/admin/start', requireAuth, async (req, res) => {
    const port = parseInt((req.body && req.body.port) || proxyPort, 10);
    if (proxy.isListening()) return res.status(409).json({ error: 'already listening', state: proxy.state() });
    try {
      await proxy.start(port);
      res.json({ ok: true, state: proxy.state() });
    } catch (err) {
      res.status(500).json({ error: err.code || err.message });
    }
  });

  app.post('/admin/stop', requireAuth, async (req, res) => {
    if (!proxy.isListening()) return res.status(409).json({ error: 'not listening' });
    await proxy.stop();
    res.json({ ok: true });
  });

  app.get('/admin/logs', requireAuth, (req, res) => {
    const tail = parseInt(req.query.tail || '200', 10);
    res.json({ records: audit.tail(tail) });
  });

  app.use((req, res) => res.status(404).json({ error: 'not found' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/admin/logs/stream') return socket.destroy();
    if (!authAdminHeader(req.headers.authorization, adminToken)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Bearer\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    const sendInitial = () => {
      try { ws.send(JSON.stringify({ kind: 'hello', state: proxy.state() })); } catch {}
      for (const r of audit.tail(50)) {
        try { ws.send(JSON.stringify(r)); } catch {}
      }
    };
    const onRecord = (r) => {
      if (ws.readyState !== ws.OPEN) return;
      try { ws.send(JSON.stringify(r)); } catch {}
    };
    audit.on('record', onRecord);
    ws.on('close', () => audit.off('record', onRecord));
    sendInitial();
  });

  return { server };
}

module.exports = { createAdmin };
