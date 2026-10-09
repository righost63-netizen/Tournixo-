import { initPage } from './app.js';
import { timeAgo } from '../utils/formatters.js';
import { escHtml } from '../utils/escape.js';
import { fetchNotifications, markNotificationRead } from '../services/notifications.service.js';

let currentUid = null;
let currentItems = [];

async function loadNotifications(uid) {
    currentUid = uid;
    const container = document.getElementById('notif-list');
    container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
    try {
        const items = await fetchNotifications(uid);
        currentItems = items;
        if (items.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔔</div><div class="empty-title">No notifications yet</div></div>';
            return;
        }
        const icons = {
            join_confirmed: '✅',
            payment_pending: '⏳',
            room_published: '🔑',
            prize_credited: '💰',
            prize: '🏆',
            tournament_soon: '⏰',
            withdrawal_pending: '⏳',
            withdrawal_approved: '✅',
            announcement: '📢',
            info: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            default: '🔔'
        };
        container.innerHTML = '';
        const fragment = document.createDocumentFragment();
        for (const n of items) {
            const item = document.createElement('div');
            item.className = 'notif-item' + (!n.read ? ' unread' : '');
            item.innerHTML = `<div class="notif-icon">${icons[n.type]||icons.default}</div><div class="notif-content"><div class="notif-title">${escHtml(n.title||'Notification')}</div><div class="notif-body">${escHtml(n.body||n.message||'')}</div><div class="notif-time">${timeAgo(n.createdAt)}</div></div>${!n.read?'<div class="unread-dot"></div>':''}`;
            // Opening the page no longer marks notifications as read.
            // A notification is marked read when the user actually taps it.
            if (!n.read && n._src === 'user') {
                item.addEventListener('click', () => markOneRead(n, item), { once: true });
            }
            fragment.appendChild(item);
        }
        container.appendChild(fragment);
    } catch (e) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔔</div><div class="empty-title">No notifications yet</div></div>';
    }
}

function markOneRead(n, item) {
    if (n.read) return;
    n.read = true;
    item.classList.remove('unread');
    const dot = item.querySelector('.unread-dot');
    if (dot) dot.remove();
    markNotificationRead(currentUid, n.id).catch(() => {
        // Revert local state on failure so it doesn't drift from the backend
        n.read = false;
        item.classList.add('unread');
    });
}

initPage({
    page: 'notifications',
    onReady: (user) => {
        if (user) loadNotifications(user.uid);
    }
});