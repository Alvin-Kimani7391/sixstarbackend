const jwt = require('jsonwebtoken');

// Generates a JWT and sets it as an httpOnly cookie (also returned in the response body
// so a mobile app or non-browser client can use it as a Bearer token instead)
const generateToken = (res, userId) => {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // must be true in production (HTTPS only)
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' required for Vercel <-> Render cross-domain
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });

  return token;
};

module.exports = generateToken;
