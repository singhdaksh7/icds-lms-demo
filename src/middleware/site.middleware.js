const site = require('../config/site');
module.exports = (req, res, next) => { res.locals.site = site; next(); };
