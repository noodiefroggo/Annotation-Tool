'use strict';

const $ = (selector) => document.querySelector(selector);
const NS = 'http://www.w3.org/2000/svg';

const COLORS = [
  ['Red', '#e5484d'], ['Orange', '#f76b15'], ['Yellow', '#f5b700'], ['Green', '#30a46c'],
  ['Blue', '#0090ff'], ['Purple', '#8e4ec6'], ['Black', '#1c2024'],
];
const TOOLS = [
  ['browse', 'b', 'Browse the live site', '<circle cx="9" cy="9" r="7"/><path d="M2 9h14M9 2c2.2 2 3.3 4.3 3.3 7s-1.1 5-3.3 7c-2.2-2-3.3-4.3-3.3-7s1.1-5 3.3-7z"/>', 'Browse'],
  ['select', 'v', 'Select and move', '<path d="M4 2.5l11 5.6-4.9 1.5-1.9 4.9z"/>'],
  ['comment', 'c', 'Add a comment', '<path d="M3.5 3h11A1.5 1.5 0 0116 4.500v7a1.5 1.5 0 01-1.5 1.5H8l-3.5 3v-3h-1A1.5 1.5 0 012 11.5v-7A1.5 1.5 0 013.5 3z"/>', 'Comment'],
  ['pen', 'p', 'Pen', '<path d="M12 2.5l3.5 3.5-9 9-4.3.8.8-4.3z"/>'],
  ['highlight', 'h', 'Highlighter', '<path d="M4 11l6-8.5 4 2.8-6 8.5H4zM2.5 16.5h13"/>'],
  ['arrow', 'a', 'Arrow', '<path d="M3 15L15 3M7 3h8v8"/>'],
  ['ellipse', 'o', 'Circle', '<ellipse cx="9" cy="9" rx="7" ry="5.5"/>'],
  ['rect', 'r', 'Box', '<rect x="2.5" y="4" width="13" height="10" rx="1"/>'],
  ['sticky', 'n', 'Sticky note', '<path d="M3 3h12v7.5L10.5 15H3zM15 10.5h-4.5V15"/>'],
  ['text', 't', 'Text', '<path d="M3.5 5V3h11v2M9 3v12M6.5 15h5"/>'],
];
const KIND_NAMES = {
  pen: 'Pen', highlight: 'Highlight', arrow: 'Arrow', ellipse: 'Circle', rect: 'Box',
  sticky: 'Sticky note', text: 'Text', comment: 'Comment',
};
const LIGHT_COLORS = ['#f76b15', '#f5b700'];
const TAGS = ['Bug', 'Feature', 'Enhancement'];
const PAGE_LABELS = { pdf: 'Page', web: 'Snapshot', live: 'View', page: 'View' };
const KIND_LABELS = { pdf: 'PDF', web: 'Snapshot', live: 'Live', page: 'Chrome' };
const FILTERS = [['all', 'All'], ['pdf', 'PDFs'], ['web', 'Websites'], ['page', 'Chrome']];
const SYNC_MS = 3000;
const SIZES = [2, 3.5, 7];
const DRAG_KINDS = ['arrow', 'rect', 'ellipse'];
const INK_MERGE_MS = 1500;
const INK_MERGE_GAP = 170;

const S = {
  doc: null, paths: null, items: [], tool: 'pen', color: COLORS[0][1], size: 1,
  zoom: 1, fit: true, selected: null, editing: null, editBefore: null,
  undo: [], redo: [], pages: {}, lastInk: null, action: null, saveTimer: null, dirty: false,
  mode: 'doc', unsent: new Set(), lastSendText: '', rev: 0, docs: [], filter: 'all',
};

const round = (v) => Math.round(v * 10) / 10;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const byId = (id) => S.items.find((a) => a.id === id);
const makeId = () => Math.random().toString(36).slice(2, 10);
const nextNumber = () => S.items.reduce((max, a) => Math.max(max, a.n || 0), 0) + 1;

const onColor = (color) => (LIGHT_COLORS.includes(color) ? '#1c2024' : '#fff');

function svg(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const key in attrs) el.setAttribute(key, attrs[key]);
  return el;
}

// Mirrors bbox() in server.py.
function bbox(a) {
  const points = a.strokes.flat();
  let x0 = Math.min(...points.map((p) => p[0]));
  let y0 = Math.min(...points.map((p) => p[1]));
  let x1 = Math.max(...points.map((p) => p[0]));
  let y1 = Math.max(...points.map((p) => p[1]));
  if (a.kind === 'sticky' || a.kind === 'text') return [x0, y0, x0 + a.w, y0 + a.h];
  if (a.kind === 'comment') return [x0, y0 - a.size * 2.8, x0 + a.size * 2.4, y0];
  let pad = (a.width || 3) / 2 + 1;
  if (a.kind === 'arrow') pad += (a.width || 3) * 2;
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

function inkPath(points) {
  if (points.length < 3) {
    const [a, b = a] = points;
    return `M${a[0]} ${a[1]}L${b[0] + .01} ${b[1]}`;
  }
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const mx = (x + points[i + 1][0]) / 2;
    const my = (y + points[i + 1][1]) / 2;
    d += `Q${x} ${y} ${round(mx)} ${round(my)}`;
  }
  const last = points[points.length - 1];
  return `${d}L${last[0]} ${last[1]}`;
}

