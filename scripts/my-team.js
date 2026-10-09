// scripts/my-team.js — Persistent squad roster (v7)
import { initPage } from './app.js';
import { state } from './state.js';
import { escHtml } from '../utils/escape.js';
import { getParam, goTo, goBack } from '../config/app-config.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { db, doc, getDoc } from '../firebase/firebase-init.js';
import { normalizeTournament } from '../services/tournaments.service.js';
import {
    fetchMyTeam, createTeam, checkTeamDeletable, deleteTeam, buildRosterFromTeam
} from '../services/team.service.js';
import { joinWithSavedTeam } from './join-tournament.js';

let _team = null;
let _joinTournament = null;
let _duoPartner = null; // selected partner FF UID (duo join mode)

function isJoinMode() { return !!getParam('join'); }

async function loadMyTeamPage() {
    const uid = state.currentUser?.uid;
    const container = document.getElementById('myteam-content');
    if (!uid) { goTo('login'); return; }

    const joinTid = getParam('join');
    if (joinTid) {
        try {
            const snap = await getDoc(doc(db, 'tournaments', joinTid));
            if (snap.exists()) _joinTournament = normalizeTournament(snap.data(), snap.id);
        } catch (e) { console.warn('[MyTeam] tournament load failed:', e.message); }
    }

    try {
        _team = await fetchMyTeam(uid);
    } catch (e) {
        container.innerHTML = errorHtml('Could not load your team: ' + escHtml(e.message));
        return;
    }
    render();
}

function render() {
    renderJoinBanner();
    if (_team) renderTeamCard();
    else renderCreateForm();
}

function renderJoinBanner() {
    const banner = document.getElementById('myteam-join-banner');
    if (!_joinTournament) { banner.style.display = 'none'; return; }
    const t = _joinTournament;
    const isFree = t.entryType === 'FREE' || Number(t.entryFee || 0) === 0;
    banner.style.display = 'block';
    banner.innerHTML = `
        <div class="myteam-join-banner">
            🎮 Joining <b>${escHtml(t.name)}</b> · ${escHtml(t.teamFormat || '')}
            · ${isFree ? 'FREE' : '₹' + escHtml(t.entryFee)}
        </div>`;
}

function memberRowsHtml(team, selectable) {
    const cap = `
        <div class="myteam-member captain">
            <div class="myteam-avatar">👑</div>
            <div class="myteam-minfo">
                <div class="myteam-mname">${escHtml(team.captainName || 'Captain')}</div>
                <div class="myteam-muid">UID: ${escHtml(team.captainFFUID)}</div>
            </div>
            <span class="myteam-role">CAPTAIN</span>
        </div>`;
    const mems = (team.members || []).map(m => {
        if (!selectable) {
            return `
            <div class="myteam-member">
                <div class="myteam-avatar">${escHtml((m.playerName || 'P').charAt(0).toUpperCase())}</div>
                <div class="myteam-minfo">
                    <div class="myteam-mname">${escHtml(m.playerName)}</div>
                    <div class="myteam-muid">UID: ${escHtml(m.ffUID)}</div>
                </div>
            </div>`;
        }
        const sel = _duoPartner === String(m.ffUID).trim();
        return `
            <div class="myteam-pick ${sel ? 'selected' : ''}" data-ffuid="${escHtml(m.ffUID)}">
                <div class="myteam-radio"></div>
                <div class="myteam-minfo">
                    <div class="myteam-mname">${escHtml(m.playerName)}</div>
                    <div class="myteam-muid">UID: ${escHtml(m.ffUID)}</div>
                </div>
            </div>`;
    }).join('');
    return cap + mems;
}

