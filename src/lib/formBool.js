// HTML form boolean parsing.
//
// A checkbox submits "on" when ticked and nothing at all when unticked. The
// admin forms therefore pair each checkbox with a hidden "false" input of the
// same name, which makes the body value either "false" or ["false", "on"].
// The LAST submitted value wins, and "on"/"true"/"1" are truthy.

function lastValue(val) {
  return Array.isArray(val) ? val[val.length - 1] : val;
}

function isTruthyFormValue(val) {
  const v = lastValue(val);
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === 'on' || s === '1' || s === 'yes';
  }
  return v === true || v === 1;
}

// parseFormBool(undefined, fallback) -> fallback (field not submitted: caller
// decides whether to preserve the stored value or apply a default).
function parseFormBool(val, fallback = false) {
  if (val === undefined || val === null) return fallback;
  return isTruthyFormValue(val);
}

module.exports = { parseFormBool, isTruthyFormValue };
