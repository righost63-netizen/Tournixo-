import { assetUrl } from '../config/app-config.js';

// ── Spinner on a button (same as original setLoading) ──
export function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (loading) {
        btn.disabled = true;
        btn._orig = btn.innerHTML;
        btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;"></div>';
    } else {
        btn.disabled = false;
        if (btn._orig) btn.innerHTML = btn._orig;
    }
}

// ── Show/hide password (used by inline onclick in login/register) ──
export function togglePass(id, btn) {
    const inp = document.getElementById(id);
    if (!inp) return;
    if (inp.type === 'password') {
        inp.type = 'text';
        btn.textContent = '🙈';
    } else {
        inp.type = 'password';
        btn.textContent = '👁️';
    }
}

// ── Copy to clipboard (uses window.showToast, defined by scripts/toast.js) ──
export function copyText(text, label) {
    const done = () => window.showToast && window.showToast(`${label} copied!`, 'success', 1500);
    const fallback = () => {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        done();
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(fallback);
    else fallback();
}

// ── Shared HTML components (components/*.html) ──
const _componentCache = {};

export async function loadComponent(name) {
    if (!_componentCache[name]) {
        const res = await fetch(assetUrl(`components/${name}.html`));
        if (!res.ok) throw new Error(`Component "${name}" failed to load (${res.status})`);
        _componentCache[name] = await res.text();
    }
    return _componentCache[name];
}

// Inserts a component into the page. target = element or CSS selector.
export async function mountComponent(name, target = document.body, position = 'beforeend') {
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) return null;
    const html = await loadComponent(name);
    host.insertAdjacentHTML(position, html);
    return host;
}

// Inline onclick handlers in the HTML need these on window (same as original)
window.togglePass = togglePass;
window.copyText = copyText;