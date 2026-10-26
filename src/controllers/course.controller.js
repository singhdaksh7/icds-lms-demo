const razorpayService = require('../services/razorpay.service');
const courseService = require('../services/course.service');
const homeService = require('../services/home.service');
const { isUserEnrolled } = require('../services/enrollment.service');
const { prisma } = require('../config/db');
const { parsePage } = require('../lib/pagination');
const { getCoursePurchasePrice, getEffectiveCoursePrice } = require('../lib/pricing');
const { LEVELS } = require('../validators/course.validator');
const site = require('../config/site');
const courseLandingService = require('../services/courseLanding.service');
const courseAppearanceService = require('../services/courseAppearance.service');
const { buildSeo, pageSeoText, absoluteUrl, PUBLIC_ROBOTS } = require('../lib/seo');

async function listCourses(req, res, next) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const categorySlug = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const level = LEVELS.includes(req.query.level) ? req.query.level : '';
    const page = parsePage(req.query.page);

    const [{ courses, pagination }, categories] = await Promise.all([
      courseService.listPublishedCourses({ q, categorySlug, level, page }),
      homeService.getActiveCategories(),
    ]);

    const pageUrl = (targetPage) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (categorySlug) params.set('category', categorySlug);
      if (level) params.set('level', level);
      if (targetPage > 1) params.set('page', String(targetPage));
      const qs = params.toString();
      return `/courses${qs ? `?${qs}` : ''}`;
    };

    const isFiltered = Boolean(q || categorySlug || level);
    const pageSeo = pageSeoText(res.locals.settings, 'courses', {
      title: `Courses | ${site.name}`,
      description: 'Browse professional cosmetology, aesthetics, dental sciences and beauty video courses.',
    });
    const title = q ? `Search: ${q} | ${site.name}` : pageSeo.title;
    const description = pageSeo.description;

    res.render('public/courses', {
      pageTitle: title,
      metaDescription: description,
      // Filtered/search views stay followable but out of the index (avoids
      // competing with the canonical unfiltered catalog for the same
      // content); the plain /courses page is fully indexable.
      seo: buildSeo(req, {
        title,
        description,
        robots: isFiltered ? 'noindex, follow' : PUBLIC_ROBOTS,
        noCanonical: isFiltered,
      }),
      courses,
      pagination,
      pageUrl,
      categories,
      filters: { q, categorySlug, level },
      levels: LEVELS,
    });
  } catch (err) {
    next(err);
  }
}

async function getCourseDetail(req, res, next) {
  try {
    const course = await courseService.getPublishedCourseBySlug(req.params.slug);
    if (!course) {
      return res.status(404).render('public/404', { pageTitle: 'Course Not Found' });
    }

    const lessonCount = course.lessons.length;

    let isEnrolled = false;
    let hasPendingRequest = false;
    if (req.currentUser && req.currentUser.role === 'STUDENT') {
      isEnrolled = await isUserEnrolled(req.currentUser.id, course.id);
      if (!isEnrolled) {
        const pending = await prisma.enrollmentRequest.findFirst({
          where: {
            userId: req.currentUser.id,
            courseId: course.id,
            status: { in: ['PENDING', 'CONTACTED'] },
          },
        });
        hasPendingRequest = Boolean(pending);
      }
    }

    const purchasePrice = getCoursePurchasePrice(course);
    const isFree = Number(purchasePrice) === 0;
    const paymentsEnabled = !isFree && (await razorpayService.isConfigured());
    const taxCfg = await require('../services/taxSettings.service').get();
    const gstNote = !isFree && taxCfg.enabled && require('../services/taxSettings.service').rateFor(course, taxCfg) > 0 ? (taxCfg.inclusive ? 'Inclusive of GST' : '+ GST extra') : '';
    const coursePricing = getEffectiveCoursePrice(course);
    const priceLabel = coursePricing.effectiveLabel;

    const title = `${course.title} | ${site.name}`;
    const description = course.shortDescription || course.title;
    // Only use the course's own thumbnail — never a hotlinked/placeholder
    // asset — and only if it's an absolute URL (a local /uploads path still
    // needs the site origin prefixed for OG to resolve it).
    const ogImage = course.thumbnailUrl
      ? course.thumbnailUrl.startsWith('http')
        ? course.thumbnailUrl
        : absoluteUrl(req, course.thumbnailUrl)
      : null;

    const price = getCoursePurchasePrice(course);
    const curriculumService = require('../services/curriculum.service');
    const demoShowcase = await require('../services/homeReviews.service').isDemoShowcaseEnabled();
    const [curriculum, stats, resources, globalFaqs, landing, courseTheme, reviewsCarousel, courseMentorMedia] = await Promise.all([
      curriculumService.getPublishedCurriculum(course.id),
      curriculumService.getPublicCourseStats(course.id),
      curriculumService.listResourcesForCourse(course.id, { publishedOnly: true }),
      prisma.faq.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, take: 6 }),
      courseLandingService.getPublicLandingData(course.id, { includeDemo: demoShowcase }),
      courseAppearanceService.getRenderTheme(course.id),
      require('../services/courseReviewsCarousel.service').getCourseReviewsCarousel(course.id),
      // Per-course mentor photo/video (null => today's mentor photo markup)
      require('../services/courseMentorMedia.service').getPublicCourseMentorMedia(course.id, course.instructor && course.instructor.photoUrl, course.instructor && course.instructor.name),
    ]);
    if (landing) {
      landing.demoShowcase = demoShowcase;
      // Client-demo showcase: demo testimonials keep their DEMO REVIEW badge unless the owner also switched
      // demo.hideBadgeInShowcase on; counts / averages / rating summary / SEO data already exclude them
      // (computed from the DB, not from this list).
      // Demo reviews (text AND video) reach this list only in showcase mode (getPublicLandingData filters demo rows
      // otherwise), so a demo video review is public only while demo.showReviewsPublicly is on.
      // Remember (before unmarking) that the showcase supplied demo cards, so the section still renders.
      landing.showcaseHasDemo = Boolean(demoShowcase && Array.isArray(landing.testimonials) && landing.testimonials.some((t) => t.isDemo));
      if (demoShowcase && Array.isArray(landing.testimonials) && (await require('../services/homeReviews.service').isDemoBadgeHidden())) landing.testimonials = landing.testimonials.map((t) => ({ ...t, isDemo: false }));
    }

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Course',
      name: course.title,
      description: course.shortDescription || course.description || course.title,
      provider: { '@type': 'Organization', name: site.name, url: site.baseUrl || undefined },
      ...(course.instructor ? { instructor: { '@type': 'Person', name: course.instructor.name } } : {}),
      ...(Number(price) > 0
        ? {
            offers: {
              '@type': 'Offer',
              price: Number(price).toFixed(2),
              priceCurrency: course.currency,
              availability: 'https://schema.org/InStock',
            },
          }
        : {}),
    };

    res.render('public/course-detail', {
      pageTitle: title,
      metaDescription: description,
      seo: buildSeo(req, { title, description, robots: PUBLIC_ROBOTS, ogType: 'website', ogImage, jsonLd }),
      course,
      lessonCount: stats.lessonCount,
      curriculum,
      stats,
      resources,
      faqs: (landing && landing.faqs) ? landing.faqs : [],
      landing,
      courseTheme,
      coursePricing,
      reviewsCarousel,
      courseMentorMedia,
      isEnrolled,
      hasPendingRequest,
      isFree,
      paymentsEnabled,
      priceLabel,
      gstNote,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listCourses, getCourseDetail };
