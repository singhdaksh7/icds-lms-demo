process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef-test';

// Student player: right-hand course content sidebar, theater mode, mobile
// drawer, per-course player settings (service + admin tab) and the guarantee
// that the progress-tracking DOM/script contract is untouched.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { prisma } = require('../src/config/db');
const site = require('../src/config/site');
const settingsService = require('../src/services/settings.service');
const svc = require('../src/services/coursePlayerSettings.service');

const root = path.join(__dirname, '..');
const VIEWS = path.join(root, 'views');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').split('\r\n').join('\n');

// source with comments removed, so assertions are about code, not prose
const code = (...p) => read(...p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// In-memory CoursePlayerSettings table
// ---------------------------------------------------------------------------
function installFakeDb(courseIds) {
  const rows = new Map();
  let nextId = 1;
  const orig = {
    cFind: prisma.course.findUnique,
    find: prisma.coursePlayerSettings.findUnique,
    upsert: prisma.coursePlayerSettings.upsert,
    del: prisma.coursePlayerSettings.deleteMany,
  };
  prisma.course.findUnique = async ({ where }) => (courseIds.includes(where.id) ? { id: where.id } : null);
  prisma.coursePlayerSettings.findUnique = async ({ where }) => rows.get(where.courseId) || null;
  prisma.coursePlayerSettings.upsert = async ({ where, create, update }) => {
    const existing = rows.get(where.courseId);
    const row = existing ? { ...existing, ...update } : { id: nextId++, ...create };
    rows.set(where.courseId, row);
    return row;
  };
  prisma.coursePlayerSettings.deleteMany = async ({ where }) => { rows.delete(where.courseId); return { count: 1 }; };
  return {
    rows,
    restore() {
      prisma.course.findUnique = orig.cFind;
      prisma.coursePlayerSettings.findUnique = orig.find;
      prisma.coursePlayerSettings.upsert = orig.upsert;
      prisma.coursePlayerSettings.deleteMany = orig.del;
    },
  };
}

async function withDb(courseIds, fn) {
  const db = installFakeDb(courseIds);
  try { await fn(db); } finally { db.restore(); }
}

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------
const cms = settingsService.defaultContent();
const course = { id: 6, slug: 'fmr', title: 'Advanced FMR' };
const lessons = [
  { id: 1, slug: 'l1', title: 'Intro lesson', duration: '10:00', preview: true },
  { id: 2, slug: 'l2', title: 'Second lesson', duration: '20:00', preview: false },
  { id: 3, slug: 'l3', title: 'Third lesson', duration: '5:30', preview: false },
];
const curriculum = [
  {
    id: 10, title: 'Module One', completedLessons: 1, totalLessons: 2,
    topics: [{ id: 100, title: 'Topic A', completedLessons: 1, totalLessons: 2, lessons: [lessons[0], lessons[1]] }],
  },
  {
    id: 11, title: 'Module Two', completedLessons: 0, totalLessons: 1,
    topics: [{ id: 101, title: 'Topic B', completedLessons: 0, totalLessons: 1, lessons: [lessons[2]] }],
  },
];

function view(extra = {}) {
  return {
    cms, site, fill: settingsService.fill, csrfToken: 'tok', flash: {}, pageTitle: 'T', metaDescription: '',
    course, lesson: { ...lessons[1], videoType: 'LOCAL', videoPath: 'x.mp4', description: 'About this lesson' },
    lessons, curriculum, currentModule: curriculum[0], currentTopic: curriculum[0].topics[0],
    resources: [{ id: 5, title: 'Case form', contentType: 'PDF', sizeBytes: 2048 }],
    videoEmbed: null, previousLesson: lessons[0], nextLesson: lessons[2],
    progressMap: { 1: { completed: true, lastPositionSeconds: 0 } },
    progress: { percent: 33, completed: 1, total: 3 },
    enrolled: true, isAdmin: false,
    ...extra,
  };
}

const render = (v) => ejs.renderFile(path.join(VIEWS, 'student/lesson-content.ejs'), v, { views: [VIEWS] });

// ---------------------------------------------------------------------------
// Sidebar content
// ---------------------------------------------------------------------------
test('player renders the course content sidebar with the real Module > Topic > Lesson hierarchy', async () => {
  const html = await render(view());
  assert.match(html, /<aside class="lp-sidebar[^"]*" id="lpSidebar"/);
  assert.match(html, /Advanced FMR/); // course title in the sidebar
  for (const t of ['Module One', 'Module Two', 'Topic A', 'Topic B', 'Intro lesson', 'Second lesson', 'Third lesson']) assert.ok(html.includes(t), t);
  // hierarchy order: module -> topic -> lesson
  assert.ok(html.indexOf('Module One') < html.indexOf('Topic A'));
  assert.ok(html.indexOf('Topic A') < html.indexOf('Intro lesson'));
  assert.ok(html.indexOf('Intro lesson') < html.indexOf('Module Two'));
  // the sidebar sits to the right of the video in the DOM (main first, aside second)
  assert.ok(html.indexOf('id="lpMain"') < html.indexOf('id="lpSidebar"'));
});

test('lesson navigation: every unlocked lesson is a link to its lesson page', async () => {
  const html = await render(view());
  assert.match(html, /href="\/learn\/fmr\/l1"/);
  assert.match(html, /href="\/learn\/fmr\/l2"/);
  assert.match(html, /href="\/learn\/fmr\/l3"/);
  assert.match(html, /rel="prev"/);
  assert.match(html, /rel="next"/);
});

test('current / completed / locked lesson states are rendered', async () => {
  const html = await render(view());
  // current lesson
  assert.match(html, /<a href="\/learn\/fmr\/l2"[^>]*class="lp-lesson is-current[^"]*"[^>]*aria-current="page"/);
  assert.match(html, /bi-play-circle-fill/);
  // completed lesson
  assert.match(html, /<a href="\/learn\/fmr\/l1"[^>]*class="lp-lesson[^"]*is-done/);
  assert.match(html, /bi-check-circle-fill text-success/);
  // locked (not enrolled, not preview) => not a link, with a lock icon
  const locked = await render(view({ enrolled: false, progressMap: {}, progress: null }));
  assert.match(locked, /<span class="lp-lesson is-locked" data-sidebar-lesson-id="2" aria-disabled="true">/);
  assert.doesNotMatch(locked, /href="\/learn\/fmr\/l2"[^>]*data-sidebar-lesson-id/);
  assert.match(locked, /bi-lock-fill/);
  // preview lesson stays reachable when not enrolled
  assert.match(locked, /<a href="\/learn\/fmr\/l1"/);
});

