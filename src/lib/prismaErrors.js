// Prisma error-code helpers that work whether the shared PrismaClient is
// using its normal TCP query engine (which normalizes DB errors into
// standard codes like `P2002`) or the TiDB Cloud HTTPS driver adapter
// (src/config/db.js), which — as of @tidbcloud/prisma-adapter@5.20.0 —
// does NOT normalize a unique-constraint violation into `P2002`; it
// surfaces the driver's raw DatabaseError instead, with the underlying
// MySQL error code only present in the message text. Verified empirically:
// P2025 (record-to-update/delete not found) IS still correctly synthesized
// by Prisma's query engine under the adapter, so only this one needs a
// message-based fallback.
function isUniqueConstraintError(err) {
  if (!err) return false;
  if (err.code === 'P2002') return true;
  // Raw MySQL "Duplicate entry" error code, as surfaced by
  // @tidbcloud/serverless's DatabaseError.
  return typeof err.message === 'string' && /Error 1062/.test(err.message);
}

module.exports = { isUniqueConstraintError };
