const homeService = require('../services/home.service');
const site = require('../config/site');
const { buildSeo, PUBLIC_ROBOTS } = require('../lib/seo');

async function getHomePage(req, res, next) {
  try {
    const [categories, featuredCourses, instructors, reviews, stats] = await Promise.all([
      homeService.getActiveCategories(),
      homeService.getFeaturedCourses(),
      homeService.getActiveInstructors(),
      homeService.getApprovedReviews(),
      homeService.getPlatformStats(),
    ]);

    const title = `${site.name} | Courses & Training`;
    const description =
      'Learn professional cosmetology, aesthetics, dental sciences and healthcare skills with expert-led online courses.';

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
      reviews,
      stats,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getHomePage };
