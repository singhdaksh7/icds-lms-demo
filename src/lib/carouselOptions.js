// Allowlisted review-carousel presentation options shared by the homepage reviews
// section and the per-course reviews section. Admin picks NAMES; the numbers below are
// the only durations/values that ever reach the page (no arbitrary JS/CSS input).
const MODES = ['STATIC', 'SLIDE', 'CONTINUOUS'];
const MODE_LABELS = {
  STATIC: 'Static (no movement, swipeable)',
  SLIDE: 'Slide (pauses between moves)',
  CONTINUOUS: 'Continuous (slow marquee)',
};
// Seconds for one full pass of the review set.
const SPEED_SECONDS = { VERY_SLOW: 45, SLOW: 32, NORMAL: 22 };
const SPEED_LABELS = { VERY_SLOW: 'Very slow (~45s loop)', SLOW: 'Slow (~32s loop)', NORMAL: 'Normal (~22s loop)' };
const SPEEDS = Object.keys(SPEED_SECONDS);
const DIRECTIONS = ['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT'];
const DIRECTION_LABELS = { LEFT_TO_RIGHT: 'Left to right', RIGHT_TO_LEFT: 'Right to left' };

module.exports = { MODES, MODE_LABELS, SPEEDS, SPEED_SECONDS, SPEED_LABELS, DIRECTIONS, DIRECTION_LABELS };
