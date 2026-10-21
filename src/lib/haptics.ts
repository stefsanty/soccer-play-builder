/** Short vibration on devices that support it (Android browsers); a silent no-op elsewhere. */
export function haptic(ms: number | number[] = 10) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(ms)
  } catch {
    /* vibration blocked */
  }
}
