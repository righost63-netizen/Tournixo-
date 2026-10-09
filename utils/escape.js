// ════════════════════════════════════════════════════════════════
// HTML escaping — single shared implementation.
// ALWAYS use escHtml() when injecting user-controlled strings
// (names, team names, UIDs, chat text…) into innerHTML.
// ════════════════════════════════════════════════════════════════

export function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