function arrowParts(a) {
  const [p1, p2] = [a.strokes[0][0], a.strokes[0].at(-1)];
  const size = a.width * 4.5;
  const angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
  const at = (d, off) => [p2[0] - d * Math.cos(angle + off), p2[1] - d * Math.sin(angle + off)];
  return { p1, base: at(size * .8, 0), head: [p2, at(size, -.45), at(size, .45)] };
}

// A speech bubble whose tail tip sits exactly on the clicked point.
function commentShape(a) {
  const [x, y] = a.strokes[0][0];
  const r = a.size;
  const top = y - r * 2.8;
  const c = r * .6;
  const d = `M${x + c} ${top}H${x + r * 2.4 - c}a${c} ${c} 0 0 1 ${c} ${c}V${top + r * 2 - c}`
    + `a${c} ${c} 0 0 1 ${-c} ${c}H${x + r * 1.1}L${x} ${y}L${x + r * .3} ${top + r * 2}H${x + c}`
    + `a${c} ${c} 0 0 1 ${-c} ${-c}V${top + c}a${c} ${c} 0 0 1 ${c} ${-c}Z`;
  return { cx: x + r * 1.2, cy: top + r, r, d };
}

function drawMark(a) {
  const g = svg('g', { class: `mark ${a.kind}`, 'data-id': a.id });
  const paint = { fill: 'none', stroke: a.color, 'stroke-width': a.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const hitWidth = Math.max(a.width, 14 / S.zoom);
  const shapes = [];

  if (a.kind === 'pen' || a.kind === 'highlight') {
    if (a.kind === 'highlight') g.setAttribute('opacity', '.4');
    for (const stroke of a.strokes) shapes.push(svg('path', { d: inkPath(stroke) }));
  } else if (a.kind === 'arrow') {
    const { p1, base, head } = arrowParts(a);
    shapes.push(svg('line', { x1: p1[0], y1: p1[1], x2: base[0], y2: base[1] }));
    const tip = svg('polygon', { points: head.join(' '), fill: a.color, stroke: 'none' });
    g.append(tip);
  } else if (a.kind === 'rect') {
    const [p, q] = [a.strokes[0][0], a.strokes[0].at(-1)];
    shapes.push(svg('rect', {
      x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]),
      width: Math.abs(p[0] - q[0]), height: Math.abs(p[1] - q[1]), rx: 2,
    }));
  } else if (a.kind === 'ellipse') {
    const [p, q] = [a.strokes[0][0], a.strokes[0].at(-1)];
    shapes.push(svg('ellipse', {
      cx: (p[0] + q[0]) / 2, cy: (p[1] + q[1]) / 2,
      rx: Math.abs(p[0] - q[0]) / 2, ry: Math.abs(p[1] - q[1]) / 2,
    }));
  } else if (a.kind === 'comment') {
    const { cx, r, cy, d } = commentShape(a);
    const body = svg('path', { d, fill: a.color, stroke: '#fff', 'stroke-width': r * .12 });
    const label = svg('text', {
      x: cx, y: cy, fill: onColor(a.color), 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': r * 1.05, 'font-weight': 600, 'font-family': 'system-ui, sans-serif',
    });
    label.textContent = a.n;
    const hit = svg('path', { d, class: 'hit solid', fill: 'transparent' });
    if (a.text) {
      const tip = svg('title');
      tip.textContent = a.text;
      hit.append(tip);
    }
    g.append(body, label, hit);
    return g;
  }

  for (const shape of shapes) {
    for (const key in paint) shape.setAttribute(key, paint[key]);
    g.append(shape);
    const hit = shape.cloneNode();
    hit.setAttribute('class', 'hit');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', hitWidth);
    g.append(hit);
  }
  return g;
}

function drawNote(a) {
  const el = document.createElement('div');
  el.className = `note ${a.kind}`;
  el.dataset.id = a.id;
  el.style.cssText = `left:${a.strokes[0][0][0]}px;top:${a.strokes[0][0][1]}px;width:${a.w}px;font-size:${a.fs}px;--c:${a.color}`;
  const area = document.createElement('textarea');
  area.value = a.text || '';
  area.rows = 1;
  area.readOnly = true;
  area.setAttribute('aria-label', KIND_NAMES[a.kind]);
  area.addEventListener('input', () => {
    a.text = area.value;
    fitNote(a, el);
    renderSide();
    touch();
  });
  area.addEventListener('blur', () => finishEdit(a));
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') area.blur();
    e.stopPropagation();
  });
  const corner = document.createElement('div');
  corner.className = 'grip corner';
  corner.title = 'Drag to scale the note and its text';
  const edge = document.createElement('div');
  edge.className = 'grip edge';
  edge.title = 'Drag to change the width';
  el.append(area, corner, edge);
  return el;
}

