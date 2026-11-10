// Getting Capture onto the home screen. Android and desktop Chrome offer an install prompt the app
// can open from its own button; iPhones never do, so there people get step-by-step instructions.
// Imported from main.tsx so the browser's offer is caught even if it arrives before the first screen.
import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type Platform = 'ios' | 'android' | 'desktop';

export interface InstallState {
  /** Running from the home screen, or installed during this visit. */
  installed: boolean;
  /** The browser has offered an install prompt, so one tap can install. */
  canPrompt: boolean;
  platform: Platform;
  /**
   * Opened inside another app's browser (Instagram, Facebook, an Android web view). Those can't
   * install anything, so the page has to be opened in the phone's own browser first.
   */
  inAppBrowser: boolean;
  /** "Not now" was tapped recently. */
  dismissed: boolean;
}

const DISMISS_KEY = 'glazion-install-dismissed-until';
const DISMISS_DAYS = 7;

export function detectPlatform(ua: string, maxTouchPoints = 0, platform = ''): Platform {
  // iPads report themselves as Macs; a Mac with a touch screen is an iPad.
  if (/iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export function isInAppBrowser(ua: string): boolean {
  return /FBAN|FBAV|Instagram|Snapchat|TikTok|Line\/|; wv\)/i.test(ua);
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true;
}

function readDismissed(): boolean {
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

let deferred: BeforeInstallPromptEvent | null = null;
let state: InstallState = {
  installed: isStandalone(),
  canPrompt: false,
  platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints, navigator.platform),
  inAppBrowser: isInAppBrowser(navigator.userAgent),
  dismissed: readDismissed(),
};
const listeners = new Set<() => void>();

function update(changes: Partial<InstallState>) {
  state = { ...state, ...changes };
  listeners.forEach((listener) => listener());
}

window.addEventListener('beforeinstallprompt', (event) => {
  // Keep Chrome's own small bar from showing; the app shows its own, clearer one.
  event.preventDefault();
  deferred = event as BeforeInstallPromptEvent;
  update({ canPrompt: true });
});

window.addEventListener('appinstalled', () => {
  deferred = null;
  update({ installed: true, canPrompt: false });
});

window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', (e) => {
  if (e.matches) update({ installed: true });
});

/** Opens the browser's install prompt. Only works where `canPrompt` is true. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return 'unavailable';
  // A prompt can only be shown once; the browser offers a fresh one later if it's declined.
  deferred = null;
  update({ canPrompt: false });
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') update({ installed: true });
    return outcome;
  } catch {
    return 'unavailable';
  }
}

/** Hides the home-screen banner for a week. The Profile tab still offers to install. */
export function dismissForNow() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86_400_000));
  } catch {
    // Without storage it simply comes back on the next visit.
  }
  update({ dismissed: true });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useInstall(): InstallState {
  return useSyncExternalStore(subscribe, () => state);
}
