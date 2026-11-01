'use strict';

// Live browsing and Send to Claude. Loaded after app.js and shares its globals.

const FIT_WIDTH = 1440;
const PHONE_HEIGHT = 844;
const live = { state: null, timer: null, queue: [], sending: false, lastUrl: '' };

const isLiveDoc = () => S.doc?.meta.kind === 'live';
const inBrowse = () => S.mode === 'browse';

function liveSize() {
  const width = Number($('#liveWidth').value);
  if (width < 900) return { width, height: PHONE_HEIGHT };
  const box = $('#liveStage');
  const ratio = (box.clientHeight - 36) / Math.max(box.clientWidth - 36, 1);
  return { width, height: Math.round(clamp(width * ratio, 500, 1600)) };
}

function placeLive() {
  if (!inBrowse() || !live.state?.running) return;
  const box = $('#liveStage');
  const { width, height } = live.state;
  const scale = Math.min((box.clientWidth - 36) / width, (box.clientHeight - 36) / height);
  const frame = $('#liveFrame');
  frame.style.width = `${Math.floor(width * scale)}px`;
  frame.style.height = `${Math.floor(height * scale)}px`;
}

function showLiveStage(isOn) {
  $('#liveStage').hidden = !isOn;
  $('#stage').hidden = isOn;
  if (!isOn) $('#liveImg').removeAttribute('src');
  clearInterval(live.timer);
}

async function enterBrowse(url) {
  if (!isLiveDoc() && !url) return;
  const target = url || live.lastUrl || lastViewUrl() || S.doc.meta.source;
  closePopover();
  S.selected = null;
  S.mode = 'browse';
  syncTools();
  showLiveStage(true);
  toast('Starting the browser');
  try {
    const current = await api('/api/live/state');
    const sameSite = current.running && hostOf(current.url) === hostOf(target);
    const reply = await api('/api/live/open', json({
      url: url || !sameSite ? target : '', doc: S.doc.meta.id, ...liveSize(),
    }));
    live.state = reply.live;
    connectLive();
    toast('');
    $('#liveFrame').focus();
  } catch (err) {
    S.mode = 'doc';
    showLiveStage(false);
    syncTools();
    toast(err.message, 6000);
  }
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}

function lastViewUrl() {
  return S.doc?.meta.pages.at(-1)?.url;
}

function connectLive() {
  clearInterval(live.timer);
  live.timer = setInterval(syncLive, 900);
  $('#liveImg').src = `/api/live/stream?t=${Date.now()}`;
  $('#liveUrl').value = live.state.url || '';
  placeLive();
}

function leaveBrowse() {
  S.mode = 'doc';
  showLiveStage(false);
  syncTools();
  applyZoom();
}

async function syncLive() {
  try {
    const state = await api('/api/live/state');
    if (!state.running) {
      toast('The browser closed after being idle. Press Browse to start it again.', 6000);
      leaveBrowse();
      return;
    }
    live.state = state;
    live.lastUrl = state.url;
    if (document.activeElement !== $('#liveUrl')) $('#liveUrl').value = state.url;
  } catch { /* the next tick tries again */ }
}

async function freezeView(full = false) {
  toast(full ? 'Capturing the full page' : 'Freezing this view');
  try {
    const reply = await api('/api/live/capture', json({ doc: S.doc.meta.id, full }));
    S.doc.meta = reply.meta;
    S.mode = 'doc';
    showLiveStage(false);
    syncTools();
    if (!S.pages[reply.page.n]) addPage(reply.page);
    applyZoom();
    renderSide();
    const page = S.pages[reply.page.n];
    $('#stage').scrollTop = page.root.offsetTop - 18;
    toast('');
  } catch (err) {
    toast(err.message, 6000);
  }
}

