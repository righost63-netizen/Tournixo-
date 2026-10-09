/*
 * ─────────────────────────────────────────────────────────────
 * FIXES APPLIED:
 * 1. ❌ Hard-coded values ছড়িয়ে ছিল পুরো app এ:
 *    - min-withdrawal 100 (wallet.js, withdrawal.js)
 *    - notifications TTL 30*60*1000, 86400000
 *    - terms/help cache TTL/key duplicate
 *    ✅ সব centralize করা হলো এখানে:
 *    - APP_CONFIG.defaultMinWithdrawal
 *    - CACHE_TTL.notifications*
 *    - STORAGE_KEYS.terms/help এখন একজায়গায়
 * 2. ✅ STORAGE_KEYS এ duplicate key (terms/help) ঠিক করা হলো।
 *    আগে terms.js:6-7 & help-support.js:6-7 এ আলাদা করে লেখা ছিল;
 *    এখন সব এখান থেকে import হবে।
 * 3. ✅ REMINDER_KEY এবং REMINDER_WINDOW_MS centralized।
 * ─────────────────────────────────────────────────────────────
 */

// localStorage keys — single source of truth
export const STORAGE_KEYS = {
    theme: 'ff_theme',
    notifications: 'ff_notifications',
    cacheVersions: 'ff_cache_versions_v1',
    banners: 'ff_banners_cache_v1',
    gameModes: 'ff_gamemodes_cache',
    terms: 'ff_terms_cache',
    help: 'ff_help_cache',
    reminders: 'ff_reminders_v1'   // ✅ moved from notifications.service.js
};

export const CACHE_PREFIX = 'ff_';

// Cache lifetimes (ms)
export const CACHE_TTL = {
    banners: 3600000,        // 1 hour
    gameModes: 3600000,      // 1 hour
    terms: 86400000,         // 24 hours
    help: 3600000,           // 1 hour
    // ✅ moved from notifications.service.js — no more magic numbers
    reminderWindowMs: 86400000,        // 24 hours
    reminderLeadTimeMs: 30 * 60 * 1000 // 30 minutes before start
};

export const CACHE_FIELD_MAP = {
    tournaments: ['ff_home_tourn_cache', 'ff_tourn_list_', 'ff_tourn_detail_'],
    featured: ['ff_featured_tourn_cache'],
    banners: ['ff_banners_cache_v1'],
    gameModes: ['ff_gamemodes_cache'],
    leaderboard: ['ff_leaderboard_cache'],
    rules: ['ff_tourn_detail_'],
    organizer: ['ff_help_cache'],
    terms: ['ff_terms_cache'],
    faq: ['ff_faq_cache'],
    help: ['ff_help_cache']
};

export const TOAST_ICONS = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️',
    default: '🔔'
};

// ✅ Central app config — single source of truth.
// Re-exported from config/app-config.js so every file sees the SAME values
// (previously constants.js had its own copy with conflicting bannerIntervalMs/splashFallbackMs).
export { APP_CONFIG } from '../config/app-config.js';