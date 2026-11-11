/**
 * Shared side panel state. sidepanel.js fills in the functions (render, reload, …);
 * the tab modules read and update this object.
 */
export const app = {
  tab: null,          // the browser tab the panel works on
  url: '',
  site: '',           // site key (origin)
  supported: false,   // http / https / file page
  enabled: false,     // user enabled FillForMe on this site
  settings: {},
  siteData: {},
  recordings: [],
  recSession: null,   // active recording (storage.session)
  playback: null,     // playback state (storage.session)
  view: 'record',     // record | ai | settings | editor
  lastTab: 'record',
  editorId: null,
  runs: {},           // "Run N times" values per recording
  ai: { scan: null, busy: false, progress: '', result: null, preview: null, scanning: false },

  render: () => {},
  reload: async () => {},
  go: () => {},
  confirmLive: async () => true,
};