function liveMods(e) {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

function livePoint(e) {
  const box = $('#liveImg').getBoundingClientRect();
  const { width, height } = live.state;
  return {
    x: Math.round(clamp((e.clientX - box.left) / box.width, 0, 1) * width),
    y: Math.round(clamp((e.clientY - box.top) / box.height, 0, 1) * height),
  };
}

function liveSend(event) {
  const last = live.queue.at(-1);
  if (event.t === 'move' && last?.t === 'move') live.queue[live.queue.length - 1] = event;
  else live.queue.push(event);
  pumpLive();
}

async function pumpLive() {
  if (live.sending || !live.queue.length) return;
  live.sending = true;
  const events = live.queue.splice(0);
  try {
    await fetch('/api/live/input', json({ events }));
  } catch { /* a dropped event is harmless */ }
  live.sending = false;
  pumpLive();
}

const MOUSE_BUTTONS = ['left', 'middle', 'right'];
const CLOUD_TARGET = 'cloud';

function bindLive() {
  const frame = $('#liveFrame');
  let held = null;

  frame.addEventListener('mousedown', (e) => {
    frame.focus();
    e.preventDefault();
    held = MOUSE_BUTTONS[e.button] || 'left';
    liveSend({ t: 'down', ...livePoint(e), button: held, count: e.detail || 1, mods: liveMods(e) });
  });
  window.addEventListener('mousemove', (e) => {
    if (!inBrowse() || (!held && !frame.matches(':hover'))) return;
    liveSend({
      t: 'move', ...livePoint(e), button: held || 'none', buttons: held ? e.buttons : 0, mods: liveMods(e),
    });
  });
  window.addEventListener('mouseup', (e) => {
    if (!held) return;
    liveSend({ t: 'up', ...livePoint(e), button: held, count: e.detail || 1, mods: liveMods(e) });
    held = null;
  });
  frame.addEventListener('wheel', (e) => {
    e.preventDefault();
    liveSend({ t: 'wheel', ...livePoint(e), dx: e.deltaX, dy: e.deltaY, mods: liveMods(e) });
  }, { passive: false });
  frame.addEventListener('contextmenu', (e) => e.preventDefault());

  const onKey = (e) => {
    e.stopPropagation();
    if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') return;
    e.preventDefault();
    const event = {
      t: e.type, key: e.key, code: e.code, keyCode: e.keyCode, mods: liveMods(e),
    };
    if (e.type === 'keydown') {
      if (e.key === 'Enter') event.text = '\r';
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) event.text = e.key;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') event.commands = ['selectAll'];
    }
    liveSend(event);
  };
  frame.addEventListener('keydown', onKey);
  frame.addEventListener('keyup', onKey);
  frame.addEventListener('paste', (e) => {
    e.preventDefault();
    liveSend({ t: 'text', text: e.clipboardData.getData('text') });
  });

  const go = (action, url) => {
    if (!inBrowse()) return enterBrowse(url);
    return api('/api/live/go', json({ action, url })).catch((err) => toast(err.message, 5000));
  };
  $('#liveBack').addEventListener('click', () => go('back'));
  $('#liveForward').addEventListener('click', () => go('forward'));
  $('#liveReload').addEventListener('click', () => go('reload'));
  $('#liveUrl').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      go('goto', $('#liveUrl').value.trim());
      $('#liveFrame').focus();
    }
  });
  $('#liveWidth').addEventListener('change', async () => {
    if (!inBrowse()) return;
    live.state = await api('/api/live/viewport', json(liveSize()));
    placeLive();
  });
  $('#liveFull').addEventListener('click', () => {
    if (inBrowse()) freezeView(true);
    else toast('Press Browse first, then capture from the page you want.', 4000);
  });
}

// ---------------------------------------------------------------- Send to Claude

function syncSendCount() {
  const count = S.unsent.size;
  $('#sendCount').textContent = count;
  $('#sendCount').hidden = !count;
  $('#scopeNewLabel').textContent = `New marks (${count})`;
  $('#scopeAllLabel').textContent = `All marks (${S.items.length})`;
}

