/*
 * Deters casual right-click "Save video as..." on the protected lesson
 * player only. This is download deterrence, not DRM — it cannot stop a
 * determined user from capturing an MP4 stream, and does not claim to.
 * Uses addEventListener (not an inline `oncontextmenu` attribute) so it
 * keeps working if a Content-Security-Policy without 'unsafe-inline' is
 * ever enabled for script handlers. Scoped to #lesson-video only — the
 * rest of the site's right-click menu is untouched.
 */
(function () {
  var video = document.getElementById('lesson-video');
  if (!video) return;

  video.addEventListener('contextmenu', function (event) {
    event.preventDefault();
  });
})();
