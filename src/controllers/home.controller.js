const homeService = require('../services/home.service');
const homeReviewsService = require('../services/homeReviews.service');
const faqService = require('../services/faq.service');
const homeIntroVideoService = require('../services/homeIntroVideo.service');
const homeSectionsService = require('../services/homeSections.service');
const doctorMediaService = require('../services/doctorMedia.service');
const site = require('../config/site');
const { buildSeo, pageSeoText, PUBLIC_ROBOTS } = require('../lib/seo');

async function getHomePage(req, res, next) {
  try {
    const isAdmin = Boolean(res.locals.currentUser && res.locals.currentUser.role === 'ADMIN');
    // Demo reviews are shown (badged) only to an admin explicitly previewing.
    const includeDemo = (isAdmin && req.query.previewDemo === '1') || (await homeReviewsService.isDemoShowcaseEnabled());
    const hideDemoBadge = includeDemo ? await homeReviewsService.isDemoBadgeHidden() : false;
    const [categories, featuredCourses, instructors, reviews, stats, faqs, mentorInstructor, banners, homeReviewSettings, homeReviews, introVideo, homeSectionOrder] = await Promise.all([
      homeService.getActiveCategories(),
      homeService.getFeaturedCourses(),
      homeService.getActiveInstructors(),
      homeService.getApprovedReviews(),
      homeService.getPlatformStats(),
      faqService.listActiveFaqs(),
      homeService.getMentorInstructor(res.locals.cms?.mentor?.instructorId),
      homeService.getHomeBanners(),
      homeReviewsService.getHomeReviewSettings(),
      homeReviewsService.getHomeReviews({ includeDemo }).catch(() => []),
      homeIntroVideoService.getPublicIntroVideo(),
      homeSectionsService.getRenderOrder().catch(() => undefined),
    ]);

    // Admin-chosen photo / video for the doctor block (null => the mentor block keeps its existing photo markup).
    const doctorMedia = await doctorMediaService.getPublicDoctorMedia(mentorInstructor && mentorInstructor.photoUrl, mentorInstructor && mentorInstructor.name);

    const { title, description } = pageSeoText(res.locals.settings, 'home', {
      title: `${site.name} | Courses & Training`,
      description:
        'Learn professional cosmetology, aesthetics, dental sciences and healthcare skills with expert-led online courses.',
    });

    // EducationalOrganization JSON-LD from actual configured contact
    // details only — never a fabricated address/rating/accreditation.
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'EducationalOrganization',
      name: site.name,
      url: site.baseUrl || undefined,
      ...(site.contactEmail ? { email: site.contactEmail } : {}),
      ...(site.contactPhone ? { telephone: site.contactPhone } : {}),
      ...(site.address ? { address: site.address } : {}),
    };

    res.render('public/home', {
      pageTitle: title,
      metaDescription: description,
      seo: buildSeo(req, { title, description, robots: PUBLIC_ROBOTS, jsonLd }),
      categories,
      featuredCourses,
      instructors,
      mentorInstructor,
      doctorMedia,
      reviews,
      banners,
      introVideo,
      homeSectionOrder,
      homeReviewSettings,
      // Client-demo showcase: demo rows keep their DEMO REVIEW badge unless the owner also switched
      // demo.hideBadgeInShowcase on (presentation only; never counted in any genuine metric / SEO data).
      // An admin previewing (?previewDemo=1) always sees the badges.
      homeReviews: homeReviewSettings.enabled
        ? ((isAdmin && req.query.previewDemo === '1') || !hideDemoBadge ? homeReviews : homeReviews.map((r) => ({ ...r, isDemo: false })))
        : [],
      homeReviewsPreviewDemo: includeDemo,
      stats,
      faqs,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getHomePage };
