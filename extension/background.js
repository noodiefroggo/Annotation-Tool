'use strict';

// Runs apart from any page. It is the only part that talks to the local server, because a
// page's security rules would block those requests from the overlay.

const SERVER = 'http://127.0.0.1:3190';

async function call(path, body) {
  const res = await fetch(`${SERVER}${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The tool answered ${res.status}`);
  return data;
}

async function activeTabs() {
  return (await chrome.storage.session.get('active')).active || {};
}

async function setActive(tabId, isActive) {
  const active = await activeTabs();
  if (isActive) active[tabId] = true;
  else delete active[tabId];
  await chrome.storage.session.set({ active });
  await chrome.action.setBadgeText({ tabId, text: isActive ? 'ON' : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#e5484d' });
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'toggle', active: isActive });
  } catch {
    // The tab was open before the extension was installed, so the scripts need adding.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['page.js'], world: 'MAIN' });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'toggle', active: isActive });
  }
}

async function captureView(sender, view) {
  const image = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'jpeg', quality: 88 });
  return call('/api/ext/view', { ...view, image });
}

const HANDLERS = {
  hello: async (message, sender) => ({ active: Boolean((await activeTabs())[sender.tab.id]) }),
  state: (message) => call(`/api/ext/state?url=${encodeURIComponent(message.url)}`),
  capture: (message, sender) => captureView(sender, message.view),
  mark: (message) => call('/api/ext/mark', { doc: message.doc, item: message.item }),
  remove: (message) => call('/api/ext/delete', { doc: message.doc, id: message.id }),
  setActive: (message) => setActive(message.tabId, message.active),
  close: (message, sender) => setActive(sender.tab.id, false),
};

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const handler = HANDLERS[message.type];
  if (!handler) return false;
  Promise.resolve(handler(message, sender))
    .then((result) => reply({ ok: true, result }))
    .catch((error) => reply({ ok: false, error: error.message }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-annotate') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await setActive(tab.id, !(await activeTabs())[tab.id]);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const active = await activeTabs();
  delete active[tabId];
  await chrome.storage.session.set({ active });
});

chrome.runtime.onInstalled.addListener(() => {
  call('/api/ext/hello', { version: chrome.runtime.getManifest().version }).catch(() => undefined);
});
