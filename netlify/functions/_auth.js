const crypto = require('crypto');
const dns = require('dns');

// Prefer IPv4 for local Node/Supabase connections on Windows.
dns.setDefaultResultOrder('ipv4first');
const { securityHeaders } = require('./_security');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);

    const key = await scryptAsync(
        String(password),
        salt,
        64,
        {
            N: 16384,
            r: 8,
            p: 1
        }
    );

    return `scrypt$16384$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function verifyPassword(password, stored) {
    try {
        const [scheme, n, r, p, saltText, hashText] =
            String(stored).split('$');

        if (scheme !== 'scrypt') {
            return false;
        }

        const salt = Buffer.from(saltText, 'base64url');
        const expected = Buffer.from(hashText, 'base64url');

        const actual = await scryptAsync(
            String(password),
            salt,
            expected.length,
            {
                N: Number(n),
                r: Number(r),
                p: Number(p)
            }
        );

        return crypto.timingSafeEqual(actual, expected);
    } catch (_) {
        return false;
    }
}

function base64url(value) {
    return Buffer.from(value)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function signToken(payload) {
    const secret = process.env.SESSION_SECRET;

    if (!secret) {
        throw new Error('SESSION_SECRET is not configured');
    }

    const header = base64url(
        JSON.stringify({
            alg: 'HS256',
            typ: 'JWT'
        })
    );

    const body = base64url(JSON.stringify(payload));

    const signature = crypto
        .createHmac('sha256', secret)
        .update(`${header}.${body}`)
        .digest('base64url');

    return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
    const secret = process.env.SESSION_SECRET;

    if (!secret || !token) {
        return null;
    }

    const parts = token.split('.');

    if (parts.length !== 3) {
        return null;
    }

    const [header, body, signature] = parts;

    const expected = crypto
        .createHmac('sha256', secret)
        .update(`${header}.${body}`)
        .digest('base64url');

    try {
        if (
            !crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expected)
            )
        ) {
            return null;
        }
    } catch (_) {
        return null;
    }

    try {
        const payload = JSON.parse(
            Buffer.from(body, 'base64url').toString('utf8')
        );

        if (
            !payload.exp ||
            payload.exp < Math.floor(Date.now() / 1000)
        ) {
            return null;
        }

        return payload;
    } catch (_) {
        return null;
    }
}

function setSessionCookie(token) {
    const secure =
        process.env.NETLIFY === 'true' ||
        process.env.NODE_ENV === 'production'
            ? '; Secure'
            : '';

    return `rk_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure}`;
}

function clearSessionCookie() {
    const secure =
        process.env.NETLIFY === 'true' ||
        process.env.NODE_ENV === 'production'
            ? '; Secure'
            : '';

    return `rk_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function getCookie(event, name) {
    const raw =
        event.headers?.cookie ||
        event.headers?.Cookie ||
        '';

    const found = raw
        .split(';')
        .map(v => v.trim())
        .find(v => v.startsWith(`${name}=`));

    return found
        ? decodeURIComponent(found.slice(name.length + 1))
        : null;
}

function response(statusCode, body, extraHeaders = {}) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...securityHeaders(extraHeaders)
        },
        body: JSON.stringify(body)
    };
}

function getBody(event) {
    try {
        return JSON.parse(event.body || '{}');
    } catch (_) {
        return {};
    }
}

function safeUser(row) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        picture: row.profile_image || '',
        isActive: row.is_active !== false,
        isLoggedIn: true
    };
}

function isAdmin(user) {
    return user?.role === 'admin';
}



function assertProductionSecrets() {
    if (process.env.NODE_ENV === 'production') {
        if (!process.env.SESSION_SECRET || String(process.env.SESSION_SECRET).length < 32) throw new Error('SESSION_SECRET must be at least 32 characters in production.');
        if (!process.env.SUPABASE_URL || !/^https:\/\/[^\s]+\.supabase\.co\/?$/.test(String(process.env.SUPABASE_URL).trim())) throw new Error('Invalid SUPABASE_URL configuration.');
    }
}

/* =========================
   SUPABASE CONNECTION
   ========================= */

