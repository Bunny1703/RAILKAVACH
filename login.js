function showStatus(message, type = 'error') {
  const el = document.getElementById('login-status');
  if (!el) return;
  el.textContent = message;
  el.className = `login-status ${type}`;
}

function setFieldError(id, message) {
  const input = document.getElementById(id);
  const error = document.getElementById(`${id}-error`);
  const wrap = input?.closest('.input-wrap');
  if (error) error.textContent = message || '';
  if (wrap) wrap.classList.toggle('invalid', Boolean(message));
}

function clearFieldErrors() {
  setFieldError('email', '');
  setFieldError('password', '');
}

function validateLogin(email, password) {
  clearFieldErrors();
  let valid = true;

  if (!email) {
    setFieldError('email', 'Please enter your email address.');
    valid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFieldError('email', 'Enter a valid email address.');
    valid = false;
  }

  if (!password) {
    setFieldError('password', 'Please enter your password.');
    valid = false;
  }

  return valid;
}

function setLoading(loading) {
  const btn = document.getElementById('login-btn');
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
  btn.setAttribute('aria-busy', String(loading));
}

async function loginWithPassword(event) {
  event.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!validateLogin(email, password)) {
    showStatus('Please check the highlighted fields.');
    return;
  }

  setLoading(true);
  showStatus('Signing you in…', 'info');

  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });

    let data = {};
    try { data = await res.json(); } catch (_) {}

    if (!res.ok) {
      throw new Error(data.message || 'Incorrect email or password.');
    }

    showStatus(`Welcome, ${data.user?.name || 'back'}!`, 'success');
    setTimeout(() => { window.location.href = 'index.html'; }, 450);
  } catch (err) {
    console.error(err);
    showStatus(err.message || 'Unable to sign in. Please try again.');
  } finally {
    setLoading(false);
  }
}

async function handleCredentialResponse(response) {
  showStatus('Verifying your Google account…', 'info');

  try {
    const res = await fetch('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ credential: response.credential })
    });

    let data = {};
    try { data = await res.json(); } catch (_) {}

    if (!res.ok) throw new Error(data.message || 'Google login failed.');

    showStatus(`Welcome, ${data.user?.name || 'back'}!`, 'success');
    setTimeout(() => { window.location.href = 'index.html'; }, 450);
  } catch (err) {
    console.error(err);
    showStatus(err.message || 'Unable to sign in with Google.');
  }
}

function renderGoogleButton() {
  const container = document.getElementById('google-button');
  const clientId = window.RAILKAVACH_GOOGLE_CLIENT_ID || '';

  if (!clientId || clientId.includes('PASTE_YOUR')) {
    container.innerHTML = '<div class="google-config-warning">Google Sign-In is not configured yet.</div>';
    return;
  }

  if (!window.google?.accounts?.id) {
    setTimeout(renderGoogleButton, 200);
    return;
  }

  google.accounts.id.initialize({
    client_id: clientId,
    callback: handleCredentialResponse,
    auto_select: false,
    cancel_on_tap_outside: true
  });

  google.accounts.id.renderButton(container, {
    theme: 'outline',
    size: 'large',
    width: Math.min(386, Math.max(280, container.clientWidth || 386)),
    text: 'signin_with',
    shape: 'rectangular',
    logo_alignment: 'left'
  });
}

async function checkExistingSession() {
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (res.ok) window.location.replace('index.html');
  } catch (_) {}
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const toggle = document.getElementById('toggle-password');

  form?.addEventListener('submit', loginWithPassword);

  [email, password].forEach(input => {
    input?.addEventListener('input', () => {
      const id = input.id;
      if (input.value.trim()) setFieldError(id, '');
      const status = document.getElementById('login-status');
      if (status) showStatus('');
    });
  });

  toggle?.addEventListener('click', () => {
    const showing = password.type === 'password';
    password.type = showing ? 'text' : 'password';
    toggle.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
    toggle.setAttribute('aria-pressed', String(showing));
    toggle.innerHTML = `<i class="fas ${showing ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
    password.focus();
  });

  renderGoogleButton();
  checkExistingSession();
});
