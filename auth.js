/**
 * vg-task-manager: JWT Authentication Helpers
 *
 * Provides token creation, verification, and middleware
 * to protect API routes with a signed JWT.
 */

const jwt = require('jsonwebtoken');

/**
 * Static secret used for signing tokens.
 * Override with API_JWT_SECRET environment variable in production.
 */
const JWT_SECRET = process.env.API_JWT_SECRET || 'vg-task-manager-secret-key-change-me';
const JWT_EXPIRES_IN = '24h';

/**
 * Create a signed JWT for a user.
 * @param {string} username - The authenticated user's username.
 * @param {string[]} [projects] - Array of authorized project IDs.
 * @returns {string} Signed JWT token string.
 */
function createToken(username, projects = ['project-ludum']) {
  const payload = {
    username,
    projects: Array.isArray(projects) ? projects : ['project-ludum']
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify a JWT token.
 * @param {string} token - The token string to verify.
 * @returns {{username: string, projects?: string[]}|null} Decoded payload if valid, null otherwise.
 */
function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Middleware that validates JWT token from Authorization header.
 * Exempts auth and status endpoints.
 * Sets req.user = { username, projects } on valid requests.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} pathname
 * @returns {object} { valid: boolean, user?: { username: string, projects: string[] }, error?: { status: number, ok: boolean, error: string } }
 */
function verifyRequest(req, res, pathname) {
  // Public endpoints that don't require auth
  const publicPaths = ['/api/auth/register', '/api/auth/login', '/api/status', '/api/mongo/connect', '/api/mongo/disconnect'];
  const isPublic = publicPaths.some(p => pathname === p || (pathname.startsWith('/api/auth/') && pathname.length > 10) || (pathname.startsWith('/api/mongo/')));

  if (isPublic) {
    // Set empty user object for public endpoints
    req.user = {};
    return { valid: true, user: {} };
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: { status: 401, ok: false, error: 'Authorization header missing or invalid' } };
  }

  const token = authHeader.slice(7); // Remove 'Bearer ' prefix
  const decoded = verifyToken(token);

  if (!decoded) {
    return { valid: false, error: { status: 401, ok: false, error: 'Invalid or expired token' } };
  }

  // Attach user info to request
  req.user = {
    username: decoded.username,
    projects: Array.isArray(decoded.projects) ? decoded.projects : ['project-ludum']
  };
  return { valid: true, user: req.user };
}

module.exports = {
  JWT_SECRET,
  JWT_EXPIRES_IN,
  createToken,
  verifyToken,
  verifyRequest,
  publicPaths: [
    '/api/auth/register',
    '/api/auth/login',
    '/api/status',
    '/api/mongo/connect',
    '/api/mongo/disconnect'
  ]
};