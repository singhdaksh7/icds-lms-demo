// Temporary Hostinger↔TiDB network root-cause diagnostic.
// See README "Production Operations — Temporary Network Diagnostics" for
// the layered test design (DNS → generic HTTPS → bare TiDB HTTPS → TiDB
// driver → Prisma adapter) and removal plan. Never sends DATABASE_URL,
// the DB password, or DIAGNOSTIC_TOKEN in any response or log line.
//
// Every layer is wrapped in withTimeout, whose own setTimeout is the thing
// that actually bounds this route's response time — AbortSignal/driver-
// level cancellation is attempted too, but is never trusted alone: if the
// underlying call ignores its abort signal and hangs, withTimeout's
// Promise.race still moves on and this route still responds on time. All
// five layers run in parallel so total wall time is bounded by the
// slowest single layer, not their sum.
const { DATABASE_URL, USE_TIDB_HTTP_ADAPTER } = require('../../config/env');
const { prisma } = require('../../config/db');
const { withTimeout, dnsLookup } = require('../../lib/diagnostics');

const PROBE_TIMEOUT_MS = 8000;
const GENERIC_HTTPS_URL = 'https://www.google.com';

let tidbHostname = null;
try {
  tidbHostname = new URL(DATABASE_URL).hostname;
} catch {
  tidbHostname = null;
}

function toReportEntry(result, extra) {
  if (result.ok) {
    return { success: true, elapsedMs: result.elapsedMs, ...extra };
  }
  return {
    success: false,
    timedOut: Boolean(result.timedOut),
    error: result.error || null,
    elapsedMs: result.elapsedMs,
  };
}

// Bare HTTPS reachability probe: DNS + TCP + TLS handshake only, no
// credentials, no TiDB API call — just "does this HTTPS request complete
// at all". AbortSignal is a best-effort cancellation attempt; the outer
// withTimeout() call site is what actually bounds this function's caller.
function httpsProbe(url) {
  return fetch(url, { method: 'GET', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }).then(
    (res) => ({ status: res.status })
  );
}

async function getNetworkDiagnostics(req, res) {
  const [dnsResult, genericHttpsResult, bareTidbHttpsResult, driverResult, prismaResult] =
    await Promise.all([
      tidbHostname
        ? withTimeout(() => dnsLookup(tidbHostname), 5000, 'DNS_TIMEOUT')
        : Promise.resolve({ ok: false, error: { message: 'no hostname to resolve' } }),

      withTimeout(() => httpsProbe(GENERIC_HTTPS_URL), PROBE_TIMEOUT_MS, 'GENERIC_HTTPS_TIMEOUT'),

      tidbHostname
        ? withTimeout(() => httpsProbe(`https://${tidbHostname}`), PROBE_TIMEOUT_MS, 'BARE_TIDB_HTTPS_TIMEOUT')
        : Promise.resolve({ ok: false, error: { message: 'no hostname to probe' } }),

      withTimeout(
        async () => {
          const { connect } = require('@tidbcloud/serverless');
          const connection = connect({ url: DATABASE_URL });
          await connection.execute('SELECT 1');
          return true;
        },
        PROBE_TIMEOUT_MS,
        'TIDB_DRIVER_TIMEOUT'
      ),

      withTimeout(() => prisma.$queryRaw`SELECT 1`, PROBE_TIMEOUT_MS, 'PRISMA_TIMEOUT'),
    ]);

  const report = {
    dbMode: USE_TIDB_HTTP_ADAPTER ? 'tidb-http-adapter' : 'standard-tcp',
    tidbHostname,
    dns: dnsResult.ok
      ? { resolved: true, family: dnsResult.value.family, elapsedMs: dnsResult.elapsedMs }
      : { resolved: false, timedOut: Boolean(dnsResult.timedOut), error: dnsResult.error, elapsedMs: dnsResult.elapsedMs },
    genericHttps: { host: GENERIC_HTTPS_URL, ...toReportEntry(genericHttpsResult, genericHttpsResult.ok ? { status: genericHttpsResult.value.status } : {}) },
    bareTidbHttps: toReportEntry(bareTidbHttpsResult, bareTidbHttpsResult.ok ? { status: bareTidbHttpsResult.value.status } : {}),
    tidbServerlessDriver: toReportEntry(driverResult),
    prismaAdapter: toReportEntry(prismaResult),
  };

  console.log('NETWORK_DIAGNOSTICS', JSON.stringify(report));

  res.status(200).json({ success: true, timestamp: new Date().toISOString(), diagnostics: report });
}

module.exports = { getNetworkDiagnostics };
