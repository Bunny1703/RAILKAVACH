const { response, getBody, findUserByEmail, createUser, safeUser, createSession, setSessionCookie, hashPassword } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, { message: 'Method not allowed' });
  try {
    const { name, email, password, confirmPassword } = getBody(event);
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (cleanName.length < 2) return response(400, { message: 'Enter your full name.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return response(400, { message: 'Enter a valid email address.' });
    if (String(password || '').length < 8) return response(400, { message: 'Password must contain at least 8 characters.' });
    if (password !== confirmPassword) return response(400, { message: 'Passwords do not match.' });

    const existing = await findUserByEmail(cleanEmail);
    if (existing) return response(409, { message: 'An account with this email already exists. Please log in.' });

    const adminEmails = String(process.env.ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
    const role = adminEmails.includes(cleanEmail) ? 'admin' : 'operator';
    const passwordHash = await hashPassword(password);
    const row = await createUser({ name: cleanName, email: cleanEmail, password_hash: passwordHash, role, is_active: true });
    if (!row) return response(500, { message: 'Unable to create the account.' });

    const user = safeUser(row);
    const token = createSession(user);
    return response(201, { success: true, user }, { 'Set-Cookie': setSessionCookie(token) });
  } catch (error) {
    console.error('Registration error:', error);
    const status = Number(error?.statusCode) || 500;
    const message = error?.supabaseStatus === 403
      ? 'Supabase rejected the server key (403). Check SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY and database access.'
      : error?.message || 'Registration failed. Check your Supabase configuration.';
    return response(status, { message, code: error?.code || undefined });
  }
};
