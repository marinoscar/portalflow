/**
 * Content script stub for PortalFlow runtime DOM actions.
 * Listens on the 'runner-dom' channel (distinct from the service worker's 'runner' channel).
 * Task 6 will extend this with real DOM interaction handlers.
 */

chrome.runtime.onMessage.addListener(
  (
    msg: { channel?: string },
    _sender,
    sendResponse: (response: { ok: boolean; message: string }) => void,
  ) => {
    if (msg.channel !== 'runner-dom') {
      return false; // not our message
    }

    sendResponse({ ok: false, message: 'not_implemented' });
    return false;
  },
);
