// iOS/iPadOS detection used for rendering defaults. On iOS, AlphaTab renders
// via the web worker (same as other platforms), but the synchronous fallback
// path (triggered if the worker times out) runs on the main thread and is
// expensive — so we default to a lighter stave profile and smaller scale.
export function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports MacIntel but exposes touch points
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Default AlphaTab stave profile: tab-only on iOS (faster), scoreTab elsewhere. */
export const DEFAULT_STAVE_PROFILE = isIOS() ? 'tab' : 'scoreTab';

/** Default AlphaTab scale: 0.75 on all platforms to keep initial SVG element count manageable. */
export const DEFAULT_SCALE = 0.75;
