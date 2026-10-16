const { OAuth2Client } = require('google-auth-library');
const { response, getBody, findUserByEmail, createUser, updateUser, safeUser, createSession, setSessionCookie } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, { message: 'Method not allowed' });
  try {
    const { credential } = getBody(event);
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return response(500, { message: 'GOOGLE_CLIENT_ID is not configured in Netlify.' });
    if (!credential) return response(400, { message: 'Google credential is required.' });

    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.email || payload.email_verified !== true) return response(401, { message: 'Google account email could not be verified.' });

    const email = payload.email.toLowerCase();
    let row = await findUserByEmail(email);
    if (row && row.is_active === false) return response(403, { message: 'This account is inactive. Contact an administrator.' });

    if (!row) {
      const adminEmails = String(process.env.ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
      row = await createUser({
        name: payload.name || email.split('@')[0],
        email,
        google_id: payload.sub,
        profile_image: payload.picture || null,
        role: adminEmails.includes(email) ? 'admin' : 'operator',
        is_active: true
      });
    } else {
      row = await updateUser(row.id, {
        google_id: payload.sub,
        profile_image: payload.picture || row.profile_image || null,
        name: payload.name || row.name
      });
    }

    const user = safeUser(row);
    const token = createSession(user);
    return response(200, { success: true, user }, { 'Set-Cookie': setSessionCookie(token) });
  } catch (error) {
    console.error('Google authentication error:', {
      message: error.message,
      statusCode: error.statusCode,
      supabaseStatus: error.supabaseStatus
    });

    const status = Number(error.statusCode) || 500;

    return response(status, {
      message: error.message || 'Google authentication failed.'
    });
  }
};
