// ════════════════════════════════════════════════════════════════
// Auth UI handlers: login, register, forgot password, logout.
// • login.html / register.html load this file directly (data-page decides).
// • profile page imports { confirmLogout } from here (no page init there).
// ════════════════════════════════════════════════════════════════
import { initPage } from './app.js';
import { showToast, flashToast } from './toast.js';
import { openModal, closeModal, showConfirm } from './modal.js';
import { redirectToLogin } from './navigation.js';
import { goReplace } from '../config/app-config.js';
import { setLoading, mountComponent } from '../utils/dom-helpers.js';
import { isValidEmail, isNumeric, MIN_PASSWORD_LENGTH } from '../utils/validators.js';
import { loginWithEmail, sendResetEmail, registerUser, logoutUser, resendVerificationEmail } from '../services/auth.service.js';

let _forgotModalReady = null;

// ── Resend verification email ──
const RESEND_COOLDOWN_MS = 60 * 1000;
let _resendLastAt = 0;
let _resendTimer = null;

function removeResendButton() {
    if (_resendTimer) { clearInterval(_resendTimer); _resendTimer = null; }
    const old = document.getElementById('resend-verify-btn');
    if (old) old.remove();
}

function showResendButton() {
    if (document.getElementById('resend-verify-btn')) return;
    const loginBtn = document.getElementById('login-btn');
    if (!loginBtn) return;
    const btn = document.createElement('button');
    btn.id = 'resend-verify-btn';
    btn.type = 'button';
    btn.className = 'btn btn-secondary';
    btn.style.marginTop = '12px';
    btn.textContent = 'Resend verification email';
    btn.onclick = resendVerification;
    loginBtn.insertAdjacentElement('afterend', btn);
}

function startResendCooldown(btn) {
    if (_resendTimer) clearInterval(_resendTimer);
    const tick = () => {
        const left = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - _resendLastAt)) / 1000);
        if (left <= 0) {
            clearInterval(_resendTimer);
            _resendTimer = null;
            btn.disabled = false;
            btn.textContent = 'Resend verification email';
        } else {
            btn.disabled = true;
            btn.textContent = 'Resend again in ' + left + 's';
        }
    };
    tick();
    _resendTimer = setInterval(tick, 1000);
}

export async function resendVerification() {
    const btn = document.getElementById('resend-verify-btn');
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value;
    if (!email || !pass) {
        showToast('Enter your email and password first', 'error');
        return;
    }
    if (Date.now() - _resendLastAt < RESEND_COOLDOWN_MS) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    try {
        await resendVerificationEmail(email, pass);
        _resendLastAt = Date.now();
        showToast('Verification link sent to ' + email + '. Also check your Spam folder.', 'success', 6000);
        if (btn) startResendCooldown(btn);
    } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Resend verification email'; }
        const msgs = {
            'auth/invalid-credential': 'Invalid email or password',
            'auth/wrong-password': 'Incorrect password',
            'auth/user-not-found': 'No account found',
            'auth/invalid-email': 'Invalid email',
            'auth/too-many-requests': 'Too many attempts. Try again later.',
            'auth/email-already-verified': 'Your email is already verified. You can sign in now.'
        };
        showToast(msgs[e.code] || e.message, 'error', 5000);
        if (e.code === 'auth/email-already-verified') removeResendButton();
    }
}

export async function doLogin() {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value;
    if (!email || !pass) {
        showToast('Please fill all fields', 'error');
        return;
    }
    setLoading('login-btn', true);
    removeResendButton();
    try {
        // On success, scripts/app.js (auth listener) redirects to home
        await loginWithEmail(email, pass);
    } catch (e) {
        setLoading('login-btn', false);
        const msgs = {
            'auth/invalid-credential': 'Invalid email or password',
            'auth/user-not-found': 'No account found',
            'auth/wrong-password': 'Incorrect password',
            'auth/invalid-email': 'Invalid email',
            'auth/too-many-requests': 'Too many attempts. Try later.',
            'auth/email-not-verified': 'Please verify your email first. Check your inbox for the verification link.'
        };
        showToast(msgs[e.code] || e.message, 'error');
        if (e.code === 'auth/email-not-verified') showResendButton();
    }
}

export async function showForgotPass() {
    if (_forgotModalReady) await _forgotModalReady;
    const loginEmail = document.getElementById('login-email')?.value.trim() || '';
    const forgotInput = document.getElementById('forgot-email');
    if (forgotInput) forgotInput.value = loginEmail;
    openModal('modal-forgot-pass');
}

