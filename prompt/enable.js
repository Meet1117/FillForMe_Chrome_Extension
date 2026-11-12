/**
 * "Turn on FillForMe for this site?" popup.
 *
 * Shown inside the page (as an iframe) when a keyboard shortcut is pressed on a site
 * FillForMe isn't turned on for. FillForMe already has site access from install, so
 * "Turn on" normally just turns the site on. Only if the user limited FillForMe's site
 * access in Chrome does it open Chrome's prompt, which needs this click (a user gesture
 * that a content script on the page could not provide).
 */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const tabId = Number(q.get('tab'));
  const pattern = q.get('pattern') || '';
  const status = document.getElementById('status');
  const turnOn = document.getElementById('turnOn');

  document.getElementById('site').textContent = q.get('site') || 'this site';

  /** Ask the page-side script to remove this iframe. */
  function close() {
    parent.postMessage({ formpilot: 'close-enable-prompt' }, '*');
  }

  turnOn.addEventListener('click', () => {
    chrome.permissions.contains({ origins: [pattern] })
      .then((has) => has || chrome.permissions.request({ origins: [pattern] }))
      .then(async (granted) => {
        if (!granted) {
          status.textContent = 'FillForMe was not turned on. Press the shortcut again to retry.';
          return;
        }
        turnOn.disabled = true;
        status.textContent = 'Turned on.';
        try {
          // The worker registers the content scripts and runs the shortcut you pressed.
          await chrome.runtime.sendMessage({ type: 'bg:prompt-enabled', tabId, pattern });
        } finally {
          close();
        }
      })
      .catch((e) => {
        status.textContent = e.message;
      });
  });

  document.getElementById('notNow').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  turnOn.focus();
})();