async function supabaseRequest(path, options = {}) {
    assertProductionSecrets();

    const rawUrl = String(process.env.SUPABASE_URL || '').trim().replace(/[\r\n]/g, '');
    const key = String(
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        ''
    ).trim();

    if (!rawUrl) throw Object.assign(new Error('SUPABASE_URL is not configured.'), { statusCode: 500, code: 'SUPABASE_URL_MISSING' });
    if (!key || /^YOUR_/i.test(key)) throw Object.assign(new Error('Supabase server key is missing. Set SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY in .env.'), { statusCode: 500, code: 'SUPABASE_KEY_MISSING' });

    const cleanUrl = rawUrl.replace(/\/+$/, '');
    const requestPath = String(path).replace(/^\/+/, '');
    const requestUrl = `${cleanUrl}/rest/v1/${requestPath}`;
    const target = new URL(requestUrl);

    const headers = {
        apikey: key,
        ...(key.startsWith('sb_secret_')
            ? {}
            : { Authorization: `Bearer ${key}` }),
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...options.headers
    };

    const https = require('https');

    // IMPORTANT: use the Supabase hostname normally. The old implementation
    // connected to Cloudflare by raw IP without a matching Host header, which
    // can produce HTTP 421 (Misdirected Request). Only use an IP as a last
    // resort, and always preserve the original Host/SNI for TLS + routing.
    async function requestToHost(hostname, extra = {}) {
        return new Promise((resolve, reject) => {
            const req = https.request({
                hostname,
                servername: target.hostname,
                port: 443,
                path: `${target.pathname}${target.search}`,
                method: options.method || 'GET',
                headers: {
                    ...headers,
                    ...extra
                },
                timeout: 15000
            }, res => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => {
                    let data = null;
                    try { data = body ? JSON.parse(body) : null; } catch (_) { data = body; }

                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        const message = data?.message || data?.hint || data?.error || `Supabase request failed (${res.statusCode})`;
                        const error = Object.assign(new Error(message), {
                            statusCode: res.statusCode,
                            supabaseStatus: res.statusCode,
                            supabaseCode: data?.code,
                            supabaseDetails: data?.details
                        });
                        reject(error);
                        return;
                    }
                    resolve(data);
                });
            });

            req.on('timeout', () => req.destroy(Object.assign(new Error('Supabase request timed out.'), { code: 'ETIMEDOUT' })));
            req.on('error', error => reject(Object.assign(new Error(`Supabase connection failed (${error.code || 'NETWORK_ERROR'}).`), { statusCode: 503, code: error.code })));

            if (options.body) req.write(options.body);
            req.end();
        });
    }

    try {
        return await requestToHost(target.hostname);
    } catch (firstError) {
        // Never hide real HTTP/auth/database errors. Retry only network errors.
        if (firstError.supabaseStatus) throw firstError;

        const configuredIp = String(process.env.SUPABASE_IPV4 || '').trim();
        if (!configuredIp) throw firstError;

        try {
            return await requestToHost(configuredIp, { Host: target.hostname });
        } catch (fallbackError) {
            if (fallbackError.supabaseStatus) throw fallbackError;
            throw Object.assign(
                new Error(`Unable to connect to Supabase at ${target.hostname}. ${fallbackError.message || firstError.message}`),
                { statusCode: 503, code: fallbackError.code || 'SUPABASE_NETWORK_ERROR' }
            );
        }
    }
}

/* =========================
   USERS
   ========================= */

async function findUserByEmail(email) {

    const rows = await supabaseRequest(
        `users?email=eq.${encodeURIComponent(email)}&select=*`
    );

    return rows?.[0] || null;
}

async function findUserById(id) {

    const rows = await supabaseRequest(
        `users?id=eq.${encodeURIComponent(id)}&select=*`
    );

    return rows?.[0] || null;
}

async function createUser(row) {

    const rows = await supabaseRequest(
        'users',
        {
            method: 'POST',
            headers: {
                Prefer: 'return=representation'
            },
            body: JSON.stringify(row)
        }
    );

    return rows?.[0] || null;
}

async function updateUser(id, patch) {

    const rows = await supabaseRequest(
        `users?id=eq.${encodeURIComponent(id)}`,
        {
            method: 'PATCH',
            headers: {
                Prefer: 'return=representation'
            },
            body: JSON.stringify({
                ...patch,
                updated_at: new Date().toISOString()
            })
        }
    );

    return rows?.[0] || null;
}


/* =========================
   SESSION
   ========================= */

function createSession(user) {

    const now =
        Math.floor(Date.now() / 1000);

    return signToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        iat: now,
        exp: now + 8 * 60 * 60
    });
}

async function authenticatedUser(event) {

    const token =
        getCookie(event, 'rk_session');

    const payload =
        verifyToken(token);

    if (!payload?.sub) {
        return null;
    }

    const row =
        await findUserById(payload.sub);

    if (!row || row.is_active === false) {
        return null;
    }

    return safeUser(row);
}


/* =========================
   EXPORTS
   ========================= */

module.exports = {
    base64url,
    signToken,
    verifyToken,
    setSessionCookie,
    clearSessionCookie,
    getCookie,
    response,
    getBody,
    safeUser,
    isAdmin,
    supabaseRequest,
    findUserByEmail,
    findUserById,
    createUser,
    updateUser,
    createSession,
    authenticatedUser,
    hashPassword,
    verifyPassword
};