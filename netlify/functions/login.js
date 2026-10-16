const { response, getBody, findUserByEmail, safeUser, createSession, setSessionCookie, verifyPassword } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, { message: 'Method not allowed' });
  try {
    const { email, password } = getBody(event);
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !password) return response(400, { message: 'Email and password are required.' });

    const row = await findUserByEmail(cleanEmail);
    if (!row || !row.password_hash) return response(401, { message: 'Invalid email or password.' });
    if (row.is_active === false) return response(403, { message: 'This account is inactive. Contact an administrator.' });

    const valid = await verifyPassword(String(password), row.password_hash);
    if (!valid) return response(401, { message: 'Invalid email or password.' });

    const user = safeUser(row);
    const token = createSession(user);
    return response(200, { success: true, user }, { 'Set-Cookie': setSessionCookie(token) });
  } catch (error) {
    console.error('Login error:', error);
    const status = Number(error?.statusCode) || 500;
    const message = error?.supabaseStatus === 403
      ? 'Supabase rejected the server key (403). Check SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY and make sure the key has server-side database access.'
      : error?.message || 'Login failed. Check your Supabase configuration.';
    return response(status, { message, code: error?.code || undefined });
  }
};