function fitNote(a, el) {
  const area = el.querySelector('textarea');
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight}px`;
  a.h = round(el.offsetHeight);
}

// ---------------------------------------------------------------- rendering

function renderPage(n) {
  const page = S.pages[n];
  if (!page) return;
  page.marks.replaceChildren();
  page.notes.replaceChildren();
  for (const a of S.items) {
    if (a.page !== n) continue;
    if (a.kind === 'sticky' || a.kind === 'text') {
      const el = drawNote(a);
      if (a.id === S.selected) el.classList.add('selected');
      page.notes.append(el);
      fitNote(a, el);
    } else {
      page.marks.append(drawMark(a));
      if (a.id === S.selected) {
        const [x0, y0, x1, y1] = bbox(a);
        const pad = 5 / S.zoom;
        page.marks.append(svg('rect', {
          class: 'sel-box', x: x0 - pad, y: y0 - pad, width: x1 - x0 + pad * 2, height: y1 - y0 + pad * 2,
        }));
      }
    }
  }
}

function renderAll() {
  for (const n in S.pages) renderPage(Number(n));
  renderSide();
}

function renderSide() {
  const list = $('#noteList');
  $('#noteCount').textContent = S.items.length;
  syncSendCount();
  if (!S.items.length) {
    list.innerHTML = '<div class="empty">Marks you draw show up here. Pick a tool and go.</div>';
    return;
  }
  const label = PAGE_LABELS[S.doc.meta.kind];
  const sorted = [...S.items].sort((a, b) => a.page - b.page || bbox(a)[1] - bbox(b)[1]);
  const fragment = document.createDocumentFragment();
  let current = null;
  for (const a of sorted) {
    if (a.page !== current) {
      current = a.page;
      const head = document.createElement('div');
      head.className = 'page-head';
      const pageUrl = S.doc.meta.pages[a.page - 1]?.url;
      head.textContent = `${label} ${a.page}`;
      if (pageUrl) head.title = pageUrl;
      fragment.append(head);
    }
    const row = document.createElement('button');
    row.className = `item${a.id === S.selected ? ' current' : ''}${S.unsent.has(a.id) ? '' : ' sent'}`;
    row.style.setProperty('--c', a.color);
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = a.n;
    num.style.color = onColor(a.color);
    const body = document.createElement('span');
    body.className = 'body';
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = a.tag ? `${KIND_NAMES[a.kind]} · ${a.tag}` : KIND_NAMES[a.kind];
    body.append(kind);
    if (a.text) body.append(a.text);
    else {
      const none = document.createElement('span');
      none.className = 'none';
      none.textContent = 'No note';
      body.append(none);
    }
    const code = a.target?.source || a.target?.component;
    if (code) {
      const where = document.createElement('code');
      where.className = 'where';
      where.textContent = code;
      body.append(where);
    }
    row.append(num, body);
    row.addEventListener('click', () => jumpTo(a));
    fragment.append(row);
  }
  list.replaceChildren(fragment);
}

function jumpTo(a) {
  if (inBrowse()) leaveBrowse();
  setTool('select');
  select(a.id);
  const page = S.pages[a.page];
  const stage = $('#stage');
  const [, y0] = bbox(a);
  const top = page.root.offsetTop + y0 * S.zoom - stage.clientHeight / 3;
  stage.scrollTo({ top: Math.max(top, 0) });
}

function buildPages() {
  $('#pages').replaceChildren();
  S.pages = {};
  S.doc.meta.pages.forEach(addPage);
  applyZoom();
}

function addPage(p) {
  const { meta } = S.doc;
  {
    const root = document.createElement('div');
    root.className = 'page';
    root.dataset.n = p.n;
    const layer = document.createElement('div');
    layer.className = 'layer';
    layer.style.width = `${p.w}px`;
    layer.style.height = `${p.h}px`;
    const img = document.createElement('img');
    img.src = store.pageUrl(meta.id, p.img, p.v || meta.updated);
    img.alt = `Page ${p.n}`;
    img.loading = 'lazy';
    img.draggable = false;
    const canvas = svg('svg', { viewBox: `0 0 ${p.w} ${p.h}` });
    const marks = svg('g');
    const draft = svg('g');
    canvas.append(marks, draft);
    const notes = document.createElement('div');
    notes.className = 'notes';
    layer.append(img, canvas, notes);
    const tag = document.createElement('span');
    tag.className = 'page-tag';
    tag.textContent = { pdf: `${p.n} / ${meta.pages.length}`, live: `${p.n}: ${p.url}` }[meta.kind] || '';
    root.append(tag, layer);
    root.addEventListener('pointerdown', (e) => onDown(e, p.n));
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
    root.addEventListener('dblclick', onDouble);
    $('#pages').append(root);
    S.pages[p.n] = { root, layer, marks, draft, notes, w: p.w, h: p.h };
  }
}

function fitZoom() {
  const { pages } = S.doc.meta;
  if (!pages.length) return 1;
  const stage = $('#stage');
  const widest = Math.max(...pages.map((p) => p.w));
  const views = pages.filter((p) => p.view === 'viewport').map((p) => p.h);
  const byHeight = views.length ? (stage.clientHeight - 36) / Math.max(...views) : Infinity;
  return clamp(Math.min((stage.clientWidth - 36) / widest, byHeight), .1, 3);
}

function applyZoom(previous = S.zoom) {
  if (!S.doc) return;
  if (inBrowse()) { placeLive(); return; }
  const stage = $('#stage');
  const middle = stage.scrollTop + stage.clientHeight / 2;
  if (S.fit) S.zoom = fitZoom();
  for (const n in S.pages) {
    const page = S.pages[n];
    page.root.style.width = `${page.w * S.zoom}px`;
    page.root.style.height = `${page.h * S.zoom}px`;
    page.layer.style.transform = `scale(${S.zoom})`;
  }
  stage.scrollTop = middle * (S.zoom / previous) - stage.clientHeight / 2;
  renderAll();
  placePopover();
}

function setZoom(next) {
  const previous = S.zoom;
  S.fit = false;
  S.zoom = clamp(next, .1, 4);
  applyZoom(previous);
}

// ---------------------------------------------------------------- pointer input

function toUnits(e, n) {
  const box = S.pages[n].root.getBoundingClientRect();
  const page = S.pages[n];
  return [
    round(clamp((e.clientX - box.left) / S.zoom, 0, page.w)),
    round(clamp((e.clientY - box.top) / S.zoom, 0, page.h)),
  ];
}

function strokeWidth(kind) {
  const base = SIZES[S.size] * (kind === 'highlight' ? 6 : 1);
  return round(base / S.zoom);
}

function newItem(kind, page, strokes, extra = {}) {
  return {
    id: makeId(), n: nextNumber(), page, kind, color: S.color,
    width: strokeWidth(kind), strokes, text: '', created: Date.now(), ...extra,
  };
}

function onDown(e, n) {
  if (e.button !== 0 || e.target.closest('#pop')) return;
  const grip = e.target.classList.contains('grip');
  if (S.editing && !grip && e.target.closest('.note.editing')) return;
  const p = toUnits(e, n);
  const noteEl = e.target.closest('.note');
  const noteId = noteEl?.dataset.id;
  if (document.activeElement?.tagName === 'TEXTAREA') document.activeElement.blur();

  if (grip) {
    const a = byId(noteId);
    if (!a) return;
    e.preventDefault();
    S.selected = a.id;
    S.action = {
      type: 'resize', a, n, startX: p[0], startW: a.w, startFs: a.fs, before: snapshot(), changed: false,
      scales: e.target.classList.contains('corner'),
    };
    capture(e, n);
    return;
  }

  if (S.tool === 'select') {
    const markEl = e.target.closest('.mark');
    const id = noteId || markEl?.dataset.id;
    if (!id) { select(null); return; }
    select(id);
    S.action = { type: 'move', a: byId(id), n, last: p, before: snapshot(), changed: false };
    capture(e, n);
    return;
  }

  if (noteEl && (S.tool === 'sticky' || S.tool === 'text')) {
    startEdit(byId(noteEl.dataset.id));
    e.preventDefault();
    return;
  }
  select(null);

  if (S.tool === 'sticky' || S.tool === 'text') {
    e.preventDefault();
    const fs = round(14 / S.zoom);
    const w = round((S.tool === 'sticky' ? 200 : 240) / S.zoom);
    commit(() => {
      const a = newItem(S.tool, n, [[p]], { fs, w, h: round(fs * 3) });
      S.items.push(a);
      renderPage(n);
      startEdit(a);
    });
    return;
  }
  if (S.tool === 'comment') {
    e.preventDefault();
    commit(() => {
      const a = newItem('comment', n, [[p]], { size: round(13 / S.zoom) });
      S.items.push(a);
      select(a.id, true);
    });
    return;
  }

  capture(e, n);
  S.action = { type: 'draw', kind: S.tool, n, points: [p], shape: null };
}

function capture(e, n) {
  S.pages[n].root.setPointerCapture(e.pointerId);
}

function onMove(e) {
  const act = S.action;
  if (!act) return;
  const p = toUnits(e, act.n);
  if (act.type === 'move') {
    const dx = p[0] - act.last[0];
    const dy = p[1] - act.last[1];
    if (!dx && !dy) return;
    act.last = p;
    act.changed = true;
    for (const stroke of act.a.strokes) {
      for (const point of stroke) { point[0] = round(point[0] + dx); point[1] = round(point[1] + dy); }
    }
    renderPage(act.n);
    placePopover();
    return;
  }
  if (act.type === 'resize') {
    act.changed = true;
    const width = Math.max(50 / S.zoom, act.startW + p[0] - act.startX);
    act.a.w = round(width);
    if (act.scales) act.a.fs = round(act.startFs * (width / act.startW));
    renderPage(act.n);
    return;
  }
  if (DRAG_KINDS.includes(act.kind)) {
    act.points = [act.points[0], p];
  } else {
    const events = e.getCoalescedEvents?.() || [e];
    const gap = 1.5 / S.zoom;
    for (const ev of events.length ? events : [e]) {
      const q = toUnits(ev, act.n);
      const last = act.points.at(-1);
      if (Math.hypot(q[0] - last[0], q[1] - last[1]) >= gap) act.points.push(q);
    }
  }
  drawDraft(act);
}

function drawDraft(act) {
  const draft = S.pages[act.n].draft;
  draft.replaceChildren();
  const preview = {
    id: 'draft', n: 0, kind: act.kind, color: S.color, width: strokeWidth(act.kind), strokes: [act.points],
  };
  if (act.points.length > 1) draft.append(drawMark(preview));
}

function onUp() {
  const act = S.action;
  if (!act) return;
  S.action = null;
  if (act.type === 'move' || act.type === 'resize') {
    if (act.changed) { pushUndo(act.before); touch(); }
    return;
  }
  S.pages[act.n].draft.replaceChildren();
  const size = strokeSpan(act.points);
  if (DRAG_KINDS.includes(act.kind) && size < 5 / S.zoom) return;
  commit(() => {
    const now = Date.now();
    const last = S.lastInk && byId(S.lastInk.id);
    if (act.kind === 'pen' && last && now - S.lastInk.at < INK_MERGE_MS && last.page === act.n
      && last.color === S.color && gapToMark(last, act.points[0]) < INK_MERGE_GAP / S.zoom) {
      last.strokes.push(act.points);
      S.lastInk.at = now;
    } else {
      const a = newItem(act.kind, act.n, [act.points]);
      S.items.push(a);
      S.lastInk = act.kind === 'pen' ? { id: a.id, at: now } : null;
      S.lastMark = a.id;
    }
    renderPage(act.n);
  });
}

function strokeSpan(points) {
  const a = points[0];
  return Math.max(...points.map((p) => Math.hypot(p[0] - a[0], p[1] - a[1])));
}

function gapToMark(a, p) {
  const [x0, y0, x1, y1] = bbox(a);
  return Math.hypot(Math.max(x0 - p[0], 0, p[0] - x1), Math.max(y0 - p[1], 0, p[1] - y1));
}

function onDouble(e) {
  if (S.tool !== 'select') return;
  const noteEl = e.target.closest('.note');
  if (noteEl) startEdit(byId(noteEl.dataset.id));
}

// ---------------------------------------------------------------- selection and notes

function select(id, focus = false) {
  S.selected = id;
  renderAll();
  const a = id && byId(id);
  if (a && a.kind !== 'sticky' && a.kind !== 'text') openPopover(a, focus);
  else closePopover();
}

function openPopover(a, focus) {
  const pop = $('#pop');
  S.pages[a.page].root.append(pop);
  pop.hidden = false;
  $('#popText').value = a.text || '';
  $('#popLabel').textContent = `#${a.n} ${KIND_NAMES[a.kind]}`;
  syncPopTags(a);
  placePopover();
  if (focus) {
    S.editBefore = snapshot();
    $('#popText').focus();
  }
}

