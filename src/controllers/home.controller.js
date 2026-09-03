const homeService = require('../services/home.service');

async function getHomePage(req, res, next) {
  try {
    const [categories, featuredCourses, instructors, reviews, stats] = await Promise.all([
      homeService.getActiveCategories(),
      homeService.getFeaturedCourses(),
      homeService.getActiveInstructors(),
      homeService.getApprovedReviews(),
      homeService.getPlatformStats(),
    ]);

    res.render('public/home', {
      pageTitle: 'Institute of Cosmetology & Dental Sciences | Online Courses',
      metaDescription:
        'Learn professional cosmetology, aesthetics, dental sciences and healthcare skills with expert-led online courses.',
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
