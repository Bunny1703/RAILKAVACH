const { response, getBody, authenticatedUser, isAdmin, supabaseRequest, createUser, updateUser, safeUser, hashPassword } = require('./_auth');

exports.handler = async (event) => {
  try {
    const admin = await authenticatedUser(event);
    if (!admin || !isAdmin(admin)) return response(403, { message: 'Admin access required.' });

    if (event.httpMethod === 'GET') {
      const rows = await supabaseRequest('users?select=id,name,email,role,is_active,google_id,created_at,updated_at&order=created_at.desc');
      return response(200, { users: rows.map(safeUser) });
    }

    if (event.httpMethod === 'POST') {
      const { name, email, password, role } = getBody(event);
      const cleanEmail = String(email || '').trim().toLowerCase();
      const allowed = ['admin', 'manager', 'inspector', 'operator'];
      if (!name || !cleanEmail || !password || !allowed.includes(role)) return response(400, { message: 'Name, email, password and a valid role are required.' });
      const existing = await supabaseRequest(`users?email=eq.${encodeURIComponent(cleanEmail)}&select=id`);
      if (existing.length) return response(409, { message: 'A user with that email already exists.' });
      const password_hash = await hashPassword(String(password));
      const row = await createUser({ name: String(name).trim(), email: cleanEmail, password_hash, role, is_active: true });
      return response(201, { user: safeUser(row) });
    }

    if (event.httpMethod === 'PATCH') {
      const id = event.queryStringParameters?.id;
      const { role, is_active, name } = getBody(event);
      const allowed = ['admin', 'manager', 'inspector', 'operator'];
      if (!id) return response(400, { message: 'User id is required.' });
      const patch = {};
      if (name !== undefined) patch.name = String(name).trim();
      if (role !== undefined) {
        if (!allowed.includes(role)) return response(400, { message: 'Invalid role.' });
        patch.role = role;
      }
      if (is_active !== undefined) patch.is_active = Boolean(is_active);
      const row = await updateUser(id, patch);
      if (!row) return response(404, { message: 'User not found.' });
      return response(200, { user: safeUser(row) });
    }

    return response(405, { message: 'Method not allowed' });
  } catch (error) {
    console.error('User management error:', error);
    return response(500, { message: error.message || 'User management failed.' });
  }
};
