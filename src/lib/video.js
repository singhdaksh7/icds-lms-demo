// Video provider abstraction. Never inject raw DB HTML/URLs into a template
// with <%- %> — this module inspects a stored videoUrl and, only for
// recognized/trusted providers, returns a clean, server-constructed embed
// URL safe to place in an <iframe src="<%= embedUrl %>">. Anything else
// (unsupported provider, malformed URL) returns null so the caller can show
// a "Video unavailable" state instead of guessing.
function parseVideoEmbed(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  // YouTube: watch?v=, embed/, and youtu.be short links.
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const watchId = url.searchParams.get('v');
    if (watchId && /^[a-zA-Z0-9_-]{6,20}$/.test(watchId)) {
      return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${watchId}` };
    }
    const embedMatch = url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{6,20})/);
    if (embedMatch) {
      return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${embedMatch[1]}` };
    }
    return null;
  }

  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '');
    if (/^[a-zA-Z0-9_-]{6,20}$/.test(id)) {
      return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${id}` };
    }
    return null;
  }

  // Vimeo: vimeo.com/<id> and player.vimeo.com/video/<id>.
  if (host === 'vimeo.com') {
    const match = url.pathname.match(/^\/(\d+)/);
    if (match) {
      return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${match[1]}` };
    }
    return null;
  }

  if (host === 'player.vimeo.com') {
    const match = url.pathname.match(/^\/video\/(\d+)/);
    if (match) {
      return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${match[1]}` };
    }
    return null;
  }

  return null;
}

module.exports = { parseVideoEmbed };
