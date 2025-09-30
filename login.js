document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('login-form');
    
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const role = document.getElementById('role').value;
        const password = document.getElementById('password').value;
        
        // Simple validation
        if (!email || !role || !password) {
            showError('All fields are required');
            return;
        }
        
        // Store login info in session storage
        sessionStorage.setItem('user', JSON.stringify({
            email: email,
            role: role,
            isLoggedIn: true
        }));
        
        // Redirect to main application
        window.location.href = 'index.html';
    });
    
    function showError(message) {
        // Create error element if it doesn't exist
        let errorEl = document.querySelector('.login-error');
        if (!errorEl) {
            errorEl = document.createElement('div');
            errorEl.className = 'login-error';
            errorEl.style.color = '#dc3545';
            errorEl.style.marginTop = '1rem';
            errorEl.style.textAlign = 'center';
            loginForm.appendChild(errorEl);
        }
        
        errorEl.textContent = message;
    }
    
    // Check if user is already logged in
    const user = JSON.parse(sessionStorage.getItem('user') || '{}');
    if (user.isLoggedIn) {
        window.location.href = 'index.html';
    }
});