function syncPopTags(a) {
  for (const button of $('#popTags').children) {
    button.setAttribute('aria-pressed', String(a.tag === button.textContent));
  }
}

function placePopover() {
  const pop = $('#pop');
  const a = S.selected && byId(S.selected);
  if (pop.hidden || !a) return;
  const page = S.pages[a.page];
  const [, y0, x1] = bbox(a);
  const width = page.w * S.zoom;
  const height = page.h * S.zoom;
  const fitsRight = x1 * S.zoom + 268 < width;
  const left = fitsRight ? x1 * S.zoom + 8 : clamp(bbox(a)[0] * S.zoom - 268, 0, Math.max(width - 260, 0));
  const top = clamp(y0 * S.zoom, 0, Math.max(height - 130, 0));
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function closePopover() {
  const pop = $('#pop');
  if (document.activeElement === $('#popText')) $('#popText').blur();
  pop.hidden = true;
  document.body.append(pop);
}

function startEdit(a) {
  const page = S.pages[a.page];
  const el = page.notes.querySelector(`[data-id="${a.id}"]`);
  if (!el) return;
  S.selected = a.id;
  S.editing = a.id;
  S.editBefore = S.editBefore || snapshot();
  el.classList.add('editing', 'selected');
  const area = el.querySelector('textarea');
  area.readOnly = false;
  setTimeout(() => { area.focus(); area.setSelectionRange(area.value.length, area.value.length); });
}

function finishEdit(a) {
  if (S.editing !== a.id) return;
  S.editing = null;
  const before = S.editBefore;
  S.editBefore = null;
  if (!(a.text || '').trim()) {
    S.items = S.items.filter((item) => item.id !== a.id);
    if (S.selected === a.id) S.selected = null;
  }
  if (before && before !== snapshot()) pushUndo(before);
  renderPage(a.page);
  renderSide();
  touch();
}

function deleteSelected() {
  const id = S.selected;
  if (!id) return;
  commit(() => {
    S.items = S.items.filter((a) => a.id !== id);
    S.selected = null;
    closePopover();
    renderAll();
  });
}

// ---------------------------------------------------------------- history and saving

function snapshot() {
  return JSON.stringify(S.items);
}

function pushUndo(before) {
  S.undo.push(before);
  if (S.undo.length > 200) S.undo.shift();
  S.redo = [];
  syncHistory();
}

function commit(change) {
  const before = snapshot();
  change();
  pushUndo(before);
  renderSide();
  touch();
}

function restore(from, to) {
  if (!from.length) return;
  to.push(snapshot());
  S.items = JSON.parse(from.pop());
  S.selected = null;
  S.lastInk = null;
  closePopover();
  renderAll();
  syncHistory();
  touch();
}

function syncHistory() {
  $('#undoBtn').disabled = !S.undo.length;
  $('#redoBtn').disabled = !S.redo.length;
}

function touch() {
  S.dirty = true;
  setStatus('Saving');
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(save, 350);
}

async function save() {
  if (!S.doc || !S.dirty) return;
  S.dirty = false;
  try {
    const reply = await store.saveMarks(S.doc.meta.id, S.items);
    S.unsent = new Set(reply.unsent);
    S.rev = reply.rev;
    syncSendCount();
    if (!S.dirty) renderSide();
    if (!S.dirty) setStatus(`Saved, ${S.items.length} mark${S.items.length === 1 ? '' : 's'}`);
  } catch {
    S.dirty = true;
    setStatus('Could not save. Is the server running?');
  }
}

function setStatus(text) {
  $('#status').textContent = text;
}

// ---------------------------------------------------------------- toolbar

// In a live review, picking a drawing tool freezes what the browser shows so it can be marked.
function setTool(tool) {
  if (tool === 'browse') {
    if (isLiveDoc() && !inBrowse()) enterBrowse();
    return;
  }
  S.tool = tool;
  if (tool !== 'select') select(null);
  syncTools();
  if (!inBrowse()) return;
  if (tool === 'select') leaveBrowse();
  else freezeView();
}

function syncTools() {
  for (const button of document.querySelectorAll('#tools button')) {
    const active = inBrowse() ? 'browse' : S.tool;
    button.setAttribute('aria-pressed', String(button.dataset.tool === active));
    if (button.dataset.tool === 'browse') button.hidden = !isLiveDoc();
  }
  const stage = $('#stage');
  stage.className = `tool-${S.tool}${S.tool === 'select' ? '' : ' drawing'}`;
  $('#liveBar').hidden = !isLiveDoc();
  $('#refreshBtn').hidden = !S.doc || isLiveDoc() || S.doc.meta.kind === 'page';
}

function setColor(color) {
  S.color = color;
  for (const button of document.querySelectorAll('#colors button')) {
    button.setAttribute('aria-checked', String(button.dataset.color === color));
  }
  const a = S.selected && byId(S.selected);
  if (a && a.color !== color) commit(() => { a.color = color; renderPage(a.page); });
}

function setSize(index) {
  S.size = index;
  for (const button of document.querySelectorAll('#sizes button')) {
    button.setAttribute('aria-checked', String(Number(button.dataset.size) === index));
  }
}

function buildToolbar() {
  for (const [id, key, label, icon, word] of TOOLS) {
    const button = document.createElement('button');
    button.className = word ? 'icon worded' : 'icon';
    button.dataset.tool = id;
    button.title = `${label} (${key.toUpperCase()})`;
    button.setAttribute('aria-label', label);
    button.innerHTML = `<svg viewBox="0 0 18 18">${icon}</svg>${word ? `<span>${word}</span>` : ''}`;
    button.addEventListener('click', () => setTool(id));
    $('#tools').append(button);
  }
  COLORS.forEach(([name, value], index) => {
    const button = document.createElement('button');
    button.className = 'swatch';
    button.dataset.color = value;
    button.title = `${name} (${index + 1})`;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', name);
    button.style.setProperty('--c', value);
    button.innerHTML = '<i></i>';
    button.addEventListener('click', () => setColor(value));
    $('#colors').append(button);
  });
  SIZES.forEach((size, index) => {
    const button = document.createElement('button');
    button.className = 'size';
    button.dataset.size = index;
    button.title = ['Thin', 'Medium', 'Thick'][index];
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', button.title);
    button.innerHTML = `<i style="height:${index * 2 + 2}px"></i>`;
    button.addEventListener('click', () => setSize(index));
    $('#sizes').append(button);
  });
  $('#undoBtn').innerHTML = '<svg viewBox="0 0 18 18"><path d="M6.5 4L3 7.5 6.5 11M3 7.5h8a3.5 3.5 0 010 7H8"/></svg>';
  $('#redoBtn').innerHTML = '<svg viewBox="0 0 18 18"><path d="M11.5 4L15 7.5 11.5 11M15 7.5H7a3.5 3.5 0 000 7h3"/></svg>';
  syncTools();
  setColor(S.color);
  setSize(S.size);
  syncHistory();
}

const TOOL_KEYS = Object.fromEntries(TOOLS.map(([id, key]) => [key, id]));

function onKey(e) {
  const typing = /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement?.tagName || '');
  if (typing || !S.doc) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) restore(S.redo, S.undo); else restore(S.undo, S.redo);
  } else if ((e.ctrlKey || e.metaKey) && key === 'y') {
    e.preventDefault();
    restore(S.redo, S.undo);
  } else if (e.ctrlKey || e.metaKey || e.altKey) {
    return;
  } else if (TOOL_KEYS[key]) {
    setTool(TOOL_KEYS[key]);
  } else if (key >= '1' && key <= String(COLORS.length)) {
    setColor(COLORS[Number(key) - 1][1]);
  } else if (key === 'delete' || key === 'backspace') {
    deleteSelected();
  } else if (key === 'escape') {
    select(null);
    setTool('select');
  } else if (key === 'enter') {
    const a = byId(S.selected) || byId(S.lastMark);
    if (!a) return;
    e.preventDefault();
    setTool('select');
    select(a.id, true);
  } else if (key === '+' || key === '=') {
    setZoom(S.zoom * 1.2);
  } else if (key === '-') {
    setZoom(S.zoom / 1.2);
  } else if (key === '0') {
    S.fit = true;
    applyZoom();
  }
}

