// Service worker entry point.
// Recording logic will be added in Phase 2.

chrome.runtime.onInstalled.addListener(() => {
  console.log('[PortalFlow] Extension installed');
});

// Configure the action to open the side panel when the icon is clicked.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[PortalFlow] Failed to set panel behavior', err));

export {};
