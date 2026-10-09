import { STORAGE_KEYS } from '../utils/constants.js';

// Dark-only theme. Light mode was removed from the user panel entirely:
// initTheme() forces dark and wipes any stale 'light' preference left over
// from older builds. toggleTheme/setupThemeToggle are kept as no-ops so any
// leftover call sites don't crash.
export function initTheme() {
    try {
        if (localStorage.getItem(STORAGE_KEYS.theme) === 'light') {
            localStorage.removeItem(STORAGE_KEYS.theme);
        }
    } catch (e) {}
    document.body.classList.remove('light-theme');
}

export function toggleTheme() {
    // Light mode removed — always dark.
}

export function setupThemeToggle() {
    // Light mode removed — the toggle no longer exists in the UI.
}
