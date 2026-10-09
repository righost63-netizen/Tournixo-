import { initPage, refreshUserUI } from './app.js';
import './auth-ui.js'; // provides window.confirmLogout (auth-ui only starts a page on login/register)
import { syncNotifToggleUI } from '../services/onesignal.service.js';

// v7.2: account management (photo/name/password/delete) moved to
// pages/account-settings.html + scripts/account-settings.js.
// This page keeps: stats, preferences, app links, logout.

// loadProfile(): fill user data + wire the notification toggle
// (Notification toggle: window.toggleNotifications comes from services/onesignal.service.js)
function loadProfile() {
    refreshUserUI();
    syncNotifToggleUI();
    // The user may change the permission in browser settings and come back
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) syncNotifToggleUI();
    });
}

initPage({
    page: 'profile',
    tab: 'profile',
    onReady: () => {
        loadProfile();
    }
});
