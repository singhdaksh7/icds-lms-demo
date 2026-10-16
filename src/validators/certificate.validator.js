const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const NOTE_MIN = 5;
const NOTE_MAX = 500;

function isRealIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Validates the Admin "Issue Certificate" form. The student is identified by
// email (picked from a searchable list), the course by numeric id. The
// reason/note is mandatory: an override must never look like a normal
// completion. `today` is injectable for tests.
function validateAdminCertificate(body = {}, today = new Date()) {
  const errors = [];

  const studentEmail = typeof body.studentEmail === 'string' ? body.studentEmail.trim().toLowerCase().slice(0, 254) : '';
  if (!EMAIL_PATTERN.test(studentEmail)) errors.push('Choose a student from the list.');

  const rawCourse = typeof body.courseId === 'string' ? body.courseId.trim() : '';
  const courseId = /^\d{1,10}$/.test(rawCourse) ? Number(rawCourse) : 0;
  if (!courseId || courseId > 2147483647) errors.push('Choose a course.');

  const issueDate = typeof body.issueDate === 'string' ? body.issueDate.trim() : '';
  let issuedAt = null;
  if (!isRealIsoDate(issueDate)) {
    errors.push('Issue date must be a valid date.');
  } else if (issueDate > today.toISOString().slice(0, 10)) {
    errors.push('Issue date cannot be in the future.');
  } else {
    issuedAt = new Date(`${issueDate}T12:00:00Z`);
  }

  const adminNote = (typeof body.adminNote === 'string' ? body.adminNote : '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .trim();
  if (adminNote.length < NOTE_MIN) errors.push(`A reason for the override is required (at least ${NOTE_MIN} characters).`);
  else if (adminNote.length > NOTE_MAX) errors.push(`The reason must be at most ${NOTE_MAX} characters.`);

  return { errors, values: { studentEmail, courseId, issueDate, issuedAt, adminNote } };
}

module.exports = { validateAdminCertificate, NOTE_MIN, NOTE_MAX };
