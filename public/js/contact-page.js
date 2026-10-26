/*
 * /contact enhancements: accessible client-side validation, live character
 * counter, double-submit guard and a WhatsApp prefilled message that follows the
 * selected course. The server validates everything again - this is UX only.
 */
(function () {
  'use strict';
  var form = document.querySelector('[data-contact-form]');
  if (!form) return;

  var feedback = document.getElementById('contact-feedback');
  var submit = form.querySelector('[data-submit]');
  var message = document.getElementById('contact-message');
  var counter = document.getElementById('contact-count');
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var PHONE = /^[0-9+()\-.\s]{5,30}$/;

  // We provide our own accessible messages, so turn the browser bubbles off once JS is running.
  form.setAttribute('novalidate', 'novalidate');

  function errorBox(input) {
    return form.querySelector('[data-error-for="' + input.id + '"]');
  }
  function setError(input, text) {
    var box = errorBox(input);
    if (text) {
      input.classList.add('is-invalid');
      input.setAttribute('aria-invalid', 'true');
      if (box) box.textContent = text;
    } else {
      input.classList.remove('is-invalid');
      input.removeAttribute('aria-invalid');
      if (box) box.textContent = '';
    }
  }

  function check(input) {
    var v = (input.value || '').trim();
    var label = (form.querySelector('label[for="' + input.id + '"]') || {}).textContent || 'This field';
    label = label.replace('*', '').trim();
    if (input.required && !v) return label + ' is required.';
    if (input.id === 'contact-name' && v && v.length < 2) return 'Please enter your full name.';
    if (input.id === 'contact-email' && v && !EMAIL.test(v)) return 'Enter a valid email address.';
    if (input.id === 'contact-phone' && v && !PHONE.test(v)) return 'Phone may contain only digits, spaces and + ( ) - .';
    if (input.id === 'contact-subject' && v && v.length < 3) return 'Subject must be at least 3 characters.';
    if (input.id === 'contact-message' && v && v.length < 10) return 'Please write at least 10 characters.';
    return '';
  }

  var fields = Array.prototype.slice.call(form.querySelectorAll('input:not([type=hidden]):not([name=website]), select, textarea'))
    .filter(function (el) { return !!errorBox(el); });
  fields.forEach(function (input) {
    input.addEventListener('blur', function () { setError(input, check(input)); });
    input.addEventListener('input', function () { if (input.classList.contains('is-invalid')) setError(input, check(input)); });
    input.addEventListener('change', function () { if (input.classList.contains('is-invalid')) setError(input, check(input)); });
  });

  function updateCount() {
    if (!message || !counter) return;
    var n = message.value.length;
    counter.textContent = n + ' / ' + (message.maxLength > 0 ? message.maxLength : 5000);
    counter.classList.toggle('is-near', message.maxLength > 0 && n > message.maxLength * 0.9);
  }
  if (message) { message.addEventListener('input', updateCount); updateCount(); }

  form.addEventListener('submit', function (e) {
    var first = null;
    var problems = [];
    fields.forEach(function (input) {
      var msg = check(input);
      setError(input, msg);
      if (msg) { problems.push(msg); if (!first) first = input; }
    });
    if (problems.length) {
      e.preventDefault();
      if (feedback) {
        feedback.innerHTML = '';
        var box = document.createElement('div');
        box.className = 'ct-alert ct-alert-err';
        box.setAttribute('role', 'alert');
        box.textContent = 'Please fix the highlighted fields and try again.';
        feedback.appendChild(box);
      }
      if (first) first.focus();
      return;
    }
    if (submit) {
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
    }
  });

  // Prefilled WhatsApp text follows the selected course ("Hi, I have a question about <course>").
  var course = form.querySelector('[data-course-select]');
  var links = document.querySelectorAll('[data-wa-link]');
  if (course && links.length) {
    course.addEventListener('change', function () {
      var opt = course.options[course.selectedIndex];
      var title = opt && opt.getAttribute('data-title');
      links.forEach(function (a) {
        var href = a.getAttribute('href') || '';
        var base = href.split('?')[0];
        if (!base) return;
        var subject = title || a.getAttribute('data-wa-default') || '';
        var text = subject ? 'Hi, I have a question about ' + subject : 'Hi, I have a question';
        a.setAttribute('href', base + '?text=' + encodeURIComponent(text));
      });
    });
  }
})();
