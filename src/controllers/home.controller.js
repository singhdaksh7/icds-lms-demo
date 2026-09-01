const homeService = require('../services/home.service');

async function getHomePage(req, res, next) {
  try {
    const [categories, featuredCourses, instructors] = await Promise.all([
      homeService.getActiveCategories(),
      homeService.getFeaturedCourses(),
      homeService.getActiveInstructors(),
    ]);

    res.render('public/home', {
      pageTitle: 'Institute of Cosmetology & Dental Sciences | Online Courses',
      metaDescription:
        'Learn professional cosmetology, aesthetics, dental sciences and healthcare skills with expert-led online courses.',
      categories,
      featuredCourses,
      instructors,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getHomePage };
