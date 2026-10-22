const { prisma } = require('../config/db');

class HomeBannerError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'HomeBannerError';
    this.status = status;
  }
}

const LIMITS = { title: 255, subtitle: 500, description: 5000, url: 500, label: 100 };

// Safe link/image target: site-relative ("/x", not "//x") or http(s) only.
function isSafeUrl(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v || /[\s<>"'`\\]/.test(v) || /[\u0000-\u001f]/.test(v)) return false;
  if (v.startsWith('/')) return !v.startsWith('//');
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}
function isTrue(v) {
  if (Array.isArray(v)) return v.some(isTrue);
  return v === true || v === 'true' || v === 'on' || v === '1' || v === 1;
}
function parseDate(v) {
  const s = str(v);
  if (!s) return { value: null };
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return { error: true };
  return { value: d };
}

// Pure. Returns { errors: string[], values }.
function validateBannerInput(input = {}) {
  const errors = [];
  const values = {};
  const optText = (key, max, label) => {
    const v = str(input[key]);
    if (v.length > max) errors.push(`${label} must be at most ${max} characters.`);
    values[key] = v || null;
  };
  optText('title', LIMITS.title, 'Title');
  optText('subtitle', LIMITS.subtitle, 'Subtitle');
  optText('description', LIMITS.description, 'Description');
  optText('ctaLabel', LIMITS.label, 'Primary button label');
  optText('secondaryCtaLabel', LIMITS.label, 'Secondary button label');

  const imageUrl = str(input.imageUrl);
  if (!imageUrl) errors.push('A desktop banner image is required.');
  else if (imageUrl.length > LIMITS.url || !isSafeUrl(imageUrl)) errors.push('Desktop image must be an uploaded file or a valid http(s)/relative URL.');
  values.imageUrl = imageUrl;

  const mobile = str(input.mobileImageUrl);
  if (mobile && (mobile.length > LIMITS.url || !isSafeUrl(mobile))) errors.push('Mobile image must be an uploaded file or a valid http(s)/relative URL.');
  values.mobileImageUrl = mobile || null;

  for (const [urlKey, labelKey, name] of [['ctaUrl', 'ctaLabel', 'Primary button'], ['secondaryCtaUrl', 'secondaryCtaLabel', 'Secondary button']]) {
    const u = str(input[urlKey]);
    if (u && (u.length > LIMITS.url || !isSafeUrl(u))) errors.push(`${name} link must be a relative path (/courses) or an http(s) URL.`);
    values[urlKey] = u || null;
    if (values[urlKey] && !values[labelKey]) errors.push(`${name} needs a label when a link is set.`);
  }

  values.overlayEnabled = isTrue(input.overlayEnabled);
  values.isActive = input.isActive === undefined ? true : isTrue(input.isActive);

  const s = parseDate(input.startAt);
  const e = parseDate(input.endAt);
  if (s.error) errors.push('Start date is invalid.');
  if (e.error) errors.push('End date is invalid.');
  values.startAt = s.value || null;
  values.endAt = e.value || null;
  if (values.startAt && values.endAt && values.endAt <= values.startAt) errors.push('End date must be after the start date.');

  return { errors, values };
}

function activeWhere(now) {
  return {
    isActive: true,
    AND: [
      { OR: [{ startAt: null }, { startAt: { lte: now } }] },
      { OR: [{ endAt: null }, { endAt: { gt: now } }] },
    ],
  };
}

async function getActiveBanners(now = new Date()) {
  return prisma.homeBanner.findMany({
    where: activeWhere(now),
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
}

async function listBanners() {
  return prisma.homeBanner.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
}

async function getBanner(id) {
  return prisma.homeBanner.findUnique({ where: { id } });
}

async function createBanner(values) {
  const agg = await prisma.homeBanner.aggregate({ _max: { sortOrder: true } });
  const sortOrder = (agg._max.sortOrder == null ? -1 : agg._max.sortOrder) + 1;
  return prisma.homeBanner.create({ data: { ...values, sortOrder } });
}

async function updateBanner(id, values) {
  const existing = await getBanner(id);
  if (!existing) throw new HomeBannerError('Banner not found', 404);
  return prisma.homeBanner.update({ where: { id }, data: values });
}

async function deleteBanner(id) {
  const existing = await getBanner(id);
  if (!existing) throw new HomeBannerError('Banner not found', 404);
  await prisma.homeBanner.delete({ where: { id } });
  return existing;
}

async function toggleBanner(id, active) {
  const existing = await getBanner(id);
  if (!existing) throw new HomeBannerError('Banner not found', 404);
  const next = typeof active === 'boolean' ? active : !existing.isActive;
  return prisma.homeBanner.update({ where: { id }, data: { isActive: next } });
}

// Normalises ties by rewriting sortOrder 0..n-1 in the current display order,
// then swaps the banner with its neighbour.
async function moveBanner(id, direction) {
  if (direction !== 'up' && direction !== 'down') throw new HomeBannerError('Invalid direction');
  return prisma.$transaction(async (tx) => {
    const all = await tx.homeBanner.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, sortOrder: true } });
    const idx = all.findIndex((b) => b.id === id);
    if (idx === -1) throw new HomeBannerError('Banner not found', 404);
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target >= 0 && target < all.length) {
      [all[idx], all[target]] = [all[target], all[idx]];
    }
    for (let i = 0; i < all.length; i += 1) {
      if (all[i].sortOrder !== i) await tx.homeBanner.update({ where: { id: all[i].id }, data: { sortOrder: i } });
    }
    return all.map((b) => b.id);
  });
}

module.exports = {
  HomeBannerError,
  isSafeUrl,
  validateBannerInput,
  getActiveBanners,
  listBanners,
  getBanner,
  createBanner,
  updateBanner,
  deleteBanner,
  toggleBanner,
  moveBanner,
};
