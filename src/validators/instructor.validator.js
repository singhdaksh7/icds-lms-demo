const { isSafeMediaUrl } = require('../lib/url');

const STATUSES = ['ACTIVE', 'INACTIVE'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateInstructor(body) {
  const errors = [];

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 100) {
    errors.push('Instructor name must be between 2 and 100 characters.');
  }

  const slugInput = typeof body.slug === 'string' ? body.slug.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 150) : '';
  const bio = typeof body.bio === 'string' ? body.bio.trim() : '';

  const photoUrl = typeof body.photoUrl === 'string' ? body.photoUrl.trim() : '';
  if (!isSafeMediaUrl(photoUrl)) {
    errors.push('Photo URL must be a valid http(s) link.');
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email && !EMAIL_RE.test(email)) {
    errors.push('Please enter a valid email address.');
  }

  const linkedinUrl = typeof body.linkedinUrl === 'string' ? body.linkedinUrl.trim() : '';
  if (!isSafeMediaUrl(linkedinUrl)) {
    errors.push('LinkedIn URL must be a valid http(s) link.');
  }

  const instagramUrl = typeof body.instagramUrl === 'string' ? body.instagramUrl.trim() : '';
  if (!isSafeMediaUrl(instagramUrl)) {
    errors.push('Instagram URL must be a valid http(s) link.');
  }

  const status = STATUSES.includes(body.status) ? body.status : 'ACTIVE';

  return {
    errors,
    values: { name, slugInput, title, bio, photoUrl, email, linkedinUrl, instagramUrl, status },
  };
}

module.exports = { validateInstructor, STATUSES };
