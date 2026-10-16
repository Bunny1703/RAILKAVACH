const { response, authenticatedUser } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return response(405, { message: 'Method not allowed' });
  try {
    const user = await authenticatedUser(event);
    if (!user) return response(401, { authenticated: false, message: 'Not authenticated' });
    return response(200, { authenticated: true, user });
  } catch (error) {
    console.error('Session check error:', error);
    return response(500, { authenticated: false, message: 'Unable to verify session.' });
  }
};