test('progress display: overall percent, count and per-module / per-topic badges', async () => {
  const html = await render(view());
  assert.match(html, /class="course-progress-percent-text">33</);
  assert.match(html, /style="width: 33%/);
  assert.match(html, /1 of 3 lessons completed/);
  assert.match(html, /module-progress-badge" data-module-id="10"[^>]*>1\/2</);
  assert.match(html, /module-progress-badge" data-module-id="11"[^>]*>0\/1</);
  assert.match(html, /topic-progress-badge" data-topic-id="100"[^>]*>1\/2</);
  assert.match(html, /10:00/); // durations
  // admin preview shows no student progress
  const admin = await render(view({ isAdmin: true, enrolled: true }));
  assert.match(admin, /Admin Preview/);
  assert.doesNotMatch(admin, /class="progress-bar course-progress-bar"/);
});

test('modules and topics are collapsible buttons with aria-expanded; the current module starts open', async () => {
  const html = await render(view());
  assert.match(html, /id="lp-mod-btn-10"[^>]*>|aria-expanded="true" aria-controls="lp-mod-panel-10"/);
  assert.match(html, /<button type="button" class="lp-module-btn" data-lp-collapse\s+aria-expanded="true" aria-controls="lp-mod-panel-10"/);
  assert.match(html, /<button type="button" class="lp-module-btn" data-lp-collapse\s+aria-expanded="false" aria-controls="lp-mod-panel-11"/);
  assert.match(html, /id="lp-mod-panel-11" role="region" aria-labelledby="lp-mod-btn-11" hidden/);
  assert.match(html, /class="lp-topic-btn" data-lp-collapse/);
});

// ---------------------------------------------------------------------------
// Theater mode + drawer markup
// ---------------------------------------------------------------------------
test('theater toggle and mobile drawer markup are present and accessible', async () => {
  const html = await render(view());
  assert.match(html, /id="lpTheaterToggle"[^>]*data-lp-theater-toggle[^>]*aria-controls="lpSidebar"[^>]*aria-expanded="true"/);
  assert.match(html, /Hide Course Content/);
  assert.match(html, /d-none d-lg-inline-flex/); // theater button is desktop-only
  assert.match(html, /id="lpDrawerToggle"[^>]*data-lp-drawer-toggle[^>]*aria-controls="lpSidebar"[^>]*aria-expanded="false"/);
  assert.match(html, /d-lg-none/); // drawer opener is tablet/mobile-only
  assert.match(html, /class="btn-close lp-drawer-close d-lg-none" data-lp-drawer-close aria-label="Close course content"/);
  assert.match(html, /id="lpBackdrop" data-lp-drawer-close hidden/);
  assert.match(html, /role="complementary"/);
  assert.match(html, /<script src="\/js\/lesson-player-ui\.js" defer>/);
  assert.match(html, /<link rel="stylesheet" href="\/css\/lesson-player\.css">/);
});

test('theater / drawer behaviour is implemented without reloads, with Escape + focus handling', () => {
  const js = code('public/js/lesson-player-ui.js');
  const css = read('public/css/lesson-player.css');
  assert.match(js, /Escape/);
  assert.match(js, /\.focus\(\)/);
  assert.match(js, /inert/);
  assert.match(js, /aria-expanded/);
  assert.match(js, /localStorage/);
  assert.doesNotMatch(js, /location\.(reload|href)/);
  assert.doesNotMatch(js, /fullscreen/i, 'native fullscreen is left alone');
  assert.match(css, /--lp-ease: 300ms/);
  assert.match(css, /\.lp-layout\.is-theater/);
  assert.match(css, /translateX\(110%\)/); // slides out to the right
  assert.match(css, /@media \(max-width: 991\.98px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /--lp-sidebar-w: clamp\(300px, 26vw, 380px\)/);
  assert.doesNotMatch(css, /requestFullscreen/);
});

// ---------------------------------------------------------------------------
// Settings honoured
// ---------------------------------------------------------------------------
test('sidebarDefaultOpen=false starts collapsed (theater) and labels follow the state', async () => {
  const html = await render(view({ playerSettings: { sidebarDefaultOpen: false } }));
  assert.match(html, /data-sidebar-default="closed"/);
  assert.match(html, /class="lp-sidebar is-collapsed"/);
  assert.match(html, /aria-expanded="false">\s*<i class="bi bi-layout-sidebar-inset-reverse"/);
  assert.match(html, /Show Course Content/);
  const open = await render(view({ playerSettings: { sidebarDefaultOpen: true } }));
  assert.match(open, /data-sidebar-default="open"/);
  assert.match(open, /class="lp-sidebar "/);
});

test('showSidebar=false removes the sidebar, both toggles and the drawer', async () => {
  const html = await render(view({ playerSettings: { showSidebar: false } }));
  assert.doesNotMatch(html, /id="lpSidebar"/);
  assert.doesNotMatch(html, /lpTheaterToggle|lpDrawerToggle|lpBackdrop/);
  assert.match(html, /data-sidebar-enabled="false"/);
  assert.match(html, /id="lesson-video"/); // video unaffected
});

test('theaterModeEnabled=false hides the theater button but keeps the sidebar; custom label and title are used', async () => {
  const noTheater = await render(view({ playerSettings: { theaterModeEnabled: false } }));
  assert.doesNotMatch(noTheater, /lpTheaterToggle/);
  assert.match(noTheater, /id="lpSidebar"/);
  assert.match(noTheater, /data-theater-enabled="false"/);

  const custom = await render(view({ playerSettings: { sidebarTitle: 'Your Syllabus', theaterButtonLabel: 'Focus Mode' } }));
  assert.match(custom, /Your Syllabus/);
  assert.match(custom, /aria-label="Your Syllabus"/);
  assert.match(custom, /Focus Mode/);
  assert.match(custom, /data-label-hide="Focus Mode"/);
  assert.match(custom, /data-label-show="Focus Mode"/);
});

test('each presentation flag hides exactly its own element', async () => {
  const base = await render(view());
  assert.match(base, /lp-lesson-dur/);
  assert.match(base, /lp-resources/);
  assert.match(base, /lp-description/);
  assert.match(base, /lp-prevnext/);
  assert.match(base, /course-progress-bar/);

  assert.doesNotMatch(await render(view({ playerSettings: { showLessonDurations: false } })), /lp-lesson-dur/);
  assert.doesNotMatch(await render(view({ playerSettings: { showResources: false } })), /lp-resources/);
  assert.doesNotMatch(await render(view({ playerSettings: { showLessonDescription: false } })), /lp-description/);
  assert.doesNotMatch(await render(view({ playerSettings: { showPrevNext: false } })), /lp-prevnext/);
  const noCourse = await render(view({ playerSettings: { showCourseProgress: false } }));
  assert.doesNotMatch(noCourse, /class="progress-bar course-progress-bar"/);
  const noModule = await render(view({ playerSettings: { showModuleProgress: false } }));
  assert.match(noModule, /module-progress-badge lp-hidden-badge" data-module-id="10" hidden/);
  const noDone = await render(view({ playerSettings: { showCompletedMarks: false } }));
  assert.doesNotMatch(noDone, /is-done/);
  assert.match(noDone, /data-show-done="false"/);
  // untouched siblings stay on
  assert.match(noModule, /lp-resources/);
});

test('missing playerSettings means defaults-on (existing callers keep working)', async () => {
  const html = await render(view({ playerSettings: undefined }));
  for (const frag of ['lpSidebar', 'lpTheaterToggle', 'lp-prevnext', 'lp-resources', 'lp-description', 'lp-lesson-dur']) assert.ok(html.includes(frag), frag);
});

test('below the player: title, breadcrumb, description, resources and prev/next', async () => {
  const html = await render(view());
  assert.match(html, /<h1 class="h3 fw-bold text-dark mb-0">Second lesson<\/h1>/);
  assert.match(html, /aria-label="breadcrumb"/);
  assert.match(html, /Module One/);
  assert.match(html, /About this lesson/);
  assert.match(html, /Case form/);
  assert.match(html, /Intro lesson/); // previous
  assert.match(html, /Third lesson/); // next
});

// ---------------------------------------------------------------------------
// Progress security: contract with lesson-progress.js untouched
// ---------------------------------------------------------------------------
test('progress tracking contract: video attributes, scripts and DOM hooks are intact', async () => {
  const html = await render(view());
  assert.match(html, /<video\s+id="lesson-video"/);
  assert.match(html, /data-lesson-id="2"/);
  assert.match(html, /data-resume-seconds="0"/);
  assert.match(html, /data-progress-url="\/student\/lessons\/2\/progress"/);
  assert.match(html, /data-csrf="tok"/);
  assert.match(html, /controlsList="nodownload noremoteplayback"/);
  assert.match(html, /disablePictureInPicture/);
  assert.match(html, /<script src="\/js\/lesson-video-guard\.js" defer>/);
  assert.match(html, /<script src="\/js\/lesson-progress\.js" defer>/);
  assert.match(html, /<source src="\/media\/lessons\/2\/video" type="video\/mp4">/);

  // not tracked for admins / non-enrolled viewers
  const admin = await render(view({ isAdmin: true }));
  assert.doesNotMatch(admin, /data-progress-url|lesson-progress\.js/);
  const anon = await render(view({ enrolled: false }));
  assert.doesNotMatch(anon, /data-progress-url|lesson-progress\.js/);

  // R2 lessons keep their signed-source loader
  const r2 = await render(view({ lesson: { ...lessons[1], videoType: 'R2', videoObjectKey: 'k', description: '' } }));
  assert.match(r2, /data-source-url="\/api\/lessons\/2\/video-source"/);
  assert.match(r2, /lesson-video-source\.js/);

  // every selector lesson-progress.js writes to exists in the markup
  const js = read('public/js/lesson-progress.js');
  for (const sel of ['.course-progress-percent-text', '.course-progress-bar', '.course-progress-count-text', '.module-progress-badge[data-module-id=', '.topic-progress-badge[data-topic-id=', '[data-sidebar-lesson-id=', 'lesson-completion-badge', 'lesson-completion-note']) {
    assert.ok(js.includes(sel), `lesson-progress.js uses ${sel}`);
  }
  for (const hook of ['course-progress-percent-text', 'course-progress-bar', 'course-progress-count-text', 'module-progress-badge', 'topic-progress-badge', 'data-sidebar-lesson-id', 'id="lesson-completion-badge"', 'id="lesson-completion-note"', 'bi-play-circle-fill']) {
    assert.ok(html.includes(hook), `markup has ${hook}`);
  }
  // a not-yet-done lesson uses the icons progress JS swaps to the green check
  const pending = await render(view({ progressMap: {} }));
  assert.match(pending, /bi bi-circle text-muted/);
});

test('the player UI files never touch progress or the video element', () => {
  const js = code('public/js/lesson-player-ui.js');
  assert.doesNotMatch(js, /lesson-video|currentTime|fetch\(|XMLHttpRequest|sendBeacon|progress/i);
  const ctrl = read('src/controllers/learn.controller.js');
  assert.match(ctrl, /getPlayerSettings\(course\.id\)/);
  assert.match(ctrl, /\n\s+playerSettings,\n/);
  assert.match(read('views/student/lesson.ejs'), /playerSettings/);
});

// ---------------------------------------------------------------------------
// Settings service: defaults, patch-style save, boolean safety
// ---------------------------------------------------------------------------
test('a course with no saved row gets sensible defaults; getPlayerSettings never throws', async () => {
  await withDb([1], async () => {
    const s = await svc.getPlayerSettings(1);
    assert.deepEqual(s, { ...svc.DEFAULTS });
    assert.equal(s.showSidebar, true);
    assert.equal(s.sidebarDefaultOpen, true);
    assert.equal(s.theaterModeEnabled, true);
  });
  const orig = prisma.coursePlayerSettings.findUnique;
  prisma.coursePlayerSettings.findUnique = async () => { throw new Error('db down'); };
  try {
    assert.deepEqual(await svc.getPlayerSettings(1), { ...svc.DEFAULTS });
  } finally {
    prisma.coursePlayerSettings.findUnique = orig;
  }
});

test('settings are per course: Course A open, Course B collapsed', async () => {
  await withDb([1, 2], async () => {
    await svc.updatePlayerSettings(1, { sidebarDefaultOpen: 'true' });
    await svc.updatePlayerSettings(2, { sidebarDefaultOpen: 'false', sidebarTitle: 'Syllabus' });
    assert.equal((await svc.getPlayerSettings(1)).sidebarDefaultOpen, true);
    const b = await svc.getPlayerSettings(2);
    assert.equal(b.sidebarDefaultOpen, false);
    assert.equal(b.sidebarTitle, 'Syllabus');
    assert.equal((await svc.getPlayerSettings(1)).sidebarTitle, '');
  });
});

test('boolean safety: hidden "false" + checkbox "true" -> last value wins; absent fields are untouched', async () => {
  await withDb([1], async (db) => {
    await svc.updatePlayerSettings(1, { showPrevNext: ['false', 'true'], showResources: ['false'], theaterModeEnabled: 'on' });
    assert.equal(db.rows.get(1).showPrevNext, true);
    assert.equal(db.rows.get(1).showResources, false);
    assert.equal(db.rows.get(1).theaterModeEnabled, true);

    // a later save of ONE unrelated field must not flip anything else
    await svc.updatePlayerSettings(1, { sidebarTitle: 'Only this' });
    const row = db.rows.get(1);
    assert.equal(row.showResources, false);
    assert.equal(row.showPrevNext, true);
    assert.equal(row.sidebarTitle, 'Only this');
    assert.ok(!('showSidebar' in row) || row.showSidebar !== false);

    // unchecked (only the hidden false posted) really turns it off
    await svc.updatePlayerSettings(1, { showPrevNext: 'false' });
    assert.equal(db.rows.get(1).showPrevNext, false);
    assert.equal(db.rows.get(1).showResources, false);
  });
});

test('text fields are trimmed, cleared when blank and length-limited; unknown fields are ignored', async () => {
  await withDb([1], async (db) => {
    await svc.updatePlayerSettings(1, { sidebarTitle: '  Syllabus  ', theaterButtonLabel: 'Focus', bogusField: 'x', courseId: 99 });
    assert.equal(db.rows.get(1).sidebarTitle, 'Syllabus');
    assert.equal(db.rows.get(1).courseId, 1);
    assert.ok(!('bogusField' in db.rows.get(1)));
    await svc.updatePlayerSettings(1, { sidebarTitle: '   ' });
    assert.equal(db.rows.get(1).sidebarTitle, null);
    assert.equal(db.rows.get(1).theaterButtonLabel, 'Focus');
    await assert.rejects(() => svc.updatePlayerSettings(1, { sidebarTitle: 'x'.repeat(101) }), /100 characters/);
    await assert.rejects(() => svc.updatePlayerSettings(1, { theaterButtonLabel: 'x'.repeat(61) }), /60 characters/);
  });
});

test('reset removes the row (back to defaults); unknown courses are rejected', async () => {
  await withDb([1], async (db) => {
    await svc.updatePlayerSettings(1, { showSidebar: 'false' });
    assert.equal((await svc.getPlayerSettings(1)).showSidebar, false);
    await svc.resetPlayerSettings(1);
    assert.equal(db.rows.has(1), false);
    assert.equal((await svc.getPlayerSettings(1)).showSidebar, true);
    await assert.rejects(() => svc.updatePlayerSettings(999, {}), /Course not found/);
    await assert.rejects(() => svc.resetPlayerSettings('abc'), /Invalid course id/);
  });
});

test('player settings are never read through anything FMR-specific', () => {
  for (const f of ['views/student/lesson-content.ejs', 'src/services/coursePlayerSettings.service.js', 'public/js/lesson-player-ui.js', 'src/controllers/admin/coursePlayer.controller.js']) {
    assert.doesNotMatch(read(f), /advanced-fmr|fmr-master/i, f);
  }
});

// ---------------------------------------------------------------------------
// Admin tab + controller + routes
// ---------------------------------------------------------------------------
test('admin Player tab renders every setting with the hidden-false + checkbox pattern', async () => {
  const html = await ejs.renderFile(path.join(VIEWS, 'admin/courses/player-tab.ejs'), {
    csrfToken: 'tok', course: { id: 6, title: 'FMR' }, playerSettings: { ...svc.DEFAULTS, showResources: false, sidebarTitle: 'Syllabus' },
  });
  for (const f of svc.BOOLEAN_FIELDS) {
    assert.match(html, new RegExp(`<input type="hidden" name="${f}" value="false">\\s*<input class="form-check-input" type="checkbox" role="switch" name="${f}"`), f);
  }
  assert.match(html, /name="sidebarTitle"[^>]*value="Syllabus"/);
  assert.match(html, /name="theaterButtonLabel"/);
  assert.match(html, /name="showResources" id="ps-showResources" value="true" >/); // unchecked
  assert.match(html, /name="showSidebar" id="ps-showSidebar" value="true" checked>/);
  assert.match(html, /action="\/admin\/courses\/6\/player-settings"/);
  assert.match(html, /action="\/admin\/courses\/6\/player-settings\/reset"[^>]*data-confirm=/);
  assert.doesNotMatch(html, /<textarea/i);
});

test('landing editor shows the Player tab and still renders without player data', async () => {
  const base = {
    csrfToken: 't', activeTab: 'player',
    course: { id: 5, title: 'C', slug: 'c', status: 'PUBLISHED', instructor: null }, landingContent: {},
    heroChips: [], takeaways: [], questions: [], audienceItems: [], faqs: [], whyRegisterItems: [], highlights: [], testimonials: [],
    accessPlans: [], courseStats: [], landingSections: [], resources: [], accessSteps: [], comparisonColumns: [],
  };
  const without = await ejs.renderFile(path.join(VIEWS, 'admin/courses/landing-page-content.ejs'), base);
  assert.match(without, /id="tab-player"/);
  assert.match(without, /22 Player/);
  assert.doesNotMatch(without, /id="playerSettingsForm"/);
  const withData = await ejs.renderFile(path.join(VIEWS, 'admin/courses/landing-page-content.ejs'), { ...base, playerSettings: { ...svc.DEFAULTS } });
  assert.match(withData, /id="playerSettingsForm"/);
});

test('admin routes are CSRF protected; controller flashes results and returns to the Player tab', async () => {
  const routes = read('src/routes/adminPlayer.routes.js');
  assert.match(routes, /router\.post\('\/courses\/:courseId\/player-settings', doubleCsrfProtection, coursePlayerController\.savePlayerSettings\)/);
  assert.match(routes, /router\.post\('\/courses\/:courseId\/player-settings\/reset', doubleCsrfProtection, coursePlayerController\.resetPlayerSettings\)/);
  assert.match(read('src/routes/admin.routes.js'), /router\.use\(require\('\.\/adminPlayer\.routes'\)\)/);

  const controller = require('../src/controllers/admin/coursePlayer.controller');
  await withDb([3], async (db) => {
    const flash = [];
    const mk = (body) => ({ params: { courseId: '3' }, body, flashError: (m) => flash.push(['e', m]), flashSuccess: (m) => flash.push(['s', m]) });
    let redirected = null;
    const res = { redirect: (u) => { redirected = u; } };

    await controller.savePlayerSettings(mk({ sidebarTitle: 'x'.repeat(200) }), res, (e) => { throw e; });
    assert.equal(redirected, '/admin/courses/3/landing-page?tab=player');
    assert.equal(flash[0][0], 'e');
    assert.equal(db.rows.size, 0);

    flash.length = 0;
    await controller.savePlayerSettings(mk({ showSidebar: ['false', 'true'], sidebarDefaultOpen: 'false' }), res, (e) => { throw e; });
    assert.equal(flash[0][0], 's');
    assert.equal(db.rows.get(3).sidebarDefaultOpen, false);
    assert.equal(db.rows.get(3).showSidebar, true);

    await controller.resetPlayerSettings(mk({}), res, (e) => { throw e; });
    assert.equal(db.rows.has(3), false);
  });
});
