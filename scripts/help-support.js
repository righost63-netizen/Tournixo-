// scripts/help-support.js
import { initPage } from './app.js';
import { db, doc, getDoc, collection, query, orderBy, limit, getDocs } from '../firebase/firebase-init.js';
import { cacheGet, cacheSet, cacheIsFresh } from './cache.js';
import { STORAGE_KEYS, CACHE_TTL } from '../utils/constants.js';
import { escHtml } from '../utils/escape.js';

/*
 * ─────────────────────────────────────────────────────────────
 * HELP & SUPPORT — fully dynamic.
 * Reads the `supportContacts` collection managed by the Admin Panel
 * (fields: appName, platform, value, icon (auto), order, createdAt).
 * Whatever the admin adds — WhatsApp, Telegram, Email, … — renders here.
 * Nothing is hard-coded. Falls back to the legacy settings/helpSupport
 * doc only if the collection is empty (older admin versions).
 * ─────────────────────────────────────────────────────────────
 */

const HELP_CACHE_KEY = STORAGE_KEYS.help;
const HELP_CACHE_MS  = CACHE_TTL.help;

// Platform metadata — mirrors the Admin Panel's HS_PLATFORMS list.
const PLATFORMS = {
    whatsapp:  { label: 'WhatsApp',  icon: '📱' },
    telegram:  { label: 'Telegram',  icon: '✈️' },
    messenger: { label: 'Messenger', icon: '💬' },
    email:     { label: 'Email',     icon: '✉️' },
    phone:     { label: 'Phone',     icon: '📞' },
    facebook:  { label: 'Facebook',  icon: '📘' },
    instagram: { label: 'Instagram', icon: '📸' },
    youtube:   { label: 'YouTube',   icon: '▶️' },
    discord:   { label: 'Discord',   icon: '🎮' },
    website:   { label: 'Website',   icon: '🌐' },
    other:     { label: 'Link',      icon: '🔗' },
};

// Build the outbound link for a contact — same rules as the Admin Panel.
function buildContactLink(platform, value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (platform === 'whatsapp' || platform === 'phone') return 'https://wa.me/' + v.replace(/[^0-9]/g, '');
    if (platform === 'telegram') return 'https://t.me/' + v.replace(/^@/, '');
    if (platform === 'messenger') return v.startsWith('http') ? v : 'https://m.me/' + v;
    if (platform === 'email') return 'mailto:' + v;
    if (platform === 'instagram') return 'https://instagram.com/' + v.replace(/^@/, '');
    return v; // website / facebook / youtube / discord / other — raw link
}

function toContactList(docs) {
    return docs
        .map(d => {
            const data = d.data ? d.data() : d;
            const platform = String(data.platform || 'other').toLowerCase();
            const meta = PLATFORMS[platform] || PLATFORMS.other;
            return {
                name: data.appName || meta.label,
                icon: data.icon || meta.icon,
                link: buildContactLink(platform, data.value),
                order: Number(data.order || 0),
            };
        })
        .filter(c => c.link)
        .sort((a, b) => a.order - b.order);
}

async function fetchContacts() {
    let snap = null;
    try {
        snap = await getDocs(query(collection(db, 'supportContacts'), orderBy('order', 'asc'), limit(50)));
    } catch (e) {
        // orderBy needs no composite index, but be resilient anyway
        try {
            snap = await getDocs(query(collection(db, 'supportContacts'), limit(50)));
        } catch (e2) {
            console.warn('[Help] supportContacts fetch failed:', e2?.message || e2);
        }
    }
    if (snap && !snap.empty) return toContactList(snap.docs);

    // Legacy fallback: settings/helpSupport doc (whatsappNumber / telegramUsername / messengerUsername)
    try {
        const legacy = await getDoc(doc(db, 'settings', 'helpSupport'));
        if (legacy.exists()) {
            const d = legacy.data();
            const out = [];
            if (d.whatsappNumber) out.push({ name: 'WhatsApp', icon: '📱', link: buildContactLink('whatsapp', d.whatsappNumber), order: 0 });
            if (d.telegramUsername) out.push({ name: 'Telegram', icon: '✈️', link: buildContactLink('telegram', d.telegramUsername), order: 1 });
            if (d.messengerUsername) out.push({ name: 'Messenger', icon: '💬', link: buildContactLink('messenger', d.messengerUsername), order: 2 });
            if (out.length) return out;
        }
    } catch (e) {
        console.warn('[Help] legacy fallback failed:', e?.message || e);
    }
    return [];
}

function renderHelpButtons(container, contacts) {
    container.innerHTML = '';
    if (!contacts.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">💬</div>
                <div class="empty-title">Support is currently unavailable</div>
                <div class="empty-sub">Please check back later</div>
            </div>`;
        return;
    }
    const frag = document.createDocumentFragment();
    contacts.forEach(c => {
        const a = document.createElement('a');
        a.className = 'help-contact-btn';
        a.href = c.link;
        a.target = '_blank';
        a.rel = 'noopener';
        a.innerHTML = `<span class="help-contact-ic">${escHtml(c.icon)}</span><span>${escHtml(c.name)}</span><span class="help-contact-chev">›</span>`;
        frag.appendChild(a);
    });
    container.appendChild(frag);
}

async function loadHelpSupport() {
    const container = document.getElementById('help-buttons');
    if (!container) return;

    const cached = cacheGet(HELP_CACHE_KEY);
    if (cached && Array.isArray(cached.data)) renderHelpButtons(container, cached.data);
    if (cached && cacheIsFresh(cached, HELP_CACHE_MS)) return;

    try {
        const contacts = await fetchContacts();
        cacheSet(HELP_CACHE_KEY, contacts);
        renderHelpButtons(container, contacts);
    } catch (error) {
        if (!cached) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⚠️</div>
                    <div class="empty-title">Unable to load support info</div>
                </div>`;
        }
    }
}

window.closeHelpSupport = function () {
    if (typeof window.goBack === 'function') window.goBack('profile');
    else history.back();
};

initPage({
    page: 'helpSupport',
    onReady: () => { loadHelpSupport(); }
});
