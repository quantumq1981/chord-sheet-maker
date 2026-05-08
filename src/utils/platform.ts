// iOS/iPadOS detection helper retained for browser-specific export behavior.
export function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports MacIntel but exposes touch points
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Default AlphaTab stave profile: show standard notation and guitar tab together. */
export const DEFAULT_STAVE_PROFILE = 'scoreTab';

/** Default AlphaTab scale: 0.75 on all platforms to keep initial SVG element count manageable. */
export const DEFAULT_SCALE = 0.75;