async function refreshSendTargets() {
  const { listeners } = await api('/api/claude/state');
  const select = $('#sendTarget');
  const previous = select.value;
  select.replaceChildren();
  for (const listener of listeners) select.append(new Option(listener.name, listener.session));
  if (!listeners.length) select.append(new Option('Next Claude chat that connects', ''));
  select.append(new Option('Cloud chat', CLOUD_TARGET));
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  syncCloudFields();
  const count = listeners.length;
  $('#sendWho').textContent = count
    ? `Connected to ${count === 1 ? listeners[0].name : `${count} Claude chats`}`
    : 'No Claude chat is connected. Your notes will wait until one opens.';
  $('#sendWho').dataset.state = count ? 'on' : 'off';
}

function syncCloudFields() {
  const isCloud = $('#sendTarget').value === CLOUD_TARGET;
  $('#cloudFields').hidden = !isCloud;
  $('#sendWho').hidden = isCloud;
}

async function openSend() {
  const pop = $('#sendPop');
  if (!pop.hidden) { pop.hidden = true; return; }
  if (!S.doc) { toast('Open something first.', 3000); return; }
  await flush();
  syncSendCount();
  $('#sendCopy').hidden = !S.lastSendText;
  pop.hidden = false;
  $('#sendMessage').focus();
  await refreshSendTargets().catch(() => undefined);
  const { settings } = await api('/api/app').catch(() => ({ settings: {} }));
  $('#cloudLink').value = $('#cloudLink').value || settings.cloud || '';
  $('#cloudRepo').value = $('#cloudRepo').value || settings.repo || '';
}

async function sendToClaude() {
  const button = $('#sendGo');
  button.disabled = true;
  try {
    await flush();
    const scope = document.querySelector('input[name="sendScope"]:checked').value;
    const target = $('#sendTarget').value;
    if (target === CLOUD_TARGET) toast('Sending to the cloud chat');
    const reply = await api(`/api/docs/${S.doc.meta.id}/send`, json({
      scope, message: $('#sendMessage').value, target,
      cloud: $('#cloudLink').value, repo: $('#cloudRepo').value,
    }));
    S.unsent = new Set(reply.unsent);
    S.lastSendText = reply.text;
    $('#sendMessage').value = '';
    $('#sendPop').hidden = true;
    syncSendCount();
    renderSide();
    if (reply.cloud) {
      const note = reply.cloud.images ? '' : ' Text only, because the project is not a private GitHub repo.';
      toast(`Sent ${reply.count} mark${reply.count === 1 ? '' : 's'} to the cloud chat.${note}`, 6000);
      return;
    }
    toast(`Sending ${reply.count} mark${reply.count === 1 ? '' : 's'}`);
    watchDelivery(reply.id);
  } catch (err) {
    toast(err.message, 5000);
  } finally {
    button.disabled = false;
  }
}

async function watchDelivery(id) {
  for (let i = 0; i < 6; i++) {
    await new Promise((done) => { setTimeout(done, 700); });
    const { recent } = await api('/api/claude/state');
    const sent = recent.find((m) => m.id === id);
    if (sent?.delivered) {
      toast(`Delivered to ${sent.to}`, 4000);
      return;
    }
  }
  toast('Saved and waiting. It reaches the next Claude chat that connects. Copy message is in the Send panel.', 7000);
}

async function copySendText() {
  try {
    await navigator.clipboard.writeText(S.lastSendText);
    toast('Copied. Paste it into any chat.', 3000);
  } catch {
    toast('The browser blocked copying. The notes are in data\\LATEST.md.', 5000);
  }
}

function bindSend() {
  $('#sendBtn').addEventListener('click', openSend);
  $('#sendGo').addEventListener('click', sendToClaude);
  $('#sendClose').addEventListener('click', () => { $('#sendPop').hidden = true; });
  $('#sendTarget').addEventListener('change', syncCloudFields);
  $('#sendCopy').addEventListener('click', copySendText);
  $('#sendMessage').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendToClaude();
    if (e.key === 'Escape') $('#sendPop').hidden = true;
  });
}

start();
