const { Audit } = require('./audit');
const { ProxyManager } = require('./proxy');
const { createAdmin } = require('./admin');

async function main() {
  const proxyPort = parseInt(process.env.PROXY_PORT || '8888', 10);
  const adminPort = parseInt(process.env.ADMIN_PORT || '8889', 10);
  const adminToken = process.env.ADMIN_TOKEN;
  const proxyLogin = process.env.PROXY_LOGIN;
  const proxyPassword = process.env.PROXY_PASSWORD;
  const allowedHosts = (process.env.ALLOWED_HOSTS || '*')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const logFile = process.env.LOG_FILE || '/var/log/proxy-service/proxy.log';

  if (!adminToken) {
    console.error('ADMIN_TOKEN env is required');
    process.exit(2);
  }
  if (!proxyLogin || !proxyPassword) {
    console.error('PROXY_LOGIN and PROXY_PASSWORD env are required');
    process.exit(2);
  }

  const audit = new Audit({ logFile });
  const proxy = new ProxyManager({
    credentials: { login: proxyLogin, password: proxyPassword },
    allowedHosts,
    audit,
  });

  const { server: adminServer } = createAdmin({ proxy, audit, adminToken, proxyPort });
  await new Promise((resolve) => adminServer.listen(adminPort, '0.0.0.0', resolve));
  console.log(`[admin] listening on :${adminPort}`);

  await proxy.start(proxyPort);
  console.log(`[proxy] listening on :${proxyPort}, auth=basic, allow=${allowedHosts.join(',')}`);

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
