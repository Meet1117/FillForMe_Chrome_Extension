/**
 * Keyboard shortcuts, shown in the style of the user's device (ES module).
 *   Windows / Linux / ChromeOS: Alt+Shift+F
 *   macOS:                      ⌥⇧F   (Option + Shift + F)
 */

/** Default shortcut per command (manifest "suggested_key"). On a Mac, Alt is the Option key. */
export const DEFAULT_SHORTCUTS = {
  'ai-fill': 'Alt+Shift+F',
  'play-last': 'Alt+Shift+P',
  'toggle-recording': 'Alt+Shift+R',
};

export const OS_NAMES = { mac: 'macOS', win: 'Windows', linux: 'Linux', cros: 'ChromeOS' };

/** The device's operating system: 'mac' | 'win' | 'linux' | 'cros' | … */
export async function getOS() {
  try {
    return (await chrome.runtime.getPlatformInfo()).os;
  } catch {
    return /mac/i.test(navigator.userAgent) ? 'mac' : 'win';
  }
}

const MAC_SYMBOL = { Alt: '⌥', Option: '⌥', Shift: '⇧', Ctrl: '⌃', MacCtrl: '⌃', Command: '⌘' };
const SYMBOL_NAME = { '⌥': 'Alt', '⇧': 'Shift', '⌃': 'Ctrl', '⌘': 'Command' };
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘']; // Apple's standard modifier order

/**
 * Format a shortcut for a device. Accepts Chrome's text for either platform
 * ("Alt+Shift+F" or "⌥⇧F") and returns e.g. "⌥⇧F" on macOS, "Alt+Shift+F" elsewhere.
 */
export function formatShortcut(raw, os) {
  if (!raw) return '';
  let parts;
  if (raw.includes('+')) {
    parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
  } else {
    parts = [];
    let rest = raw;
    while (rest && SYMBOL_NAME[rest[0]]) {
      parts.push(SYMBOL_NAME[rest[0]]);
      rest = rest.slice(1);
    }
    parts.push(rest);
  }
  const key = parts.pop();
  if (os === 'mac') {
    const mods = parts.map((p) => MAC_SYMBOL[p] || p).sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
    return mods.join('') + key;
  }
  return [...parts.map((p) => (p === 'Command' || p === 'MacCtrl' ? 'Ctrl' : p === 'Option' ? 'Alt' : p)), key].join('+');
}
