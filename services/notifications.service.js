import { db, doc, collection, query, orderBy, limit, onSnapshot, getDocs, addDoc, updateDoc, serverTimestamp } from '../firebase/firebase-init.js';
import { state } from '../scripts/state.js';
import { fetchUpcomingRaw } from './tournaments.service.js';
// ✅ centralized constants
import { STORAGE_KEYS, CACHE_TTL } from '../utils/constants.js';

/*
 * ─────────────────────────────────────────────────────────────
 * FIXES APPLIED:
 * 1. ❌ Hard-coded `30 * 60 * 1000` এবং `86400000` (line 77-79, 106)
 *    ✅ এখন CACHE_TTL.reminderLeadTimeMs / reminderWindowMs থেকে আসে।
 * 2. ❌ REMINDER_KEY = 'ff_reminders_v1' hard-coded string
 *    ✅ এখন STORAGE_KEYS.reminders।
 * 3. ✅ Dead export cleanupNotificationResources সরানো হয়েছে (কোথাও call হতো না)।
 * ─────────────────────────────────────────────────────────────
 */

const REMINDER_KEY = STORAGE_KEYS.reminders;           // ✅ no more magic string
const REMINDER_LEAD_MS  = CACHE_TTL.reminderLeadTimeMs; // ✅ 30 min
const REMINDER_WINDOW_MS = CACHE_TTL.reminderWindowMs;  // ✅ 24 hours

function updateBadge(snap) {
    let unread = 0;
    snap.forEach(d => { if (!d.data().read) unread++; });
    const badge = document.getElementById('notif-badge');
    if (badge) {
        badge.style.display = unread > 0 ? 'flex' : 'none';
        badge.textContent = unread > 9 ? '9+' : unread;
    }
}

export function listenNotifications(uid) {
    if (state.notifListenerActive) return;
    state.notifListenerActive = true;
    try {
        const q = query(
            collection(db, 'users', uid, 'notifications'),
            orderBy('createdAt', 'desc'),
            limit(30)
        );
        const unsub = onSnapshot(q, updateBadge, () => {
            state.notifListenerActive = false;
        });
        state.listeners.push(unsub);
    } catch (e) {
        state.notifListenerActive = false;
    }
}

let _reminderTimers = [];

function readReminders() {
    try { return JSON.parse(localStorage.getItem(REMINDER_KEY)) || null; }
    catch (e) { return null; }
}

function writeReminders(data) {
    try { localStorage.setItem(REMINDER_KEY, JSON.stringify(data)); } catch (e) {}
}

function getStartDate(t) {
    if (t.dateObj instanceof Date && !isNaN(t.dateObj)) return t.dateObj;
    const v = t.dateTime || t.date;
    if (!v) return null;
    const d = v.toDate ? v.toDate() : new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

export async function scheduleTournamentReminders() {
    const uid = state.currentUser?.uid;
    if (!uid) return;
    try {
        let upcoming = state.tournaments.filter(t => t.status === 'upcoming');
        if (upcoming.length === 0) upcoming = await fetchUpcomingRaw();
        const joinedIds = state.userData?.joinedTournaments || [];
        const items = [];
        upcoming.forEach(t => {
            if (!joinedIds.includes(t.id)) return;
            const td = getStartDate(t);
            if (!td) return;
            // ✅ constant-based lead + window
            const at = td.getTime() - REMINDER_LEAD_MS;
            const delay = at - Date.now();
            if (delay > 0 && delay < REMINDER_WINDOW_MS) {
                items.push({ id: t.id, name: t.name, at });
            }
        });
        const old = readReminders();
        const fired = (old && old.uid === uid && old.fired) ? old.fired : {};
        writeReminders({ uid, items, fired });
        armReminders();
    } catch (e) {}
}

export function armReminders() {
    const uid = state.currentUser?.uid;
    if (!uid) return;
    const data = readReminders();
    if (!data || data.uid !== uid) return;
    _reminderTimers.forEach(t => clearTimeout(t));
    _reminderTimers = [];
    (data.items || []).forEach(r => {
        if (data.fired && data.fired[r.id]) return;
        const delay = r.at - Date.now();
        // ✅ constant-based window
        if (delay <= 0 || delay >= REMINDER_WINDOW_MS) return;
        const timer = setTimeout(async () => {
            const cur = readReminders() || data;
            cur.fired = cur.fired || {};
            cur.fired[r.id] = true;
            writeReminders(cur);
            try {
                await addDoc(collection(db, 'users', uid, 'notifications'), {
                    type: 'tournament_soon',
                    title: '⏰ Tournament Starting Soon!',
                    body: `"${r.name}" starts in 30 minutes!`,
                    read: false,
                    createdAt: serverTimestamp()
                });
            } catch (e) {}
            if (window.showToast) window.showToast(`⏰ "${r.name}" starts in 30 minutes!`, 'info', 6000);
        }, delay);
        _reminderTimers.push(timer);
    });
}

export async function fetchNotifications(uid) {
    const userItems = [], globalItems = [];
    try {
        let s;
        try {
            s = await getDocs(query(
                collection(db, 'users', uid, 'notifications'),
                orderBy('createdAt', 'desc'),
                limit(30)
            ));
        } catch (e) {
            s = await getDocs(query(
                collection(db, 'users', uid, 'notifications'),
                limit(30)
            ));
        }
        s.forEach(d => userItems.push({ id: d.id, _src: 'user', ...d.data() }));
    } catch (e) {}
    try {
        let g;
        try {
            g = await getDocs(query(
                collection(db, 'notifications', 'global', 'items'),
                orderBy('createdAt', 'desc'),
                limit(20)
            ));
        } catch (e) {
            g = await getDocs(query(
                collection(db, 'notifications', 'global', 'items'),
                limit(20)
            ));
        }
        g.forEach(d => globalItems.push({ id: d.id, _src: 'global', ...d.data() }));
    } catch (e) {}
    try {
        let a;
        try {
            a = await getDocs(query(
                collection(db, 'adminNotifications'),
                orderBy('createdAt', 'desc'),
                limit(20)
            ));
        } catch (e) {
            a = await getDocs(query(
                collection(db, 'adminNotifications'),
                limit(20)
            ));
        }
        a.forEach(d => globalItems.push({ id: d.id, _src: 'admin', ...d.data() }));
    } catch (e) {}
    return [...userItems, ...globalItems].sort((a, b) => {
        const toMs = v => v?.toMillis?.() ?? (v instanceof Date ? v.getTime() : Number(v) || 0);
        return toMs(b.createdAt) - toMs(a.createdAt);
    });
}

export function markNotificationRead(uid, id) {
    return updateDoc(doc(db, 'users', uid, 'notifications', id), { read: true });
}