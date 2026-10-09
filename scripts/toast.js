import { TOAST_ICONS } from '../utils/constants.js';

export function showToast(msg, type = 'default', dur = 3000) {
    let c = document.getElementById('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        (document.getElementById('app') || document.body).appendChild(c);
    }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    // textContent (not innerHTML): messages include user-controlled text such as
    // team names, and must never be interpreted as HTML.
    const icon = document.createElement('span');
    icon.textContent = TOAST_ICONS[type] || '🔔';
    const text = document.createElement('span');
    text.textContent = String(msg ?? '');
    t.append(icon, text);
    c.appendChild(t);
    setTimeout(() => {
        t.classList.add('hide');
        setTimeout(() => t.remove(), 300);
    }, dur);
}

// Multi-page helper: a toast that must survive a page change
// (e.g. "Signed out successfully", "Welcome back!"). It is shown on the next page.
const FLASH_KEY = 'ff_flash_toast';

export function flashToast(msg, type = 'default', dur = 3000) {
    try {
        sessionStorage.setItem(FLASH_KEY, JSON.stringify({
            msg,
            type,
            dur
        }));
    } catch (e) {}
}

export function showPendingFlash() {
    try {
        const raw = sessionStorage.getItem(FLASH_KEY);
        if (!raw) return;
        sessionStorage.removeItem(FLASH_KEY);
        const f = JSON.parse(raw);
        if (f && f.msg) showToast(f.msg, f.type, f.dur);
    } catch (e) {}
}

window.showToast = showToast;