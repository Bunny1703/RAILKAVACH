function securityHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    ...extra
  };
}

function validateText(value, label = 'Value', maxLength = 1000) {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).trim();
  if (text.length > maxLength) {
    throw Object.assign(new Error(`${label} must be ${maxLength} characters or fewer.`), { statusCode: 400 });
  }
  return text;
}

const PERMISSIONS = {
  admin: new Set(['assets:write', 'inventory:write', 'inspections:write', 'notifications:write', 'audit:read', 'users:write']),
  operator: new Set(['assets:write', 'inventory:write', 'inspections:write', 'notifications:write', 'audit:read'])
};

function requirePermission(user, permission) {
  if (!user) throw Object.assign(new Error('Not authenticated.'), { statusCode: 401 });
  const role = String(user.role || '').toLowerCase();
  if (!PERMISSIONS[role]?.has(permission)) {
    throw Object.assign(new Error(`Permission denied: ${permission}`), { statusCode: 403 });
  }
  return true;
}

module.exports = { securityHeaders, validateText, requirePermission };
