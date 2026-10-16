const { response, clearSessionCookie } = require('./_auth');
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, { message: 'Method not allowed' });
  return response(200, { success: true }, { 'Set-Cookie': clearSessionCookie() });
};
