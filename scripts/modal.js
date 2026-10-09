import { state } from './state.js';

// Track open modals so body scroll stays locked while ANY modal is open
const _openModals = new Set();

function _lockScroll() {
    document.body.style.overflow = 'hidden';
}

function _unlockScrollIfNoneOpen() {
    if (_openModals.size === 0) document.body.style.overflow = '';
}

export function openModal(id) {
    const m = document.getElementById(id);
    if (m) {
        m.style.display = 'flex';
        setTimeout(() => m.classList.add('active'), 10);
        _openModals.add(id);
        _lockScroll();
    }
}

export function closeModal(id) {
    const m = document.getElementById(id);
    if (m) {
        m.classList.remove('active');
        setTimeout(() => {
            m.style.display = 'none';
            _openModals.delete(id);
            _unlockScrollIfNoneOpen();
        }, 350);
    } else {
        _openModals.delete(id);
        _unlockScrollIfNoneOpen();
    }
}

// ── Confirm dialog (components/confirm-dialog.html) ──
export function showConfirm(title, body, callback) {
    const dlg = document.getElementById('confirm-dialog');
    const titleEl = document.getElementById('confirm-title');
    const bodyEl = document.getElementById('confirm-body');
    if (!dlg || !titleEl || !bodyEl) {
        // The dialog component (components/confirm-dialog.html) failed to load —
        // fall back to the browser's own confirm() instead of crashing.
        if (window.confirm(`${title}\n\n${body}`) && typeof callback === 'function') callback();
        return;
    }
    titleEl.textContent = title;
    bodyEl.textContent = body;
    state.confirmCallback = callback;
    dlg.classList.add('active');
}

export function cancelConfirm() {
    document.getElementById('confirm-dialog').classList.remove('active');
    state.confirmCallback = null;
}

export function confirmOk() {
    document.getElementById('confirm-dialog').classList.remove('active');
    if (state.confirmCallback) {
        state.confirmCallback();
        state.confirmCallback = null;
    }
}

// ── Prompt dialog (replacement for the native window.prompt) ──
// Native prompt() is blocked or ugly in many mobile WebViews / installed PWAs.
// Reuses the confirm-dialog styles. Resolves with the trimmed text, or null if cancelled.
export function showPrompt(title, body, { value = '', placeholder = '', maxLength = 100, okText = 'Save' } = {}) {
    return new Promise((resolve) => {
        const old = document.getElementById('prompt-dialog');
        if (old) old.remove();

        const dlg = document.createElement('div');
        dlg.id = 'prompt-dialog';
        dlg.className = 'confirm-dialog active';
        dlg.innerHTML = `
            <div class="confirm-box">
                <div class="confirm-title"></div>
                <div class="confirm-body" style="margin-bottom:16px;"></div>
                <div class="input-group" style="margin-bottom:20px;">
                    <input type="text" autocomplete="off">
                </div>
                <div class="confirm-actions">
                    <button type="button" class="btn btn-secondary confirm-cancel">Cancel</button>
                    <button type="button" class="btn btn-primary confirm-ok"></button>
                </div>
            </div>`;

        dlg.querySelector('.confirm-title').textContent = title;
        dlg.querySelector('.confirm-body').textContent = body;
        dlg.querySelector('.confirm-ok').textContent = okText;
        const input = dlg.querySelector('input');
        input.value = value;
        input.placeholder = placeholder;
        input.maxLength = maxLength;

        let done = false;
        const finish = (result) => {
            if (done) return;
            done = true;
            dlg.remove();
            resolve(result);
        };

        dlg.querySelector('.confirm-cancel').addEventListener('click', () => finish(null));
        dlg.querySelector('.confirm-ok').addEventListener('click', () => finish(input.value.trim()));
        dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(null); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(input.value.trim()); }
            else if (e.key === 'Escape') finish(null);
        });

        document.body.appendChild(dlg);
        input.focus();
        input.select();
    });
}

// ── Skeleton loaders (generated in JS, same markup as the original) ──
export function showSkeleton(id, type = 'tournament') {
    const c = document.getElementById(id);
    if (!c) return;
    let html = '';

    if (type === 'tx') {
        for (let i = 0; i < 4; i++) {
            html += `
            <div class="skeleton-tx-card">
                <div class="skeleton-tx-circle"></div>
                <div class="skeleton-tx-lines">
                    <div class="skeleton-item" style="height:14px;width:55%;border-radius:6px;"></div>
                    <div class="skeleton-item" style="height:12px;width:35%;border-radius:4px;"></div>
                </div>
                <div class="skeleton-item" style="height:18px;width:60px;border-radius:8px;flex-shrink:0;"></div>
            </div>`;
        }
    } else {
        for (let i = 0; i < 3; i++) {
            html += `
            <div class="skeleton-card">
                <div class="skeleton-item" style="height:155px;width:100%;border-radius:0;"></div>
                <div style="padding:14px;">
                    <div class="skeleton-item" style="height:20px;width:60%;border-radius:6px;margin-bottom:10px;"></div>
                    <div style="display:flex;gap:8px;margin-bottom:16px;">
                        <div class="skeleton-item" style="height:14px;width:50px;border-radius:4px;"></div>
                        <div class="skeleton-item" style="height:14px;width:50px;border-radius:4px;"></div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
                        <div class="skeleton-item" style="height:48px;border-radius:10px;"></div>
                        <div class="skeleton-item" style="height:48px;border-radius:10px;"></div>
                    </div>
                    <div class="skeleton-item" style="height:40px;border-radius:10px;"></div>
                </div>
            </div>`;
        }
    }
    c.innerHTML = html;
}

// Inline onclick handlers in the HTML need these on window (same as original)
window.openModal = openModal;
window.closeModal = closeModal;
window.showConfirm = showConfirm;
window.showPrompt = showPrompt;
window.cancelConfirm = cancelConfirm;
window.confirmOk = confirmOk;
window.showSkeleton = showSkeleton;