/*
 * Resume-playback + genuine watched-time tracking for a protected local
 * lesson video.
 *
 * Two independent concepts are tracked and reported separately — this is
 * deliberate, not an implementation detail:
 *   - lastPositionSeconds (resume): raw playback position, always the
 *     current currentTime. Can legitimately be anywhere in the video.
 *   - watchedDeltaSeconds (progress/completion): accumulated *legitimate*
 *     playback time since the last save. Only counted while the video is
 *     actually playing, not seeking, and the observed time delta is
 *     small/plausible — so dragging the scrubber to the end never reports
 *     "watched" time and can never satisfy the server's completion check.
 *
 * Behavior:
 *  - On loadedmetadata, resumes to the saved lastPositionSeconds (never
 *    before metadata is available). Does not resume within ~1s of the end.
 *  - Saves to the server at most every ~12s while playing, plus on
 *    pause/ended/tab-hidden/page-hide — never on every timeupdate tick.
 *  - Server re-clamps and re-validates everything this script sends; it is
 *    never trusted as-is (see src/services/progress.service.js).
 */
(function () {
  var video = document.getElementById('lesson-video');
  if (!video) return;

  var progressUrl = video.getAttribute('data-progress-url');
  var csrfToken = video.getAttribute('data-csrf');
  var resumeSeconds = parseInt(video.getAttribute('data-resume-seconds'), 10) || 0;

  var SAVE_INTERVAL_MS = 12000;
  // A little above the save interval's plausible per-tick delta — timeupdate
  // fires roughly every 250ms during normal playback, so any single delta
  // larger than a couple of seconds is almost certainly a seek, a tab
  // resuming from background, or a stall/resync, not genuine watching.
  var MAX_PLAUSIBLE_TICK_DELTA = 2;

  var lastSavedAt = 0;
  var lastSentPosition = -1;
  var hasResumed = false;
  var lastTickTime = null; // video.currentTime at the previous timeupdate
  var sessionWatchedSeconds = 0; // accumulated legitimate watched time, not yet saved

  function sendProgress(useBeacon) {
    var position = Math.floor(video.currentTime || 0);
    var duration = Math.floor(video.duration || 0);
    var delta = sessionWatchedSeconds;

    // Still nothing new to report and position hasn't moved: skip the call.
    if (!duration || (position === lastSentPosition && delta <= 0)) return;

    var payload = JSON.stringify({
      _csrf: csrfToken,
      positionSeconds: position,
      durationSeconds: duration,
      watchedDeltaSeconds: Math.floor(delta),
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
    // Reset the local accumulator only after attempting to send — the
    // server independently re-clamps whatever arrives, so an occasional
    // lost beacon just means a small amount of watched time isn't
    // credited, never double-credited.
    sessionWatchedSeconds = 0;
  }

  video.addEventListener('loadedmetadata', function () {
    if (hasResumed) return;
    hasResumed = true;
    if (resumeSeconds > 0 && Number.isFinite(video.duration) && resumeSeconds < video.duration - 1) {
      video.currentTime = resumeSeconds;
    }
    lastTickTime = video.currentTime;
  });

  video.addEventListener('seeking', function () {
    // A seek is in flight: whatever currentTime lands on next should not
    // be diffed against the pre-seek time as if it were played through.
    lastTickTime = null;
  });

  video.addEventListener('seeked', function () {
    lastTickTime = video.currentTime;
  });

  video.addEventListener('timeupdate', function () {
    if (!video.paused && !video.seeking && lastTickTime !== null) {
      var delta = video.currentTime - lastTickTime;
      if (delta > 0 && delta <= MAX_PLAUSIBLE_TICK_DELTA) {
        sessionWatchedSeconds += delta;
      }
      // delta <= 0 (rewind) or delta > threshold (seek/jump/resync): not
      // counted as watched time, but still resets the reference point
      // below so the next tick measures from here, not from a stale
      // pre-jump position.
    }
    lastTickTime = video.currentTime;

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
