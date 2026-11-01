'use strict';

// Sending lives here, outside the page, so a site cannot press it for you.

const SERVER = 'http://127.0.0.1:3190';
const CLOUD = 'cloud';
const $ = (selector) => document.querySelector(selector);
const P = { tab: null, doc: null, active: false, unsent: 0 };

async function api(path, body) {
  const res = await fetch(`${SERVER}${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The tool answered ${res.status}`);
  return data;
}

const isMarkable = (url) => /^https?:/i.test(url || '') && !/^https:\/\/chromewebstore\.google\.com/.test(url);

function show(id) {
  for (const section of ['#offline', '#blocked', '#ready']) $(section).hidden = section !== id;
}

function syncToggle() {
  $('#toggle').textContent = P.active ? 'Stop annotating' : 'Annotate this page';
}

function syncCloud() {
  $('#cloudFields').hidden = $('#target').value !== CLOUD;
}

function fillTargets(listeners, settings) {
  const select = $('#target');
  select.replaceChildren();
  for (const listener of listeners) {
    select.append(new Option(listener.name, listener.session));
  }
  if (!listeners.length) select.append(new Option('Next Claude chat that connects', ''));
  select.append(new Option('Cloud chat', CLOUD));
  $('#cloudLink').value = settings.cloud || '';
  $('#repo').value = settings.repo || '';
  syncCloud();
}

async function refresh() {
  const state = await api(`/api/ext/state?url=${encodeURIComponent(P.tab.url.split('#')[0])}`);
  P.doc = state.doc;
  P.unsent = state.unsent;
  $('#sendArea').hidden = !state.total;
  $('#site').hidden = !state.doc;
  $('#counts').textContent = `${state.unsent} new of ${state.total} mark${state.total === 1 ? '' : 's'} on this site`;
  $('#send').disabled = !state.unsent;
  return state;
}

async function send() {
  const button = $('#send');
  const result = $('#result');
  const target = $('#target').value;
  button.disabled = true;
  result.dataset.state = '';
  result.textContent = 'Sending';
  try {
    const reply = await api(`/api/docs/${P.doc}/send`, {
      scope: 'new',
      message: $('#message').value,
      target,
      cloud: target === CLOUD ? $('#cloudLink').value : undefined,
      repo: target === CLOUD ? $('#repo').value : undefined,
    });
    $('#message').value = '';
    const images = reply.cloud && !reply.cloud.images ? ', text only because the project is not a private GitHub repo' : '';
    result.textContent = `Sent ${reply.count} mark${reply.count === 1 ? '' : 's'}${images}`;
    await refresh();
  } catch (error) {
    result.dataset.state = 'error';
    result.textContent = error.message;
    button.disabled = false;
  }
}

async function start() {
  [P.tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { active = {} } = await chrome.storage.session.get('active');
  P.active = Boolean(active[P.tab?.id]);
  syncToggle();
  try {
    await api('/api/ext/hello', { version: chrome.runtime.getManifest().version });
    $('#dot').dataset.state = 'on';
  } catch {
    $('#dot').dataset.state = 'off';
    show('#offline');
    return;
  }
  if (!isMarkable(P.tab?.url)) {
    show('#blocked');
    return;
  }
  show('#ready');
  const state = await refresh();
  fillTargets(state.listeners, state.settings);
}

$('#toggle').addEventListener('click', async () => {
  P.active = !P.active;
  syncToggle();
  await chrome.runtime.sendMessage({ type: 'setActive', tabId: P.tab.id, active: P.active });
  if (P.active) window.close();
});
$('#target').addEventListener('change', syncCloud);
$('#send').addEventListener('click', send);
$('#site').addEventListener('click', () => {
  chrome.tabs.create({ url: `http://localhost:3190/?doc=${encodeURIComponent(P.doc)}` });
});

start();