// ---------------------------------------------------------------- documents

function toast(text, ms = 0) {
  const el = $('#toast');
  clearTimeout(toast.timer);
  el.textContent = text || '';
  el.hidden = !text;
  if (text && ms) toast.timer = setTimeout(() => { el.hidden = true; }, ms);
}

function showDoc(payload) {
  leaveHome();
  S.doc = payload;
  S.rev = payload.annotations.rev || 0;
  S.paths = payload.paths;
  S.items = payload.annotations.items || [];
  S.unsent = new Set(payload.unsent || []);
  if (inBrowse()) { S.mode = 'doc'; showLiveStage(false); }
  S.selected = null;
  S.lastInk = null;
  S.undo = [];
  S.redo = [];
  S.fit = true;
  closePopover();
  $('#docName').textContent = payload.meta.title;
  $('#docName').title = payload.meta.source;
  $('#sendBtn').hidden = false;
  document.title = `${payload.meta.title} - Annotate`;
  $('#latestPath').textContent = payload.paths.latest;
  buildPages();
  syncHistory();
  syncTools();
  setStatus(`Saved, ${S.items.length} mark${S.items.length === 1 ? '' : 's'}`);
  history.replaceState(null, '', `/?doc=${encodeURIComponent(payload.meta.id)}`);
}

