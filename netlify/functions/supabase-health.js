const { response, supabaseRequest } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return response(405, { message: 'Method not allowed.' });
  try {
    const rows = await supabaseRequest('users?select=id&limit=1');
    return response(200, { ok: true, service: 'supabase', users_table: true, sample_rows: Array.isArray(rows) ? rows.length : 0 });
  } catch (error) {
    console.error('Supabase health check failed:', error);
    return response(Number(error?.statusCode) || 503, {
      ok: false,
      service: 'supabase',
      status: Number(error?.statusCode) || 503,
      code: error?.code || error?.supabaseCode || 'SUPABASE_ERROR',
      message: error?.supabaseStatus === 403
        ? 'Supabase returned 403. Verify the server key and database permissions.'
        : error?.message || 'Supabase connection failed.'
    });
  }
};
