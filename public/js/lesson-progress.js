/*
 * Resume-playback + progress tracking for a protected local lesson video.
 *
 * Behavior (see README / demo spec):
 *  - On loadedmetadata, seeks to the saved position (never before metadata
 *    is available — an early seek on a video with no duration yet is a
 *    silent no-op/invalid seek in most browsers).
 *  - Saves position+duration to the server at most every ~12s while
 *    playing, plus on pause/ended/tab-hidden/page-hide — never on every
 *    timeupdate tick, to avoid hundreds of writes per viewing session.
 *  - Server is the source of truth for completion (>=90% watched); this
 *    script only reports raw position/duration, never a completed flag.
 */
(function () {
  var video = document.getElementById('lesson-video');
  if (!video) return;

  var progressUrl = video.getAttribute('data-progress-url');
  var csrfToken = video.getAttribute('data-csrf');
  var resumeSeconds = parseInt(video.getAttribute('data-resume-seconds'), 10) || 0;

  var SAVE_INTERVAL_MS = 12000;
  var lastSavedAt = 0;
  var lastSentPosition = -1;
  var hasResumed = false;

  function sendProgress(useBeacon) {
    var position = Math.floor(video.currentTime || 0);
    var duration = Math.floor(video.duration || 0);
    if (!duration || position === lastSentPosition) return;

    var payload = JSON.stringify({
      _csrf: csrfToken,
      positionSeconds: position,
      durationSeconds: duration,
    });

    if (useBeacon && navigator.sendBeacon) {
      var blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(progressUrl, blob);
    } else {
      fetch(progressUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(function () {});
    }

    lastSentPosition = position;
    lastSavedAt = Date.now();
  }

  video.addEventListener('loadedmetadata', function () {
    if (hasResumed) return;
    hasResumed = true;
    if (resumeSeconds > 0 && Number.isFinite(video.duration) && resumeSeconds < video.duration - 1) {
      video.currentTime = resumeSeconds;
    }
  });

  video.addEventListener('timeupdate', function () {
    if (Date.now() - lastSavedAt >= SAVE_INTERVAL_MS) {
      sendProgress(false);
    }
  });

  video.addEventListener('pause', function () {
    sendProgress(false);
  });

  video.addEventListener('ended', function () {
    sendProgress(false);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      sendProgress(true);
    }
  });

  window.addEventListener('pagehide', function () {
    sendProgress(true);
  });
})();
