const assert = require('assert');
const { UPSTREAM, enableTailscaleServe, inspectTailscale, normalizeDnsName } = require('./tailscale-serve');

const calls = [];
const run = (args) => {
  calls.push(args.join(' '));
  if (args[0] === 'status') return JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'crm-pc.example.ts.net.' }, CertDomains: ['crm-pc.example.ts.net'] });
  if (args[0] === 'serve' && args[1] === 'status') return 'No serve config';
  if (args[0] === 'serve' && args[1] === '--bg') return 'Serve configured';
  throw new Error(`Unexpected command: ${args.join(' ')}`);
};

assert.equal(normalizeDnsName('crm-pc.example.ts.net.'), 'crm-pc.example.ts.net');
const diagnostic = inspectTailscale(run);
assert.equal(diagnostic.ok, true);
assert.equal(diagnostic.url, 'https://crm-pc.example.ts.net/');
assert.equal(diagnostic.httpsEnabled, true);
assert.equal(diagnostic.upstream, UPSTREAM);
const enabled = enableTailscaleServe(run);
assert.equal(enabled.enabled, true);
assert.equal(calls.filter((call) => call === `serve --bg --yes ${UPSTREAM}`).length, 1);

let enableCalls = 0;
assert.throws(() => enableTailscaleServe((args) => {
  enableCalls += 1;
  if (args[0] === 'status') return JSON.stringify({ BackendState: 'Stopped', Self: {} });
  throw new Error('Serve must not run');
}), /MagicDNS non disponibile/);
assert.equal(enableCalls, 2);

assert.throws(() => enableTailscaleServe((args) => {
  if (args[0] === 'status') return JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'crm-pc.example.ts.net.' }, CertDomains: null });
  if (args[0] === 'serve' && args[1] === 'status') return 'No serve config';
  throw new Error('Serve must not run without HTTPS certificates');
}), /Certificati HTTPS Tailscale non abilitati/);
