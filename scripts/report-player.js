// scripts/report-player.js — Fair play report page (v7.1)
import { initPage } from './app.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { goBack, getParam } from '../config/app-config.js';
import { REPORT_REASONS, submitPlayerReport } from '../services/report.service.js';

function initForm() {
    const sel = document.getElementById('report-reason');
    REPORT_REASONS.forEach(r => {
        const o = document.createElement('option');
        o.value = r;
        o.textContent = r;
        sel.appendChild(o);
    });
    // Optional: pre-fill UID (?uid=...) when opened from a player context
    const pre = getParam('uid');
    if (pre && /^\d{8,12}$/.test(pre)) {
        document.getElementById('report-ffuid').value = pre;
    }
    document.getElementById('report-submit-btn').addEventListener('click', onSubmit);
}

async function onSubmit() {
    const uid = state.currentUser?.uid;
    if (!uid) { showToast('Please sign in first', 'error'); return; }
    const btn = document.getElementById('report-submit-btn');
    const ffUID = document.getElementById('report-ffuid').value.trim();
    const reason = document.getElementById('report-reason').value;
    const details = document.getElementById('report-details').value.trim();
    if (!reason) { showToast('Please choose a reason', 'warning'); return; }
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    try {
        await submitPlayerReport({
            uid,
            reporterName: state.userData?.name || '',
            reportedFFUID: ffUID,
            ownFFUID: state.userData?.ffUID || '',
            reason,
            details
        });
        document.getElementById('report-ffuid').value = '';
        document.getElementById('report-reason').value = '';
        document.getElementById('report-details').value = '';
        showToast('Report submitted. Our team will review it. 🙏', 'success', 4000);
    } catch (e) {
        showToast(e.message, 'error', 4500);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit Report';
    }
}

window.goBack = goBack;

initPage({
    page: 'reportPlayer',
    onReady: () => { initForm(); }
});
