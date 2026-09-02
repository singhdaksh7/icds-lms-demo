// URL-safe slug generation shared by courses, categories, and instructors.
function slugify(text) {
  const base = (text || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);

  return base || 'item';
}

// checkExists(candidateSlug) => Promise<boolean>. Appends -2, -3, ... until a
// free slug is found, so duplicates never collide silently.
async function generateUniqueSlug(sourceText, checkExists) {
  const base = slugify(sourceText);
  let candidate = base;
  let attempt = 2;

  while (await checkExists(candidate)) {
    candidate = `${base}-${attempt}`;
    attempt += 1;
  }

  return candidate;
}

module.exports = { slugify, generateUniqueSlug };
