const { isSafeMediaUrl } = require('../lib/url');

const STATUSES = ['DRAFT', 'PUBLISHED'];

function validateLesson(body) {
  const errors = [];

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 2 || title.length > 200) {
    errors.push('Lesson title must be between 2 and 200 characters.');
  }

  const slugInput = typeof body.slug === 'string' ? body.slug.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  const videoUrl = typeof body.videoUrl === 'string' ? body.videoUrl.trim() : '';
  if (!isSafeMediaUrl(videoUrl)) {
    errors.push('Video URL must be a valid http(s) link.');
  }

  const duration = typeof body.duration === 'string' ? body.duration.trim().slice(0, 50) : '';

  let sortOrder = parseInt(body.sortOrder, 10);
  if (!Number.isFinite(sortOrder) || sortOrder < 0) {
    sortOrder = 0;
  }
  if (sortOrder > 100000) {
    errors.push('Sort order is out of range.');
  }

  const preview = body.preview === 'on' || body.preview === true;

  const status = STATUSES.includes(body.status) ? body.status : null;
  if (!status) {
    errors.push('Please choose a valid lesson status.');
  }

  return {
    errors,
    values: { title, slugInput, description, videoUrl, duration, sortOrder, preview, status },
  };
}

module.exports = { validateLesson, STATUSES };
