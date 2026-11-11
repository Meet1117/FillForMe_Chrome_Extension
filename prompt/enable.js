/**
 * "Turn on FillForMe for this site?" popup.
 *
 * Shown inside the page (as an iframe) when a keyboard shortcut is pressed on a site
 * FillForMe isn't allowed on yet. Because this is an extension page, the click on
 * "Turn on" is a user gesture that may open Chrome's permission prompt – something a
 * content script on the page could not do.
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
    // Must be called straight from the click (user gesture).
    chrome.permissions.request({ origins: [pattern] }).then(async (granted) => {
      if (!granted) {
        status.textContent = 'FillForMe was not turned on. Press the shortcut again to retry.';
        return;
      }
      turnOn.disabled = true;
      status.textContent = 'Turned on.';
      try {
        // The worker registers the content scripts and runs the shortcut you pressed.
        await chrome.runtime.sendMessage({ type: 'bg:prompt-enabled', tabId });
      } finally {
        close();
      }
    }).catch((e) => {
      status.textContent = e.message;
    });
  });

  document.getElementById('notNow').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  turnOn.focus();
})();
