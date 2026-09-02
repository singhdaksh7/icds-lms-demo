// Temporary Hostinger↔TiDB network root-cause diagnostic.
// See README "Production Operations — Temporary Network Diagnostics" for
// the layered test design (DNS → generic HTTPS → bare TiDB HTTPS → TiDB
// driver → Prisma adapter) and removal plan. Never sends DATABASE_URL,
// the DB password, or DIAGNOSTIC_TOKEN in any response or log line.
const { DATABASE_URL, USE_TIDB_HTTP_ADAPTER } = require('../../config/env');
const { prisma } = require('../../config/db');
const { withTimeout, summarizeError, dnsLookup } = require('../../lib/diagnostics');

const PROBE_TIMEOUT_MS = 8000;
const GENERIC_HTTPS_URL = 'https://www.google.com';

let tidbHostname = null;
try {
  tidbHostname = new URL(DATABASE_URL).hostname;
} catch {
  tidbHostname = null;
}

// Bare HTTPS reachability probe: DNS + TCP + TLS handshake only, no
// credentials, no TiDB API call — just "does this HTTPS request complete
// at all". Uses the request's own AbortSignal.timeout as the real
// cancellation mechanism (not just an outer race), so a hung socket is
// actually torn down rather than left running in the background.
async function httpsProbe(url) {
  const start = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return { success: true, status: res.status, elapsedMs: Date.now() - start };
  } catch (err) {
    const isAbort = err.name === 'AbortError' || err.name === 'TimeoutError';
    return {
      success: false,
      timedOut: isAbort,
      error: summarizeError(err),
      elapsedMs: Date.now() - start,
    };
  }
}

async function getNetworkDiagnostics(req, res) {
  const report = {
    dbMode: USE_TIDB_HTTP_ADAPTER ? 'tidb-http-adapter' : 'standard-tcp',
    tidbHostname,
  };

  // A. DNS resolution for the TiDB gateway host.
  if (tidbHostname) {
    const dnsResult = await withTimeout(() => dnsLookup(tidbHostname), 5000, 'DNS_TIMEOUT');
    report.dns = dnsResult.ok
      ? { resolved: true, family: dnsResult.value.family, elapsedMs: dnsResult.elapsedMs }
      : {
          resolved: false,
          timedOut: Boolean(dnsResult.timedOut),
          error: dnsResult.error,
          elapsedMs: dnsResult.elapsedMs,
        };
  } else {
    report.dns = { resolved: false, error: 'Could not parse hostname from DATABASE_URL' };
  }

  // B. Generic external HTTPS — a stable, unrelated public host.
  report.genericHttps = { host: GENERIC_HTTPS_URL, ...(await httpsProbe(GENERIC_HTTPS_URL)) };

  // C. Bare TiDB HTTPS — same host as the driver uses, zero credentials.
  report.bareTidbHttps = tidbHostname
    ? await httpsProbe(`https://${tidbHostname}`)
    : { success: false, error: 'No TiDB hostname to probe' };

  // D. TiDB official serverless driver, independent of Prisma.
  const driverResult = await withTimeout(
    async () => {
      const { connect } = require('@tidbcloud/serverless');
      const connection = connect({ url: DATABASE_URL });
      await connection.execute('SELECT 1');
      return true;
    },
    PROBE_TIMEOUT_MS,
    'TIDB_DRIVER_TIMEOUT'
  );
  report.tidbServerlessDriver = driverResult.ok
    ? { success: true, elapsedMs: driverResult.elapsedMs }
    : {
        success: false,
        timedOut: Boolean(driverResult.timedOut),
        error: driverResult.error,
        elapsedMs: driverResult.elapsedMs,
      };

  // E. Prisma Client via the same adapter the live app uses.
  const prismaResult = await withTimeout(
    () => prisma.$queryRaw`SELECT 1`,
    PROBE_TIMEOUT_MS,
    'PRISMA_TIMEOUT'
  );
  report.prismaAdapter = prismaResult.ok
    ? { success: true, elapsedMs: prismaResult.elapsedMs }
    : {
        success: false,
        timedOut: Boolean(prismaResult.timedOut),
        error: prismaResult.error,
        elapsedMs: prismaResult.elapsedMs,
      };

  console.log('NETWORK_DIAGNOSTICS', JSON.stringify(report));

  res.status(200).json({ success: true, timestamp: new Date().toISOString(), diagnostics: report });
}

module.exports = { getNetworkDiagnostics };