export async function sendPasswordReset() {
    const email = document.getElementById('forgot-email').value.trim();
    if (!email) {
        showToast('Please enter your email', 'error');
        return;
    }
    if (!isValidEmail(email)) {
        showToast('Please enter a valid email', 'error');
        return;
    }
    setLoading('forgot-send-btn', true);
    try {
        await sendResetEmail(email);
        setLoading('forgot-send-btn', false);
        showToast('Reset link sent! Check your email inbox.', 'success', 5000);
        closeModal('modal-forgot-pass');
    } catch (e) {
        setLoading('forgot-send-btn', false);
        const msgs = {
            'auth/user-not-found': 'No account found with this email',
            'auth/invalid-email': 'Invalid email address',
            'auth/too-many-requests': 'Too many attempts. Try again later.'
        };
        showToast(msgs[e.code] || e.message, 'error');
    }
}

export async function doRegister() {
    const name = document.getElementById('reg-name').value.trim();
    const ffUID = document.getElementById('reg-ffuid').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-pass').value;
    const cpass = document.getElementById('reg-cpass').value;

    if (!name || !ffUID || !email || !pass || !cpass) {
        showToast('Please fill all fields', 'error');
        return;
    }
    if (!isNumeric(ffUID)) {
        showToast('Free Fire UID must be numeric', 'error');
        return;
    }
    // v6: the HTML pattern="[0-9]{8,12}" never runs (no <form> — Enter is handled
    // manually), so enforce the length here. Real FF UIDs are 9–11 digits.
    if (!/^\d{8,12}$/.test(ffUID)) {
        showToast('Free Fire UID must be 8–12 digits', 'error');
        return;
    }
    if (pass !== cpass) {
        showToast('Passwords do not match', 'error');
        return;
    }
    if (pass.length < MIN_PASSWORD_LENGTH) {
        showToast('Password must be at least 6 characters', 'error');
        return;
    }

    if (!document.getElementById('reg-terms')?.checked) {
        showToast('Please accept the Terms & Conditions to continue', 'error');
        return;
    }

    setLoading('reg-btn', true);
    try {
        await registerUser({ name, ffUID, email, pass });
        // Account is created, but access is held until the email is verified.
        flashToast('Account created! Verification link sent to ' + email + '. Verify it, then sign in.', 'success');
        goReplace('login');
    } catch (e) {
        setLoading('reg-btn', false);
        const msgs = {
            'auth/email-already-in-use': 'This email is already registered',
            'auth/invalid-email': 'Invalid email format',
            'auth/weak-password': 'Password too weak'
        };
        showToast(msgs[e.code] || e.message, 'error', 4500);
    }
}

// Used by the profile page "Log Out" button
export function confirmLogout() {
    showConfirm('Log Out', 'Are you sure you want to sign out?', async () => {
        flashToast('Signed out successfully', 'success');
        await logoutUser();
        redirectToLogin();
    });
}

// Inline onclick handlers in the HTML need these on window (same names as original)
window.doLogin = doLogin;
window.resendVerification = resendVerification;
window.showForgotPass = showForgotPass;
window.sendPasswordReset = sendPasswordReset;
window.doRegister = doRegister;
window.confirmLogout = confirmLogout;

// ── Enter / mobile keyboard "Go" support ──
// No <form> is used, so we handle Enter ourselves. Delegated on document so it
// also covers the forgot-password modal, which is mounted after page load.
//   next   : Enter moves focus to that field
//   submit : Enter runs the action (only if its button is not already loading)
const ENTER_FLOW = {
    'login-email':  { next: 'login-pass' },
    'login-pass':   { submit: 'login-btn', run: () => doLogin() },
    'reg-name':     { next: 'reg-ffuid' },
    'reg-ffuid':    { next: 'reg-email' },
    'reg-email':    { next: 'reg-pass' },
    'reg-pass':     { next: 'reg-cpass' },
    'reg-cpass':    { submit: 'reg-btn', run: () => doRegister() },
    'forgot-email': { submit: 'forgot-send-btn', run: () => sendPasswordReset() }
};

// Shows "Next" / "Go" on the mobile keyboard's action key
document.addEventListener('focusin', (e) => {
    const flow = ENTER_FLOW[e.target && e.target.id];
    if (flow) e.target.enterKeyHint = flow.next ? 'next' : 'go';
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    const flow = ENTER_FLOW[e.target && e.target.id];
    if (!flow) return;
    e.preventDefault();
    if (flow.next) {
        const nextEl = document.getElementById(flow.next);
        if (nextEl) nextEl.focus();
        return;
    }
    const btn = document.getElementById(flow.submit);
    if (btn && btn.disabled) return; // already submitting
    flow.run();
});

// ── Page init (only on login / register pages) ──
const _page = document.body && document.body.dataset ? document.body.dataset.page : null;
if (_page === 'login' || _page === 'register') {
    if (_page === 'login') {
        _forgotModalReady = mountComponent('forgot-password-modal', document.getElementById('app'));
    }
    initPage({ page: _page });
}