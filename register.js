function showStatus(message, type='error') {
  const el = document.getElementById('register-status');
  el.textContent = message;
  el.className = `login-status ${type}`;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('toggle-password').addEventListener('click', () => {
    const input = document.getElementById('password');
    const icon = document.querySelector('#toggle-password i');
    input.type = input.type === 'password' ? 'text' : 'password';
    icon.className = input.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
  });

  document.getElementById('register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = document.getElementById('register-btn');
    const payload = {
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
      confirmPassword: document.getElementById('confirmPassword').value
    };
    btn.disabled = true; btn.textContent = 'Creating account...';
    try {
      const res = await fetch('/auth/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Registration failed.');
      showStatus('Account created. Opening your dashboard...', 'success');
      setTimeout(() => window.location.href = 'index.html', 500);
    } catch (err) {
      showStatus(err.message || 'Unable to create account.');
    } finally { btn.disabled = false; btn.textContent = 'Create Account'; }
  });
});