function renderTeamCard() {
    const container = document.getElementById('myteam-content');
    const t = _team;
    const joinMode = isJoinMode();
    const isDuo = joinMode && _joinTournament && (_joinTournament.teamFormat === 'DUO');

    let actionHtml = '';
    if (joinMode) {
        const btnLabel = isDuo ? 'Confirm Partner & Join Duo' : 'Use This Team & Join';
        actionHtml = `
            <div class="myteam-actions">
                <button class="btn btn-primary btn-block" id="myteam-join-btn">${btnLabel}</button>
                <button class="myteam-link" id="myteam-manual-btn">Join without saved team →</button>
            </div>
            <div class="myteam-note">🔒 After joining, this tournament entry is locked — the roster can't be changed for this tournament.</div>`;
    } else {
        actionHtml = `
            <div class="myteam-actions">
                <button class="btn btn-secondary btn-block" id="myteam-delete-btn" style="color:var(--error);">🗑️ Delete Team</button>
            </div>
            <div class="myteam-note">⚠️ A team can't be edited after creation — delete it and create a new one to change the roster. Deleting is blocked while this team has active tournament entries.</div>`;
    }

    container.innerHTML = `
        <div class="myteam-card">
            <div class="myteam-card-head">
                <div>
                    <div class="myteam-name">${escHtml(t.teamName)}</div>
                    <div class="myteam-id">${escHtml(t.teamId || '')}</div>
                </div>
                <span class="myteam-badge">SQUAD</span>
            </div>
            <div class="myteam-sec-label">${isDuo ? 'SELECT YOUR PARTNER' : 'ROSTER'}</div>
            <div id="myteam-members">${memberRowsHtml(t, isDuo)}</div>
        </div>
        ${actionHtml}`;

    if (isDuo) {
        container.querySelectorAll('.myteam-pick').forEach(el => {
            el.addEventListener('click', () => {
                _duoPartner = el.dataset.ffuid;
                renderTeamCard();
            });
        });
    }
    const joinBtn = document.getElementById('myteam-join-btn');
    if (joinBtn) joinBtn.addEventListener('click', onConfirmJoin);
    const manualBtn = document.getElementById('myteam-manual-btn');
    if (manualBtn) manualBtn.addEventListener('click', () => {
        // Back to details → open the classic manual join form
        goTo('tournamentDetails', { id: getParam('join'), join: 1, manual: 1 });
    });
    const delBtn = document.getElementById('myteam-delete-btn');
    if (delBtn) delBtn.addEventListener('click', onDeleteTeam);
}

function renderCreateForm() {
    const container = document.getElementById('myteam-content');
    const joinMode = isJoinMode();
    const uData = state.userData || {};
    const capUid = uData.ffUID || '';

    container.innerHTML = `
        <div class="myteam-card">
            <div class="myteam-sec-label" style="margin-top:0;">CREATE YOUR SQUAD</div>
            <label class="auth-label">Team Name <span style="color:var(--error)">*</span></label>
            <div class="input-group">
                <span class="input-icon">🛡️</span>
                <input id="nt-name" type="text" placeholder="e.g. Night Hunters" maxlength="30">
            </div>
            <div class="myteam-sec-label">CAPTAIN (YOU)</div>
            <div class="myteam-member captain">
                <div class="myteam-avatar">👑</div>
                <div class="myteam-minfo">
                    <div class="myteam-mname">${escHtml(uData.name || 'Captain')}</div>
                    <div class="myteam-muid">UID: ${escHtml(capUid || '— set in profile first —')}</div>
                </div>
                <span class="myteam-role">CAPTAIN</span>
            </div>
            <div class="myteam-sec-label">TEAM MEMBERS (3)</div>
            ${[2, 3, 4].map(i => `
                <label class="auth-label">Player ${i} Name</label>
                <div class="input-group"><span class="input-icon">👤</span>
                    <input id="nt-p${i}-name" type="text" placeholder="Player ${i} name" maxlength="30">
                </div>
                <label class="auth-label">Player ${i} Free Fire UID <span style="color:var(--error)">*</span></label>
                <div class="input-group"><span class="input-icon">🎯</span>
                    <input id="nt-p${i}-uid" type="number" placeholder="Numeric Gaming UID" inputmode="numeric">
                </div>`).join('')}
        </div>
        <div class="myteam-actions">
            <button class="btn btn-primary btn-block" id="myteam-create-btn">Create Team</button>
        </div>
        <div class="myteam-note">⚠️ A team can't be edited after creation. To change the roster, delete the team and create a new one.</div>`;

    document.getElementById('myteam-create-btn').addEventListener('click', onCreateTeam);
}

