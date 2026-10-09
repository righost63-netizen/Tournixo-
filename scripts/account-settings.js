// scripts/account-settings.js — account management page (v7.2)
// (moved from profile.js; logic unchanged)
import { initPage, refreshUserUI } from './app.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { goBack } from '../config/app-config.js';
import { db, doc, updateDoc } from '../firebase/firebase-init.js';
import { sendResetEmail } from '../services/auth.service.js';
import { uploadProfilePhoto, saveProfilePhotoUrl, renderHomeAvatar } from '../services/profile-photo.service.js';

// Toast messages are rendered with innerHTML — strip markup from anything dynamic.
const plain = s => String(s ?? '').replace(/[<>&]/g, '');

const NAME_MIN = 2;
const NAME_MAX = 25;
const RESET_COOLDOWN_MS = 60 * 1000;
let _photoBusy = false;
let _resetLastAt = 0;

// ── Photo rows: label + "Remove" row depend on whether a photo exists ──
function syncPhotoRows(busyText) {
    const has = !!state.userData?.photoURL;
    const label = document.getElementById('photo-row-label');
    if (label) label.textContent = busyText || (has ? 'Change Profile Photo' : 'Add Profile Photo');
    const rm = document.getElementById('photo-remove-row');
    if (rm) rm.style.display = has ? '' : 'none';
}

function pickProfilePhoto() {
    if (_photoBusy) return;
    document.getElementById('photo-input')?.click();
}

async function onPhotoChosen(e) {
    const input = e.target;
    const file = input.files && input.files[0];
    input.value = ''; // lets the user pick the same file again later
    const uid = state.currentUser?.uid;
    if (!file || !uid || _photoBusy) return;

    _photoBusy = true;
    syncPhotoRows('Uploading…');
    try {
        const url = await uploadProfilePhoto(file);
        await saveProfilePhotoUrl(uid, url);
        refreshUserUI();
        syncHero();
        showToast('Profile photo updated', 'success');
    } catch (err) {
        showToast(plain(err.message) || 'Photo upload failed', 'error', 4500);
    } finally {
        _photoBusy = false;
        syncPhotoRows();
    }
}

function removeProfilePhoto() {
    const uid = state.currentUser?.uid;
    if (!uid || _photoBusy) return;
    showConfirm('Remove Photo', 'Remove your profile photo? Your initials will be shown instead.', async () => {
        try {
            await saveProfilePhotoUrl(uid, '');
            refreshUserUI();
            syncPhotoRows();
            syncHero();
            showToast('Profile photo removed', 'success');
        } catch (err) {
            showToast('Could not remove photo. Please try again.', 'error');
        }
    });
}

// ── Edit name (Free Fire UID and email are NOT editable: they are tied to
//    registeredUIDs, team rosters and login) ──
async function editProfileName() {
    const uid = state.currentUser?.uid;
    if (!uid) return;
    const current = state.userData?.name || '';
    const raw = prompt('Enter your new name:', current);
    if (raw === null) return;
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name || name === current) return;
    if (name.length < NAME_MIN || name.length > NAME_MAX) {
        showToast(`Name must be ${NAME_MIN}–${NAME_MAX} characters`, 'warning');
        return;
    }
    try {
        await updateDoc(doc(db, 'users', uid), { name });
        if (state.userData) state.userData.name = name;
        refreshUserUI();
        showToast('Name updated', 'success');
    } catch (err) {
        showToast('Could not update name. Please try again.', 'error');
    }
}

// ── Change password: Firebase emails a secure reset link (no password is
//    ever typed into or handled by this page) ──
function changePassword() {
    const email = state.currentUser?.email;
    if (!email) return;
    const wait = Math.ceil((RESET_COOLDOWN_MS - (Date.now() - _resetLastAt)) / 1000);
    if (wait > 0) {
        showToast(`Please wait ${wait}s before requesting another link`, 'warning');
        return;
    }
    showConfirm('Change Password', `A password reset link will be sent to ${email}.`, async () => {
        try {
            await sendResetEmail(email);
            _resetLastAt = Date.now();
            showToast('Reset link sent. Check your inbox (and spam).', 'success', 4500);
        } catch (err) {
            const msg = err.code === 'auth/too-many-requests' ?
                'Too many attempts. Please try again later.' :
                'Could not send the reset link. Please try again.';
            showToast(msg, 'error');
        }
    });
}

// ── Delete account: handled by support, not instantly from the app, so the
//    wallet balance / pending withdrawals / tournament entries are settled first ──
function requestAccountDeletion() {
    showConfirm(
        'Delete Account',
        'Account deletion is processed by our support team so your wallet balance and pending withdrawals can be settled first. Open Help & Support to send the request?',
        () => { if (window.openPage) window.openPage('helpSupport'); }
    );
}

window.pickProfilePhoto = pickProfilePhoto;
window.removeProfilePhoto = removeProfilePhoto;
window.editProfileName = editProfileName;
window.changePassword = changePassword;
window.requestAccountDeletion = requestAccountDeletion;
window.goBack = goBack;

// ── Hero: avatar / name / email / FF UID ──
function syncHero() {
    const u = state.userData || {};
    const nameEl = document.getElementById('acc-name');
    if (nameEl) nameEl.textContent = u.name || '—';
    const emailEl = document.getElementById('acc-email');
    if (emailEl) emailEl.textContent = state.currentUser?.email || '—';
    const uidEl = document.getElementById('acc-uid');
    if (uidEl) uidEl.textContent = 'UID: ' + (u.ffUID || '—');
    const sub = document.getElementById('acc-name-sub');
    if (sub) sub.textContent = u.name ? `Currently "${u.name}"` : 'Your display name';
    renderHomeAvatar(document.getElementById('acc-avatar'), u, 192);
}

initPage({
    page: 'accountSettings',
    onReady: () => {
        syncPhotoRows();
        syncHero();
        const input = document.getElementById('photo-input');
        if (input && !input.dataset.wired) {
            input.dataset.wired = '1';
            input.addEventListener('change', onPhotoChosen);
        }
    }
});
