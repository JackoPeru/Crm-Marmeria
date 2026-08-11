const { execFileSync } = require('child_process');

const TAILSCALE_COMMAND = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale';
const UPSTREAM = 'https+insecure://127.0.0.1:3001';

const runTailscale = (args) => execFileSync(TAILSCALE_COMMAND, args, {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30000,
});

const normalizeDnsName = (value) => String(value || '').trim().replace(/\.+$/, '');

const inspectTailscale = (run = runTailscale) => {
  let rawStatus;
  try {
    rawStatus = run(['status', '--json']);
  } catch (error) {
    return {
      ok: false,
      available: false,
      error: `Tailscale non disponibile: ${error.message || error}`,
      command: `tailscale serve --bg --yes ${UPSTREAM}`,
    };
  }

  let status;
  try {
    status = JSON.parse(String(rawStatus));
  } catch {
    return {
      ok: false,
      available: true,
      error: 'Risposta tailscale status --json non valida',
      command: `tailscale serve --bg --yes ${UPSTREAM}`,
    };
  }

  const dnsName = normalizeDnsName(status.Self?.DNSName);
  const backendState = String(status.BackendState || '').trim();
  const certDomains = Array.isArray(status.CertDomains)
    ? status.CertDomains.map(normalizeDnsName).filter(Boolean)
    : [];
  const httpsEnabled = Boolean(dnsName && certDomains.includes(dnsName));
  let serveStatus = null;
  try {
    serveStatus = String(run(['serve', 'status'])).trim();
  } catch (error) {
    serveStatus = `Diagnostica Serve non disponibile: ${error.message || error}`;
  }

  return {
    ok: Boolean(dnsName) && (!backendState || backendState === 'Running') && httpsEnabled,
    available: true,
    backendState: backendState || null,
    dnsName: dnsName || null,
    httpsEnabled,
    certDomains,
    url: dnsName ? `https://${dnsName}/` : null,
    serveStatus,
    upstream: UPSTREAM,
    command: `tailscale serve --bg --yes ${UPSTREAM}`,
    note: 'Il certificato attendibile vale per URL MagicDNS, non per IP 100.x.',
    error: !dnsName
      ? 'MagicDNS non disponibile: nessuna modifica eseguita'
      : !httpsEnabled
        ? 'Certificati HTTPS Tailscale non abilitati. Apri https://login.tailscale.com/admin/dns e abilita HTTPS Certificates; nessuna modifica eseguita.'
        : undefined,
  };
};

const enableTailscaleServe = (run = runTailscale) => {
  const diagnostic = inspectTailscale(run);
  if (!diagnostic.ok || !diagnostic.dnsName) {
    const error = new Error(diagnostic.error || 'MagicDNS/Tailscale non pronto: nessuna modifica eseguita');
    error.diagnostic = diagnostic;
    throw error;
  }
  const output = String(run(['serve', '--bg', '--yes', UPSTREAM])).trim();
  return { ...diagnostic, enabled: true, enableOutput: output };
};

const main = () => {
  const mode = process.argv[2] || '--check';
  if (mode === '--check') {
    console.log(JSON.stringify(inspectTailscale(), null, 2));
    return;
  }
  if (mode === '--enable') {
    try {
      console.log(JSON.stringify(enableTailscaleServe(), null, 2));
    } catch (error) {
      console.error(JSON.stringify({ ok: false, error: error.message, diagnostic: error.diagnostic || null }, null, 2));
      process.exitCode = 1;
    }
    return;
  }
  console.error('Uso: node server/tailscale-serve.js --check|--enable');
  process.exitCode = 2;
};

if (require.main === module) main();

module.exports = { UPSTREAM, inspectTailscale, enableTailscaleServe, normalizeDnsName };
