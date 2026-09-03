const courseService = require('../services/course.service');
const site = require('../config/site');
const { absoluteUrl } = require('../lib/seo');

// Disallows every private/auth/admin/student path so a crawler never
// indexes an account-only page, while explicitly allowing the public
// marketing/catalog routes. Keep this list in sync with the noindex
// defaults in src/lib/seo.js.
function robotsTxt(req, res) {
  const lines = [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /student',
    'Disallow: /login',
    'Disallow: /signup',
    'Disallow: /forgot-password',
    'Disallow: /reset-password',
    'Disallow: /checkout',
    'Disallow: /internal',
    'Disallow: /api',
    'Allow: /',
    '',
    `Sitemap: ${absoluteUrl(req, '/sitemap.xml')}`,
  ];
  res.type('text/plain').send(lines.join('\n'));
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function sitemapXml(req, res, next) {
  try {
    const courses = await courseService.listPublishedCourseSlugsForSitemap();

    const staticEntries = [
      { path: '/', changefreq: 'weekly', priority: '1.0' },
      { path: '/courses', changefreq: 'daily', priority: '0.9' },
      { path: '/contact', changefreq: 'monthly', priority: '0.5' },
      { path: '/privacy', changefreq: 'yearly', priority: '0.2' },
      { path: '/terms', changefreq: 'yearly', priority: '0.2' },
    ];

    const courseEntries = courses.map((c) => ({
      path: `/courses/${c.slug}`,
      lastmod: c.updatedAt.toISOString(),
      changefreq: 'weekly',
      priority: '0.8',
    }));

    const urls = [...staticEntries, ...courseEntries]
      .map((entry) => {
        const loc = xmlEscape(absoluteUrl(req, entry.path));
        const lastmod = entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : '';
        return `  <url><loc>${loc}</loc>${lastmod}<changefreq>${entry.changefreq}</changefreq><priority>${entry.priority}</priority></url>`;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

    res.type('application/xml').send(xml);
  } catch (err) {
    next(err);
  }
}

// A generic (never fabricated) abbreviation: initials of capitalized words
// when the full name is too long for a manifest short_name (recommended
// max ~12 chars) — e.g. "Institute of Cosmetology & Dental Sciences" -> "ICDS".
function shortName(name) {
  if (name.length <= 12) return name;
  const initials = name.match(/\b[A-Z]/g);
  return initials && initials.length >= 2 ? initials.join('') : name.slice(0, 12);
}

function webManifest(req, res) {
  res.type('application/manifest+json').json({
    name: site.name,
    short_name: shortName(site.name),
    theme_color: '#565acf',
    background_color: '#ffffff',
    display: 'standalone',
    start_url: '/',
    icons: [
      { src: '/assets/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/assets/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
}

module.exports = { robotsTxt, sitemapXml, webManifest };
