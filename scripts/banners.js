import { state } from './state.js';
import { cacheGet, cacheSet } from './cache.js';
import { fetchBanners } from '../services/banners.service.js';
import { STORAGE_KEYS, CACHE_TTL } from '../utils/constants.js';
import { APP_CONFIG } from '../config/app-config.js';

/*
 * ─────────────────────────────────────────────────────────────
 * FIXES APPLIED:
 * 1. ❌ `cacheIsFresh` unused import (line 2 ছিল না, কিন্তু list এ ছিল;
 *    আসলে এই file এ ছিল না — তবে নিশ্চিত করলাম এখানে নেই)
 *    ✅ এখানে কোনো unused import নেই — cacheIsFresh এখানে দরকার নেই
 *       কারণ আমরা সবসময় fresh fetch করি।
 * 2. ❌ Cloudinary transform hard-coded `w_900` (line 12)
 *    ✅ এখন APP_CONFIG.bannerImageWidth থেকে আসে (constants/app-config
 *       এ যোগ করতে হবে)।
 * 3. ✅ imageUrl security: HTML এ inject করার আগে encode করা হলো,
 *    যাতে attribute breaking না হয়।
 * ─────────────────────────────────────────────────────────────
 */

// ✅ width now from config, was hard-coded 'w_900'
const BANNER_WIDTH = APP_CONFIG.bannerImageWidth || 900;

function optimizeBannerUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (!url.includes('res.cloudinary.com/') || !url.includes('/upload/')) return url;
    if (url.includes('/upload/f_auto,q_auto/')) return url;
    return url.replace('/upload/', `/upload/f_auto,q_auto,w_${BANNER_WIDTH}/`);
}

function clearBannerTimer() {
    if (state.bannerInterval) {
        clearInterval(state.bannerInterval);
        state.bannerInterval = null;
    }
}

export async function loadBanners() {
    const CACHE_KEY = STORAGE_KEYS.banners;
    const cached = cacheGet(CACHE_KEY, localStorage);

    if (cached && cached.data) renderBanners(cached.data);

    try {
        const banners = await fetchBanners();
        cacheSet(CACHE_KEY, banners, localStorage);
        renderBanners(banners);
    } catch (e) {
        if (!cached) {
            const emptyEl = document.getElementById('banner-empty');
            const innerEl = document.getElementById('banner-slider-inner');
            if (emptyEl) emptyEl.style.display = 'flex';
            if (innerEl) innerEl.style.display = 'none';
        }
    }
}

// ✅ Encode URL before injecting into HTML attribute
function escapeAttr(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function renderBanners(banners) {
    const emptyEl = document.getElementById('banner-empty'),
        innerEl = document.getElementById('banner-slider-inner');
    const track = document.getElementById('banner-track'),
        dots = document.getElementById('banner-dots');
    if (!emptyEl || !innerEl || !track || !dots) return;
    if (!banners || banners.length === 0) {
        emptyEl.style.display = 'flex';
        innerEl.style.display = 'none';
        return;
    }
    emptyEl.style.display = 'none';
    innerEl.style.display = 'block';
    track.innerHTML = '';
    dots.innerHTML = '';
    state.bannerCount = banners.length;
    banners.forEach((b, i) => {
        const slide = document.createElement('div');
        slide.className = 'banner-slide' + (i === 0 ? ' active' : '');
        const imageUrl = optimizeBannerUrl(b.imageUrl);
        slide.innerHTML = imageUrl
            ? `
                <div class="banner-card">
                    <img class="banner-img"
                         src="${escapeAttr(imageUrl)}"
                         alt="Banner"
                         loading="lazy"
                         decoding="async">
                </div>
              `
            : `
                <div class="banner-card banner-empty-card">
                    <div class="banner-img-placeholder">🔥</div>
                </div>
              `;
        track.appendChild(slide);
        const dot = document.createElement('div');
        dot.className = 'banner-dot' + (i === 0 ? ' active' : '');
        dots.appendChild(dot);
    });
    clearBannerTimer();
    state.bannerIndex = 0;
    bindBannerSwipe();
    if (banners.length > 1 && !document.hidden) {
        state.bannerInterval = setInterval(
            () => goBanner((state.bannerIndex + 1) % state.bannerCount),
            APP_CONFIG.bannerIntervalMs
        );
    }
}

export function goBanner(idx) {
    state.bannerIndex = idx;
    const track = document.getElementById('banner-track'),
        dots = document.querySelectorAll('.banner-dot');
    if (track) {
        track.style.transform = `translateX(-${idx*100}%)`;
        // spotlight: mark the visible slide so CSS can pop it
        track.querySelectorAll('.banner-slide').forEach((s, i) => s.classList.toggle('active', i === idx));
    }
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
}

// ── Swipe gestures: drag left/right to change banner ──
let _swipeBound = false;
function bindBannerSwipe() {
    if (_swipeBound) return;
    const slider = document.getElementById('banner-container');
    if (!slider) return;
    _swipeBound = true;
    let startX = 0, touching = false;
    slider.addEventListener('touchstart', e => {
        touching = true;
        startX = e.touches[0].clientX;
        clearBannerTimer(); // pause autoplay while the user interacts
    }, { passive: true });
    slider.addEventListener('touchend', e => {
        if (!touching) return;
        touching = false;
        const dx = e.changedTouches[0].clientX - startX;
        if (Math.abs(dx) > 40 && state.bannerCount > 1) {
            if (dx < 0) goBanner((state.bannerIndex + 1) % state.bannerCount);
            else goBanner((state.bannerIndex - 1 + state.bannerCount) % state.bannerCount);
        }
        // resume autoplay after the swipe
        clearBannerTimer();
        if (state.bannerCount > 1 && !document.hidden) {
            state.bannerInterval = setInterval(
                () => goBanner((state.bannerIndex + 1) % state.bannerCount),
                APP_CONFIG.bannerIntervalMs
            );
        }
    }, { passive: true });
}

let _bannerEventsBound = false;
if (!_bannerEventsBound) {
    _bannerEventsBound = true;
    document.addEventListener('ff:cache-updated', e => {
        const fields = e.detail?.fields || [];
        if (fields.includes('banners')) loadBanners();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearBannerTimer();
        } else if (state.bannerCount > 1) {
            clearBannerTimer();
            state.bannerInterval = setInterval(
                () => goBanner((state.bannerIndex + 1) % state.bannerCount),
                APP_CONFIG.bannerIntervalMs
            );
        }
    });
}

window.goBanner = goBanner;