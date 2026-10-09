// ════════════════════════════════════════════════════════════════
// Profile photo: resize in the browser → upload to Cloudinary (unsigned)
// → save only the small URL string in users/{uid}.photoURL.
// The photo is displayed on the Home avatar and the Profile avatar; everywhere
// else the app keeps showing initials.
// ════════════════════════════════════════════════════════════════
import { db, doc, updateDoc } from '../firebase/firebase-init.js';
import { CLOUDINARY_CONFIG } from '../config/cloudinary-config.js';
import { getInitials } from '../utils/formatters.js';
import { state } from '../scripts/state.js';

const CFG = CLOUDINARY_CONFIG;

function isConfigured() {
    return CFG.cloudName && !CFG.cloudName.startsWith('YOUR_') &&
        CFG.uploadPreset && !CFG.uploadPreset.startsWith('YOUR_');
}

// Only our own Cloudinary account's images are ever displayed.
function isOwnCloudinaryUrl(url) {
    return typeof url === 'string' &&
        url.startsWith(`https://res.cloudinary.com/${CFG.cloudName}/`) &&
        url.includes('/upload/');
}

// Small, cached, auto-format thumbnail (a 44px avatar needs ~96px on 2x screens)
export function avatarThumbUrl(url, size = 96) {
    if (!isOwnCloudinaryUrl(url)) return '';
    return url.replace('/upload/', `/upload/c_fill,g_face,w_${size},h_${size},f_auto,q_auto/`);
}

// ── Home avatar: photo if available, otherwise 1–2 letter initials ──
export function renderHomeAvatar(el, userData, size = 96) {
    if (!el) return;
    const initials = getInitials(userData?.name || '?');
    const url = avatarThumbUrl(userData?.photoURL, size);

    if (!url) {
        delete el.dataset.src;
        el.textContent = initials;
        return;
    }
    if (el.dataset.src === url) return; // already showing / loading this photo

    el.dataset.src = url;
    el.style.overflow = 'hidden';
    el.textContent = initials; // initials show instantly while the photo loads

    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    img.onload = () => {
        if (el.dataset.src === url) el.replaceChildren(img);
    };
    img.onerror = () => {
        delete el.dataset.src;
        el.textContent = initials;
    };
    img.src = url;
}

// ── Resize: centre-crop to a square, export a small JPEG ──
async function loadBitmap(file) {
    if (typeof createImageBitmap === 'function') {
        try {
            return await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (e) { /* fall through to <img> */ }
    }
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
        img.src = url;
    });
}

async function resizeToSquareBlob(file) {
    let src;
    try {
        src = await loadBitmap(file);
    } catch (e) {
        throw new Error('Could not read this image. Please choose a JPG or PNG photo.');
    }
    const w = src.width, h = src.height;
    const side = Math.min(w, h);
    const sx = (w - side) / 2, sy = (h - side) / 2;
    const out = CFG.outputSize;

    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, sx, sy, side, side, 0, 0, out, out);
    if (typeof src.close === 'function') src.close();

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', CFG.outputQuality));
    canvas.width = canvas.height = 0; // free the canvas memory
    if (!blob) throw new Error('Could not process this image. Try a different photo.');
    return blob;
}

// ── Upload to Cloudinary (unsigned) → returns the secure image URL ──
export async function uploadProfilePhoto(file) {
    if (!isConfigured()) throw new Error('Photo upload is not set up yet.');
    if (!file || !file.type || !file.type.startsWith('image/')) {
        throw new Error('Please choose an image file.');
    }
    if (file.size > CFG.maxInputMB * 1024 * 1024) {
        throw new Error(`Image is too large. Max ${CFG.maxInputMB} MB.`);
    }

    const blob = await resizeToSquareBlob(file);

    const fd = new FormData();
    fd.append('file', blob, 'avatar.jpg');
    fd.append('upload_preset', CFG.uploadPreset);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CFG.timeoutMs);
    let data;
    try {
        const res = await fetch(`https://api.cloudinary.com/v1_1/${CFG.cloudName}/image/upload`, {
            method: 'POST',
            body: fd,
            signal: ctrl.signal
        });
        data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error?.message || 'Upload failed');
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('Upload timed out. Check your connection and try again.');
        if (e instanceof TypeError) throw new Error('Network error. Check your connection and try again.');
        throw e;
    } finally {
        clearTimeout(timer);
    }

    if (!data.secure_url) throw new Error('Upload failed. Please try again.');
    return data.secure_url;
}

// ── Save / remove the URL on the user's own document ──
export async function saveProfilePhotoUrl(uid, url) {
    await updateDoc(doc(db, 'users', uid), { photoURL: url || '' });
    if (state.userData) state.userData.photoURL = url || '';
}
