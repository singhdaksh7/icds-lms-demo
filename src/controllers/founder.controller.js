const site = require('../config/site');
const { buildSeo, pageSeoText, PUBLIC_ROBOTS } = require('../lib/seo');
const { getFounderPageData, buildFounderViewModel, buildFaqJsonLd } = require('../services/founder.service');
const doctorMediaService = require('../services/doctorMedia.service');

async function founderPage(req, res, next) {
  try {
    const data = await getFounderPageData();
    const vm = data ? buildFounderViewModel(data) : null;
    if (!vm || !vm.instructor) {
      return res.status(404).render('public/404', { pageTitle: 'Page Not Found' });
    }
    const i = vm.instructor;
    // Admin-chosen photo / video (null => the hero keeps its existing portrait markup).
    const doctorMedia = await doctorMediaService.getPublicDoctorMedia(i.photoUrl, i.name);
    const fallbackDesc = (i.founderIntro || '').trim().slice(0, 300)
      || `${i.name}${i.title ? `, ${i.title}` : ''} - ${site.name}.`;
    const { title, description } = pageSeoText(res.locals.settings, 'founder', {
      title: `${i.name} - Founder | ${site.name}`,
      description: fallbackDesc,
    });
    const faqLd = buildFaqJsonLd(vm.sections.includes('FAQ') ? vm.faqs : []);
    const sameAs = [i.linkedinHref, i.instagramHref].filter(Boolean);
    const personLd = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: i.name,
      ...(i.title ? { jobTitle: i.title } : {}),
      ...(i.photoUrl ? { image: i.photoUrl } : {}),
      ...(sameAs.length ? { sameAs } : {}),
    };
    res.render('public/founder', {
      pageTitle: title,
      metaDescription: description,
      seo: buildSeo(req, {
        title,
        description,
        robots: PUBLIC_ROBOTS,
        ogType: 'profile',
        jsonLd: faqLd ? [personLd, faqLd] : personLd,
      }),
      vm,
      doctorMedia,
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { founderPage };