async function openLive(url) {
  await flush();
  leaveHome();
  $('#liveWidth').value = $('#webWidth').value;
  toast('Starting the browser');
  $('#liveBar').hidden = false;
  $('#liveStage').hidden = false;
  $('#stage').hidden = true;
  try {
    const reply = await store.liveOpen({ url, ...liveSize() });
    showDoc(reply.doc);
    live.state = reply.live;
    S.mode = 'browse';
    syncTools();
    showLiveStage(true);
    connectLive();
    toast('');
    $('#liveFrame').focus();
  } catch (err) {
    showLiveStage(false);
    syncTools();
    showHome(err.message);
  }
}

async function openWith(body, message) {
  const error = $('#openError');
  error.hidden = true;
  for (const b of [$('#openPdf'), $('#openWeb')]) b.disabled = true;
  toast(message);
  try {
    await flush();
    const payload = await store.openSource(body);
    showDoc(payload);
  } catch (err) {
    showHome(err.message);
  } finally {
    toast('');
    for (const b of [$('#openPdf'), $('#openWeb')]) b.disabled = false;
  }
}

async function uploadPdf(file) {
  if (!file) return;
  toast(`Rendering ${file.name}`);
  try {
    await flush();
    const payload = await store.uploadPdf(file);
    showDoc(payload);
    toast('');
  } catch (err) {
    toast(err.message, 5000);
  }
}

