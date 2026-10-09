import { db, doc, getDoc } from '../firebase/firebase-init.js';
import { CACHE_FIELD_MAP, CACHE_PREFIX, STORAGE_KEYS } from '../utils/constants.js';
import { tsToMillis } from '../utils/formatters.js';
import { state } from './state.js';

// ════════════════════════════════════════════════════════════════
// UNIVERSAL CACHE SYSTEM (localStorage-based, admin-driven invalidation)
// Logic identical to the original. Wallet, withdrawals, transactions,
// joinRequests, notifications and admin data are NEVER cached here.
// ════════════════════════════════════════════════════════════════

export function cacheGet(key, store) {
    const s = store || localStorage;
    try {
        const raw = s.getItem(key);
        if (!raw) return null;
        let obj;
        try {
            obj = JSON.parse(raw);
        } catch (parseErr) {
            try {
                s.removeItem(key);
            } catch (e2) {}
            return null;
        }
        return (obj && typeof obj === 'object') ? obj : null;
    } catch (e) {
        return null;
    }
}

// ff_* keys that are user settings / pending state, NOT disposable cache.
// The quota-cleanup below must never delete these.
const PROTECTED_KEYS = [
    STORAGE_KEYS.theme,          // ff_theme
    STORAGE_KEYS.notifications,  // ff_notifications (user preference)
    STORAGE_KEYS.cacheVersions,  // ff_cache_versions_v1
    'ff_reminders_v1',           // scheduled tournament reminders
    'ff_flash_toast',            // toast waiting to show after a page change
    'ff_cfg_sync_t'              // last config sync time
];

export function cacheSet(key, data, store) {
    const s = store || localStorage;
    const payload = JSON.stringify({
        t: Date.now(),
        data
    });
    try {
        s.setItem(key, payload);
    } catch (e) {
        try {
            const ffKeys = [];
            for (let i = 0; i < s.length; i++) {
                const k = s.key(i);
                if (k && k.indexOf(CACHE_PREFIX) === 0 && !PROTECTED_KEYS.includes(k)) ffKeys.push(k);
            }
            ffKeys.forEach(k => {
                try {
                    s.removeItem(k);
                } catch (e2) {}
            });
            s.setItem(key, payload);
        } catch (e3) {
            /* storage full/disabled — app continues without cache */
        }
    }
}

export function cacheIsFresh(entry, maxAgeMs) {
    return !!entry && typeof entry.t === 'number' && (Date.now() - entry.t) < maxAgeMs;
}

export function purgeCacheByPrefix(prefix) {
    try {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf(prefix) === 0) toRemove.push(k);
        }
        toRemove.forEach(k => {
            try {
                localStorage.removeItem(k);
            } catch (e) {}
        });
    } catch (e) {
        /* storage disabled */
    }
}

// ════════════════════════════════════════════════════════════════
// FAST BOOT — session-scoped caches for instant page switching.
// This is a multi-page app: every tab switch reloads ALL modules, so
// in-memory state is lost. Without these caches each page paid for:
//   1. reload(user) — forced ID-token refresh (network roundtrip)
//   2. getDoc(users/uid) — Firestore read before first paint
// With them: repeat pages render instantly from session cache, then
// revalidate in the background (stale-while-revalidate).
// ════════════════════════════════════════════════════════════════
const EV_OK_KEY = 'ff_ev_ok_v1';
const USER_CACHE_PREFIX = 'ff_user_';
const USER_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

function ssGet(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
}
function ssSet(key, val) {
    try { sessionStorage.setItem(key, val); } catch (e) {}
}
function ssDel(key) {
    try { sessionStorage.removeItem(key); } catch (e) {}
}

// True if the email was verified earlier THIS session (tab). Lets later
// pages skip the forced reload(user) network roundtrip.
export function isEmailVerifiedThisSession() {
    return ssGet(EV_OK_KEY) === '1';
}
export function markEmailVerifiedThisSession() {
    ssSet(EV_OK_KEY, '1');
}

// Last known user doc for instant first paint (max 10 min old).
export function readSessionUser(uid) {
    if (!uid) return null;
    try {
        const raw = ssGet(USER_CACHE_PREFIX + uid + '_v1');
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object' || !obj.data) return null;
        if (Date.now() - (obj.t || 0) > USER_CACHE_MAX_AGE_MS) return null;
        return obj.data;
    } catch (e) {
        return null;
    }
}
export function writeSessionUser(uid, data) {
    if (!uid || !data) return;
    try {
        ssSet(USER_CACHE_PREFIX + uid + '_v1', JSON.stringify({ t: Date.now(), data }));
    } catch (e) {
        // Quota full — drop all session user caches and retry once.
        try {
            for (let i = sessionStorage.length - 1; i >= 0; i--) {
                const k = sessionStorage.key(i);
                if (k && k.indexOf(USER_CACHE_PREFIX) === 0) sessionStorage.removeItem(k);
            }
            ssSet(USER_CACHE_PREFIX + uid + '_v1', JSON.stringify({ t: Date.now(), data }));
        } catch (e2) {}
    }
}
export function clearSessionUser(uid) {
    if (!uid) return;
    ssDel(USER_CACHE_PREFIX + uid + '_v1');
}

let _appConfigSyncInFlight = false;
const SYNC_TS_KEY = 'ff_cfg_sync_t';
const SYNC_MIN_GAP_MS = 60000;

// Reads appConfig/lastUpdated once, compares each field with the locally stored
// version, and purges only the caches whose field the admin has updated.
// Multi-page change: instead of calling loadBanners()/loadTournaments() directly,
// it fires the "ff:cache-updated" event ({detail:{fields:[...]}}). The page that
// shows the affected section listens to it and refreshes itself.
// force=true skips the 60s throttle (used when the app returns to foreground).
// Critical wallet/payment/withdrawal state is intentionally excluded from this cache.
export async function syncAppConfigCache(force) {
    if (_appConfigSyncInFlight) return;
    if (!force) {
        try {
            const last = Number(sessionStorage.getItem(SYNC_TS_KEY) || 0);
            if (Date.now() - last < SYNC_MIN_GAP_MS) return;
        } catch (e) {}
    }
    _appConfigSyncInFlight = true;
    try {
        try {
            sessionStorage.setItem(SYNC_TS_KEY, String(Date.now()));
        } catch (e) {}
        let snap;
        try {
            snap = await getDoc(doc(db, 'appConfig', 'lastUpdated'));
        } catch (e) {
            return;
        }
        if (!snap || !snap.exists()) return;
        const server = snap.data();
        let local;
        try {
            local = cacheGet(STORAGE_KEYS.cacheVersions)?.data || {};
        } catch (e) {
            local = {};
        }
        const changedFields = [];
        for (const field in CACHE_FIELD_MAP) {
            const serverV = tsToMillis(server[field]);
            if (!serverV) continue;
            const localV = local[field] || 0;
            if (serverV > localV) {
                CACHE_FIELD_MAP[field].forEach(prefix => purgeCacheByPrefix(prefix));
                local[field] = serverV;
                changedFields.push(field);
            }
        }
        if (changedFields.length) {
            cacheSet(STORAGE_KEYS.cacheVersions, local);
            if (changedFields.includes('gameModes')) state.modeChipsLoaded = false;
            if (changedFields.includes('leaderboard')) {
                state.leaderboardCache = null;
                state.leaderboardCacheTime = null;
            }
            document.dispatchEvent(new CustomEvent('ff:cache-updated', {
                detail: {
                    fields: changedFields
                }
            }));
        }
    } catch (e) {
        /* never let a sync failure affect the app */
    } finally {
        _appConfigSyncInFlight = false;
    }
}