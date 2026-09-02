const courseService = require('../services/course.service');
const homeService = require('../services/home.service');
const { isUserEnrolled } = require('../services/enrollment.service');
const { parsePage } = require('../lib/pagination');
const { getCoursePurchasePrice } = require('../lib/pricing');
const { LEVELS } = require('../validators/course.validator');

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

    res.render('public/courses', {
      pageTitle: q ? `Search: ${q} | ICDS Courses` : 'All Courses | ICDS',
      metaDescription: 'Browse professional cosmetology, aesthetics, dental sciences and beauty video courses.',
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
    if (req.currentUser && req.currentUser.role === 'STUDENT') {
      isEnrolled = await isUserEnrolled(req.currentUser.id, course.id);
    }

    const isFree = Number(getCoursePurchasePrice(course)) === 0;

    res.render('public/course-detail', {
      pageTitle: `${course.title} | ICDS`,
      metaDescription: course.shortDescription || course.title,
      course,
      lessonCount,
      isEnrolled,
      isFree,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listCourses, getCourseDetail };