async function flush() {
  clearTimeout(S.saveTimer);
  await save();
}

function leaveHome() {
  document.body.classList.remove('at-home');
  $('#home').hidden = true;
}

async function showHome(error = '') {
  await flush();
  if (inBrowse()) leaveBrowse();
  closePopover();
  S.doc = null;
  S.items = [];
  document.body.classList.add('at-home');
  $('#home').hidden = false;
  $('#liveBar').hidden = true;
  $('#docName').textContent = '';
  $('#sendBtn').hidden = true;
  $('#sendPop').hidden = true;
  document.title = 'Annotate';
  history.replaceState(null, '', '/');
  $('#openError').textContent = error;
  $('#openError').hidden = !error;
  const [{ docs }, app] = await Promise.all([store.listDocs(), store.getApp()]);
  S.docs = docs;
  renderLibrary();
  renderExtension(app);
}

function renderExtension(app) {
  const status = $('#extStatus');
  status.textContent = app.extension ? 'Extension connected' : 'Add the extension once to use this:';
  status.dataset.state = app.extension ? 'on' : 'off';
  $('#extSteps').hidden = app.extension;
  $('#extPath').hidden = app.extension;
  $('#extFolder').textContent = app.folder;
}

function matchesFilter(doc) {
  if (S.filter === 'all') return true;
  return S.filter === 'web' ? doc.kind === 'web' || doc.kind === 'live' : doc.kind === S.filter;
}

function libraryCard(doc) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  card.title = doc.source;
  const shot = document.createElement('span');
  shot.className = 'shot';
  if (doc.thumb) {
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.src = store.pageUrl(doc.id, doc.thumb);
    shot.append(image);
  }
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = KIND_LABELS[doc.kind];
  shot.append(badge);
  const title = document.createElement('span');
  title.className = 'card-title';
  title.textContent = doc.title;
  const meta = document.createElement('span');
  meta.className = 'card-meta';
  const when = new Date(doc.updated * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  meta.textContent = `${doc.notes} mark${doc.notes === 1 ? '' : 's'} · ${when}`;
  card.append(shot, title, meta);
  card.addEventListener('click', () => loadDoc(doc.id));
  return card;
}

function renderLibrary() {
  const query = $('#libSearch').value.trim().toLowerCase();
  const docs = S.docs.filter((doc) => matchesFilter(doc) && doc.title.toLowerCase().includes(query));
  const host = $('#library');
  if (!docs.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = S.docs.length ? 'Nothing matches that.' : 'Everything you mark up is kept here.';
    host.replaceChildren(empty);
    return;
  }
  host.replaceChildren(...docs.map(libraryCard));
}

function buildFilters() {
  const host = $('#libFilters');
  for (const [id, label] of FILTERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.filter = id;
    button.setAttribute('aria-pressed', String(id === S.filter));
    button.addEventListener('click', () => {
      S.filter = id;
      for (const other of host.children) other.setAttribute('aria-pressed', String(other === button));
      renderLibrary();
    });
    host.append(button);
  }
}

