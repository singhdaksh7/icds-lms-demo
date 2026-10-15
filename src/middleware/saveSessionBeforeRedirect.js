// express-session writes a response's headers (including a redirect's
// Location and any new session cookie) to the client BEFORE the session
// store write has finished, and only ends the response afterwards. A browser
// follows a redirect as soon as it has the headers, so on a slower session
// store (database latency / load) the follow-up request can arrive before the
// new session row exists: the user is bounced back to the login page right
// after a successful login, or a flash message ("Course created") is lost.
//
// Saving the session explicitly before the redirect is sent closes that
// window. It adds no extra database write: once saved, express-session sees
// the session as unmodified and skips its own save at the end of the response.
function saveSessionBeforeRedirect(req, res, next) {
  const redirect = res.redirect.bind(res);

  res.redirect = function redirectAfterSessionSave(...args) {
    if (!req.session || typeof req.session.save !== 'function') {
      return redirect(...args);
    }
    return req.session.save((err) => {
      if (err) {
        console.error('Session save before redirect failed:', err.message);
      }
      redirect(...args);
    });
  };

  next();
}

module.exports = saveSessionBeforeRedirect;
