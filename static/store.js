'use strict';

// Everything the viewer saves or loads goes through `store`, so it never needs to know where the
// work lives. This is the local version, backed by the server on this computer. Calls reject with
// an Error that holds the reason. Website mode adds a second version with these same methods.

function localStore() {
  const request = async (path, options) => {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };
  const post = (path, body) => request(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  return {
    // Library and documents
    listDocs: () => request('/api/docs'),
    getApp: () => request('/api/app'),
    getDoc: (id) => request(`/api/docs/${id}`),
    getRevision: (id) => request(`/api/docs/${id}/revision`),
    openSource: (source) => post('/api/open', source),
    uploadPdf: (file) => request(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file }),
    refreshDoc: (id) => request(`/api/docs/${id}/refresh`, { method: 'POST' }),
    pageUrl: (id, image, version) => `/files/${id}/pages/${image}${version ? `?v=${version}` : ''}`,

    // Marks
    saveMarks: (id, items) => request(`/api/docs/${id}/annotations`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
    }),
    saveMarksOnExit: (id, items) => navigator.sendBeacon(
      `/api/docs/${id}/annotations`, new Blob([JSON.stringify({ items })], { type: 'application/json' }),
    ),

    // Live browser
    liveOpen: (options) => post('/api/live/open', options),
    liveState: () => request('/api/live/state'),
    liveCapture: (options) => post('/api/live/capture', options),
    liveInput: (events) => post('/api/live/input', { events }),
    liveGo: (action, url) => post('/api/live/go', { action, url }),
    liveViewport: (size) => post('/api/live/viewport', size),
    liveStreamUrl: () => `/api/live/stream?t=${Date.now()}`,

    // Send to Claude
    claudeState: () => request('/api/claude/state'),
    sendDoc: (id, options) => post(`/api/docs/${id}/send`, options),
  };
}

const store = localStore();