function buildTags() {
  for (const tag of TAGS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = tag;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      const a = byId(S.selected);
      if (!a) return;
      a.tag = a.tag === tag ? undefined : tag;
      syncPopTags(a);
      renderSide();
      touch();
    });
    $('#popTags').append(button);
  }
}

// Marks can arrive from the extension while a document is open here.
async function syncDoc() {
  if (!S.doc || S.dirty || S.editing || S.action || inBrowse() || document.hidden) return;
  try {
    const { rev, pages } = await store.getRevision(S.doc.meta.id);
    if (!S.doc || S.dirty || (rev === S.rev && pages === S.doc.meta.pages.length)) return;
    const top = $('#stage').scrollTop;
    showDoc(await store.getDoc(S.doc.meta.id));
    $('#stage').scrollTop = top;
  } catch { /* the next tick tries again */ }
}

async function loadDoc(id) {
  await flush();
  showDoc(await store.getDoc(id));
}

async function refreshDoc() {
  if (!S.doc) return;
  toast(S.doc.meta.kind === 'pdf' ? 'Rendering the PDF again' : 'Capturing the site again');
  try {
    await flush();
    const payload = await store.refreshDoc(S.doc.meta.id);
    const top = $('#stage').scrollTop;
    showDoc(payload);
    $('#stage').scrollTop = top;
    toast('Updated. Your marks stayed where they were.', 3000);
  } catch (err) {
    toast(err.message, 5000);
  }
}

function bindUi() {
  $('#homeBtn').addEventListener('click', () => showHome());
  $('#libSearch').addEventListener('input', renderLibrary);
  $('#extCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#extFolder').textContent);
      toast('Copied', 2000);
    } catch {
      toast('The browser blocked copying. Select the path instead.', 4000);
    }
  });
  $('#openPdf').addEventListener('click', () => {
    const path = $('#pdfPath').value.trim();
    if (path) openWith({ pdf: path }, 'Rendering pages');
  });
  $('#openLive').addEventListener('click', () => {
    const url = $('#webUrl').value.trim();
    if (url) openLive(url);
  });
  $('#openWeb').addEventListener('click', () => {
    const url = $('#webUrl').value.trim();
    if (!url) return;
    const clicks = $('#webClicks').value.split(',');
    openWith({ url, clicks, width: Number($('#webWidth').value), wait: Number($('#webWait').value) }, 'Capturing the site, this takes a few seconds');
  });
  $('#pdfPath').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#openPdf').click(); } });
  $('#webUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#openLive').click(); } });
  $('#pdfFile').addEventListener('change', (e) => uploadPdf(e.target.files[0]));
  $('#undoBtn').addEventListener('click', () => restore(S.undo, S.redo));
  $('#redoBtn').addEventListener('click', () => restore(S.redo, S.undo));
  $('#zoomIn').addEventListener('click', () => setZoom(S.zoom * 1.2));
  $('#zoomOut').addEventListener('click', () => setZoom(S.zoom / 1.2));
  $('#zoomFit').addEventListener('click', () => { S.fit = true; applyZoom(); });
  $('#refreshBtn').addEventListener('click', refreshDoc);
  $('#sideBtn').addEventListener('click', () => {
    const side = $('#side');
    side.hidden = !side.hidden;
    applyZoom();
  });
  const popText = $('#popText');
  popText.addEventListener('focus', () => { S.editBefore = S.editBefore || snapshot(); });
  popText.addEventListener('input', () => {
    const a = byId(S.selected);
    if (!a) return;
    a.text = popText.value;
    renderSide();
    touch();
  });
  popText.addEventListener('blur', () => {
    if (S.editBefore && S.editBefore !== snapshot()) pushUndo(S.editBefore);
    S.editBefore = null;
  });
  popText.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      select(null);
    }
  });
  $('#pop').addEventListener('pointerdown', (e) => e.stopPropagation());
  $('#popDelete').addEventListener('click', deleteSelected);
  $('#popDone').addEventListener('click', () => select(null));
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => applyZoom());
  window.addEventListener('pagehide', () => {
    if (S.doc && S.dirty) {
      store.saveMarksOnExit(S.doc.meta.id, S.items);
    }
  });
  $('#stage').addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !S.doc) return;
    e.preventDefault();
    setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.toggle('dragging', e.dataTransfer.types.includes('Files'));
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('dragging');
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) uploadPdf(file);
    else toast(`${file.name} isn't a PDF. Drop a PDF to open it.`, 5000);
  });
}

async function start() {
  buildToolbar();
  buildFilters();
  buildTags();
  bindUi();
  bindLive();
  bindSend();
  $('#side').hidden = innerWidth < 900;
  renderSide();
  const params = new URLSearchParams(location.search);
  if (params.get('pdf')) return openWith({ pdf: params.get('pdf') }, 'Rendering pages');
  if (params.get('live')) return openLive(params.get('live'));
  if (params.get('url')) {
    const clicks = (params.get('click') || '').split(',');
    return openWith({ url: params.get('url'), clicks, width: Number(params.get('width')) || 1440 }, 'Capturing the site');
  }
  setInterval(syncDoc, SYNC_MS);
  const id = params.get('doc');
  if (id) {
    try { return await loadDoc(id); } catch { /* document was removed */ }
  }
  showHome();
}