async function onCreateTeam() {
    const uid = state.currentUser?.uid;
    const uData = state.userData || {};
    const btn = document.getElementById('myteam-create-btn');
    const teamName = document.getElementById('nt-name').value.trim();
    if (!teamName) { showToast('Please enter a team name', 'warning'); return; }
    const capFFUID = String(uData.ffUID || '').trim();
    if (!capFFUID) { showToast('Set your Free Fire UID in your profile first', 'warning'); return; }

    const members = [];
    const seen = new Set([capFFUID]);
    for (const i of [2, 3, 4]) {
        const name = document.getElementById(`nt-p${i}-name`).value.trim() || `Player ${i}`;
        const ffUID = document.getElementById(`nt-p${i}-uid`).value.trim();
        if (!ffUID) { showToast(`Please enter Player ${i} UID`, 'warning'); return; }
        if (!/^\d{8,12}$/.test(ffUID)) { showToast(`Player ${i} UID must be 8–12 digits`, 'warning'); return; }
        if (seen.has(ffUID)) { showToast('Duplicate UID in team!', 'error'); return; }
        seen.add(ffUID);
        members.push({ playerName: name, ffUID });
    }
    btn.disabled = true;
    btn.textContent = 'Creating...';
    try {
        _team = await createTeam({
            uid,
            teamName,
            captainName: uData.name || 'Captain',
            captainFFUID: capFFUID,
            members
        });
        showToast('Team created! 🎉', 'success');
        render();
    } catch (e) {
        showToast('Failed to create team: ' + e.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Create Team';
    }
}

async function onDeleteTeam() {
    const t = _team;
    if (!t) return;
    const btn = document.getElementById('myteam-delete-btn');
    btn.disabled = true;
    btn.textContent = 'Checking...';
    let guard;
    try {
        guard = await checkTeamDeletable(t);
    } catch (e) {
        showToast('Could not verify: ' + e.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '🗑️ Delete Team';
        return;
    }
    btn.disabled = false;
    btn.innerHTML = '🗑️ Delete Team';
    if (!guard.ok) {
        const list = guard.active.map(a => `• ${a.tournamentName} (${a.status})`).join('\n');
        showConfirm(
            '⛔ Cannot Delete Yet',
            `This team is active in:\n${list}\n\nDelete is blocked to protect your tournament entries. You can delete it after these tournaments finish.`,
            null
        );
        return;
    }
    showConfirm(
        'Delete Team?',
        `Delete "${t.teamName}" permanently?\n\nThis only removes the saved roster — it can't be undone.`,
        async () => {
            try {
                await deleteTeam(t.id);
                _team = null;
                showToast('Team deleted', 'success');
                render();
            } catch (e) {
                showToast('Delete failed: ' + e.message, 'error');
            }
        }
    );
}

async function onConfirmJoin() {
    const tid = getParam('join');
    if (!tid || !_team) return;
    const isDuo = _joinTournament && _joinTournament.teamFormat === 'DUO';
    if (isDuo && !_duoPartner) {
        showToast('Please select your partner', 'warning');
        return;
    }
    const btn = document.getElementById('myteam-join-btn');
    const uid = state.currentUser?.uid;
    const players = buildRosterFromTeam(_team, uid, isDuo ? _duoPartner : null);
    const btnLabel = isDuo ? 'Confirm Partner & Join Duo' : 'Use This Team & Join';
    btn.disabled = true;
    btn.textContent = 'Joining...';
    try {
        await joinWithSavedTeam(tid, _team.teamName, players, _team.teamId || _team.id, btn);
    } finally {
        // joinWithSavedTeam navigates away on success; if we're still here
        // the join failed — restore the button.
        const stillHere = document.getElementById('myteam-join-btn');
        if (stillHere) {
            stillHere.disabled = false;
            stillHere.textContent = btnLabel;
        }
    }
}

function errorHtml(msg) {
    return `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">${msg}</div></div>`;
}

window.goBack = goBack;

initPage({
    page: 'myTeam',
    onReady: () => {
        state.joinManualBypass = false; // clear any stale bypass flag
        loadMyTeamPage();
    }
});
