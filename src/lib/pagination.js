// Shared pagination helper for public course listing and admin tables.
// Never trusts the raw query param — always clamps to a valid integer.
function parsePage(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    return 1;
  }
  return n;
}

function buildPagination(requestedPage, pageSize, total) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);

  return {
    page,
    pageSize,
    total,
    pageCount,
    hasPrev: page > 1,
    hasNext: page < pageCount,
    skip: (page - 1) * pageSize,
  };
}

module.exports = { parsePage, buildPagination };
