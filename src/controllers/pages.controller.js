// Public standalone pages: /about, /faq, /reviews (and the SitePage settings of /contact).
// Content comes from the CMS (SitePage / SitePageSection / Faq / CourseTestimonial);
// a disabled page responds with the standard 404.
const { prisma } = require('../config/db');
const site = require('../config/site');
const { buildSeo, pageSeoText, PUBLIC_ROBOTS } = require('../lib/seo');
const sitePages = require('../services/sitePages.service');
const faqService = require('../services/faq.service');
const homeService = require('../services/home.service');
const tv = require('../lib/testimonialVideo');

const notFound = (res) => res.status(404).render('public/404', { pageTitle: 'Page Not Found' });

function seoFor(res, slug, page, fallbackTitle, fallbackDescription) {
  const settingsText = pageSeoText(res.locals.settings, slug, { title: fallbackTitle, description: fallbackDescription });
  return {
    title: page.seoTitle || settingsText.title,
    description: page.metaDescription || settingsText.description,
  };
}

const plain = (text, max) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);

async function aboutPage(req, res, next) {
  try {
    const data = await sitePages.getPublicPage('about', res.locals.cms);
    if (!data) return notFound(res);
    const { page, sections } = data;
    const [courses, founder] = await Promise.all([
      homeService.getFeaturedCourses(3).catch(() => []),
      prisma.instructor
        .findFirst({ where: { isFounder: true, status: 'ACTIVE' }, orderBy: { id: 'asc' }, select: { name: true, title: true, designation: true, photoUrl: true, shortBio: true, founderIntro: true } })
        .catch(() => null),
    ]);
    // Admin-chosen photo / video for the founder card (null => the card keeps its existing photo markup).
    const doctorMedia = await require('../services/doctorMedia.service').getPublicDoctorMedia(founder && founder.photoUrl, founder && founder.name);
    const { title, description } = seoFor(res, 'about', page, `${page.heading || 'About'} | ${site.name}`, plain(page.intro, 160) || `About ${site.name}.`);
    res.render('public/about', {
      pageTitle: title,
      metaDescription: description,
      seo: buildSeo(req, { title, description, robots: PUBLIC_ROBOTS, ogImage: page.heroImageUrl || undefined }),
      page,
      sections,
      courses,
      founder,
      doctorMedia,
    });
  } catch (err) {
    next(err);
  }
}

async function faqPage(req, res, next) {
  try {
    const data = await sitePages.getPublicPage('faq', res.locals.cms);
    if (!data) return notFound(res);
    const { page } = data;
    const { faqs, categories } = await faqService.listPublicFaqsWithCategories();
    const { title, description } = seoFor(res, 'faq', page, `${page.heading || 'FAQ'} | ${site.name}`, plain(page.intro, 160) || `Frequently asked questions about ${site.name}.`);
    const jsonLd = faqs.length
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faqs.slice(0, 50).map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
        }
      : undefined;
    res.render('public/faq', {
      pageTitle: title,
      metaDescription: description,
      seo: buildSeo(req, { title, description, robots: PUBLIC_ROBOTS, jsonLd }),
      page,
      faqs,
      categories,
    });
  } catch (err) {
    next(err);
  }
}

const REVIEW_FILTERS = ['all', 'text', 'video'];

// Genuine published, non-demo testimonials of PUBLISHED courses. Demo rows are
// never public (not even in demo-showcase mode) and video rows must be playable.
async function loadPublicReviews() {
  const rows = await prisma.courseTestimonial.findMany({
    where: { isPublished: true, isDemo: false, course: { status: 'PUBLISHED' } },
    include: { course: { select: { title: true, slug: true } } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'desc' }],
    take: 200,
  });
  return rows
    .map((r) => ({ pub: tv.toPublicTestimonial(r), row: r }))
    .filter(({ pub }) => pub.hasVideo || (pub.reviewType !== 'VIDEO' && pub.hasQuote))
    .map(({ pub, row }) => ({
      id: row.id,
      reviewType: pub.reviewType,
      hasVideo: pub.hasVideo,
      videoKind: pub.videoKind,
      embedUrl: pub.embedUrl,
      videoThumbnailUrl: pub.videoThumbnailUrl || '',
      quote: row.quote ? String(row.quote).trim() : '',
      rating: Math.min(5, Math.max(0, Math.round(Number(row.rating) || 0))),
      reviewerName: row.reviewerName,
      reviewerDesignation: row.reviewerDesignation || '',
      reviewerLocation: row.reviewerLocation || '',
      avatarUrl: row.avatarUrl || '',
      initials: (row.initials && String(row.initials).trim()) || String(row.reviewerName || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase(),
      courseTitle: row.course ? row.course.title : '',
      courseSlug: row.course ? row.course.slug : '',
    }));
}

function applyReviewFilter(list, filter) {
  if (filter === 'video') return list.filter((r) => r.hasVideo);
  if (filter === 'text') return list.filter((r) => !r.hasVideo);
  return list;
}

async function reviewsPage(req, res, next) {
  try {
    const data = await sitePages.getPublicPage('reviews', res.locals.cms);
    if (!data) return notFound(res);
    const { page } = data;
    const filter = REVIEW_FILTERS.includes(req.query.type) ? req.query.type : 'all';
    const all = await loadPublicReviews();
    const reviews = applyReviewFilter(all, filter);
    const counts = { all: all.length, text: applyReviewFilter(all, 'text').length, video: applyReviewFilter(all, 'video').length };
    const { title, description } = seoFor(res, 'reviews', page, `${page.heading || 'Reviews'} | ${site.name}`, plain(page.intro, 160) || `What learners say about ${site.name}.`);
    res.render('public/reviews', {
      pageTitle: title,
      metaDescription: description,
      // Filtered views stay followable but are not separately indexed.
      seo: buildSeo(req, { title, description, robots: filter === 'all' ? PUBLIC_ROBOTS : 'noindex, follow', noCanonical: filter !== 'all' }),
      page,
      reviews,
      filter,
      counts,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { aboutPage, faqPage, reviewsPage, loadPublicReviews, applyReviewFilter, REVIEW_FILTERS };
