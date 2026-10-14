const { Audit } = require('./audit');
const { ProxyManager } = require('./proxy');
const { createAdmin } = require('./admin');
const { parseTokens } = require('./auth');

async function main() {
  const proxyPort = parseInt(process.env.PROXY_PORT || '8888', 10);
  const adminPort = parseInt(process.env.ADMIN_PORT || '8889', 10);
  const adminToken = process.env.ADMIN_TOKEN;
  const tokens = parseTokens(process.env.PROXY_TOKENS);
  const allowedHosts = (process.env.ALLOWED_HOSTS || '*')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const logFile = process.env.LOG_FILE || '/var/log/proxy-service/proxy.log';

  if (!adminToken) {
    console.error('ADMIN_TOKEN env is required');
    process.exit(2);
  }
  if (Object.keys(tokens).length === 0) {
    console.error('PROXY_TOKENS env is required (format: name1:tok1,name2:tok2)');
    process.exit(2);
  }

  const audit = new Audit({ logFile });
  const proxy = new ProxyManager({ tokens, allowedHosts, audit });

  const { server: adminServer } = createAdmin({ proxy, audit, adminToken, proxyPort });
  await new Promise((resolve) => adminServer.listen(adminPort, '0.0.0.0', resolve));
  console.log(`[admin] listening on :${adminPort}`);

  await proxy.start(proxyPort);
  console.log(`[proxy] listening on :${proxyPort}, users=${Object.keys(tokens).join(',')}, allow=${allowedHosts.join(',')}`);

  const shutdown = async () => {
    console.log('shutdown');
    try { await proxy.stop(); } catch {}
    adminServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
