// iOS/iPadOS detection. Module Web Workers hang silently on iOS Safari, so
// AlphaTab runs synchronously there — keep rendering settings lightweight.
export function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports MacIntel but exposes touch points
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Default AlphaTab stave profile: tab-only on iOS (faster), scoreTab elsewhere. */
export const DEFAULT_STAVE_PROFILE = isIOS() ? 'tab' : 'scoreTab';

/** Default AlphaTab scale: 0.75 on iOS to reduce SVG element count, 1.0 elsewhere. */
export const DEFAULT_SCALE = isIOS() ? 0.75 : 1;
