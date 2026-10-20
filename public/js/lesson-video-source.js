/*
 * Private R2 playback. The page never contains a video URL: after the server
 * authorizes the viewer, this script asks /api/lessons/:id/video-source for a
 * short-lived signed URL and points <video> at it. The browser then streams
 * (with Range/seek support) straight from R2, not through the app server.
 *
 * A signed URL expires. When it is about to (or already did, e.g. a long pause
 * followed by a seek), a fresh one is fetched and playback resumes at the same
 * position. Progress tracking (lesson-progress.js) is unaffected: it only
 * listens to the <video> element's events.
 *
 * This is access control, not DRM.
 */
(function () {
  var video = document.getElementById('lesson-video');
  if (!video) return;
  var sourceUrl = video.getAttribute('data-source-url');
  if (!sourceUrl) return;

  var expiresAt = 0;
  var refreshing = null;
  var REFRESH_MARGIN_MS = 30000;

  function fetchSource() {
    return fetch(sourceUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('video-source ' + r.status);
        return r.json();
      })
      .then(function (data) {
        expiresAt = Date.now() + (data.expiresInSeconds || 300) * 1000;
        return data.url;
      });
  }

  function load(resume) {
    if (refreshing) return refreshing;
    var time = resume ? video.currentTime : 0;
    var wasPlaying = resume && !video.paused && !video.ended;
    refreshing = fetchSource()
      .then(function (url) {
        video.src = url;
        if (resume) {
          video.addEventListener('loadedmetadata', function restore() {
            video.removeEventListener('loadedmetadata', restore);
            if (time > 0) video.currentTime = time;
            if (wasPlaying) { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
          });
        }
      })
      .catch(function () {})
      .then(function () { refreshing = null; });
    return refreshing;
  }

  // Expired mid-session (network/403 on a range request): fetch a fresh URL.
  video.addEventListener('error', function () {
    if (Date.now() >= expiresAt - REFRESH_MARGIN_MS) load(true);
  });
  // Seeking issues new range requests; make sure the URL is still valid first.
  video.addEventListener('seeking', function () {
    if (Date.now() >= expiresAt - REFRESH_MARGIN_MS) load(true);
  });
  video.addEventListener('play', function () {
    if (Date.now() >= expiresAt - REFRESH_MARGIN_MS) load(true);
  });

  load(false);
})();
