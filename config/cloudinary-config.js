// ════════════════════════════════════════════════════════════════
// Cloudinary (unsigned upload) — used only for profile photos.
// এখানে শুধু cloud name ও unsigned upload preset বসাও। কোনো API secret এখানে দিও না।
//   1) cloudinary.com → Settings → Upload → Upload presets → Add (Signing mode: Unsigned)
//   2) নিচের দুটো YOUR_ মান নিজের মান দিয়ে বদলাও
// YOUR_ থাকা অবস্থায় অ্যাপ ঠিকমতো চলে, শুধু ছবি আপলোডে "not set up" দেখায়।
// ════════════════════════════════════════════════════════════════
export const CLOUDINARY_CONFIG = {
    cloudName: 'dzgjcsysj',
    uploadPreset: 'profile_anik',
    outputSize: 400,      // px, square crop
    outputQuality: 0.82,  // JPEG quality
    maxInputMB: 8,
    timeoutMs: 20000
};
