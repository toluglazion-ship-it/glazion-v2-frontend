import { useEffect, useState, type ReactNode } from 'react';
import { Icon, toast, type IconName } from '@glazion/ui';
import { dismissForNow, promptInstall, useInstall, type Platform } from '../lib/install';

// Chrome on Android usually offers its install prompt a moment after the page loads. Wait that long
// before falling back to the written steps, so most people get the one-tap button.
const ANDROID_GRACE_MS = 2500;

interface Step {
  icon: IconName;
  title: ReactNode;
  text?: string;
}

function stepsFor(platform: Platform, inAppBrowser: boolean): { steps: Step[]; note: string | null } {
  const browser = platform === 'ios' ? 'Safari' : 'Chrome';
  const openFirst: Step[] = inAppBrowser
    ? [{ icon: 'external', title: `Open this page in ${browser}`, text: `Tap the ••• or ⋮ button and choose Open in ${browser}. Then follow the steps below.` }]
    : [];

  if (platform === 'ios') {
    return {
      steps: [
        ...openFirst,
        { icon: 'share', title: 'Tap the Share button', text: 'The square with an arrow pointing up, at the bottom of the screen (at the top on an iPad).' },
        { icon: 'plus-square', title: <>Scroll down and tap <strong>Add to Home Screen</strong></> },
        { icon: 'check', title: <>Tap <strong>Add</strong> in the top corner</> },
        { icon: 'smartphone', title: 'Open Capture from your home screen', text: 'Look for the Glazion icon, then sign in once more.' },
      ],
      note: inAppBrowser ? null : 'No Add to Home Screen? You probably opened the link inside another app, like WhatsApp. Open it in Safari and try again.',
    };
  }

  if (platform === 'android') {
    return {
      steps: [
        ...openFirst,
        { icon: 'more-vertical', title: 'Tap the menu button ⋮', text: 'The three dots at the top right of Chrome.' },
        { icon: 'plus-square', title: <>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong></> },
        { icon: 'check', title: <>Tap <strong>Install</strong></> },
        { icon: 'smartphone', title: 'Open Capture from your home screen', text: 'Look for the Glazion icon.' },
      ],
      note: inAppBrowser ? null : 'Opened the link from WhatsApp? Tap ⋮ and choose Open in Chrome first.',
    };
  }

  return {
    steps: [
      { icon: 'download', title: 'Click the install icon at the right end of the address bar', text: 'Or open the browser menu and choose Install.' },
      { icon: 'check', title: <>Click <strong>Install</strong></> },
    ],
    note: 'Capture works best on a phone, where you can take the photos.',
  };
}

export function InstallGuide({ onClose }: { onClose: () => void }) {
  const { platform, inAppBrowser } = useInstall();
  const { steps, note } = stepsFor(platform, inAppBrowser);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="install-guide-title">
        <div className="sheet-grip" aria-hidden="true" />
        <h2 id="install-guide-title" className="sheet-title">
          Add Capture to your home screen
        </h2>
        <ol className="install-steps">
          {steps.map((step, i) => (
            <li key={i}>
              <span className="install-step-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="install-step-body">
                <span className="install-step-title">{step.title}</span>
                {step.text && <span className="install-step-text">{step.text}</span>}
              </span>
              <span className="install-step-icon" aria-hidden="true">
                <Icon name={step.icon} size={22} />
              </span>
            </li>
          ))}
        </ol>
        {note && <p className="sheet-note">{note}</p>}
        <button className="btn btn-primary btn-block" onClick={onClose} autoFocus>
          Got it
        </button>
      </div>
    </div>
  );
}

/** Installs straight away where the browser allows it, otherwise opens the written steps. */
function useInstallAction() {
  const install = useInstall();
  const [guide, setGuide] = useState(false);

  async function start() {
    if (!install.canPrompt) {
      setGuide(true);
      return;
    }
    const result = await promptInstall();
    if (result === 'accepted') toast('Capture is being added to your home screen');
    else if (result === 'unavailable') setGuide(true);
  }

  return { install, start, guide, closeGuide: () => setGuide(false) };
}

/** The card on the Recipes screen. Hidden once installed, and for a week after "Not now". */
export function InstallBanner() {
  const { install, start, guide, closeGuide } = useInstallAction();
  const [waited, setWaited] = useState(install.platform !== 'android');

  useEffect(() => {
    if (waited) return;
    const timer = setTimeout(() => setWaited(true), ANDROID_GRACE_MS);
    return () => clearTimeout(timer);
  }, [waited]);

  // On a computer only the browser's own prompt is worth offering; Capture is meant for phones.
  const relevant = install.canPrompt || install.platform === 'ios' || (install.platform === 'android' && waited);
  const show = !install.installed && !install.dismissed && relevant;

  return (
    <>
      {show && (
        <section className="install-card" aria-label="Install the app">
          <div className="install-card-head">
            <img src="/icon-192.png" alt="" className="install-app-icon" width={48} height={48} />
            <div>
              <div className="install-card-title">Put Capture on your home screen</div>
              <p className="install-card-text">Then open it with one tap, like any other app.</p>
            </div>
          </div>
          <div className="install-card-actions">
            {/* Secondary: it was Home's only dark button, outweighing the recipes it sits under. */}
            <button className="btn btn-secondary" onClick={start}>
              <Icon name={install.canPrompt ? 'download' : 'info'} size={18} />
              {install.canPrompt ? 'Install' : 'Show me how'}
            </button>
            <button className="btn btn-ghost" onClick={dismissForNow}>
              Not now
            </button>
          </div>
        </section>
      )}
      {guide && <InstallGuide onClose={closeGuide} />}
    </>
  );
}

/** A lasting way back in from the Profile tab, after the banner has been put away. */
export function InstallButton() {
  const { install, start, guide, closeGuide } = useInstallAction();

  if (install.installed) {
    return (
      <p className="install-done">
        <Icon name="check" size={18} />
        Capture is installed on this device.
      </p>
    );
  }

  return (
    <>
      <button className="btn btn-secondary btn-block" onClick={start}>
        <Icon name={install.canPrompt ? 'download' : 'smartphone'} size={18} />
        {install.canPrompt ? 'Install the app' : 'How to install the app'}
      </button>
      {guide && <InstallGuide onClose={closeGuide} />}
    </>
  );
}
