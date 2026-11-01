'use strict';

// The overlay. It sits in a closed shadow root so a site's CSS cannot reach it, and marks live in
// page coordinates so they stay on their elements while you scroll. Sending happens in the popup,
// outside the page, so a page cannot send feedback by pretending to be this overlay.
(() => {
  if (window.__annotateOverlay) return;
  window.__annotateOverlay = true;

  const NS = 'http://www.w3.org/2000/svg';
  const PALETTE = [
    ['Red', '#e5484d'], ['Orange', '#f76b15'], ['Yellow', '#f5b700'], ['Green', '#30a46c'],
    ['Blue', '#0090ff'], ['Purple', '#8e4ec6'], ['Black', '#1c2024'],
  ];
  const COLORS = PALETTE.map(([, color]) => color);
  const LIGHT = ['#f76b15', '#f5b700'];
  const TAGS = ['Bug', 'Feature', 'Enhancement'];
  const PIN = 14;
  const STROKE = 3.5;
  const HIGHLIGHT = 21;
  const DRAG_KINDS = ['arrow', 'rect', 'ellipse'];
  const INK_KINDS = ['pen', 'highlight'];
  const INK_MERGE_MS = 1500;
  const INK_MERGE_GAP = 170;
  const SAMPLES = 5;
  const TOOLS = [
    ['browse', 'Browse', 'Use the page normally (Esc)'],
    ['pick', 'Comment', 'Click any element to comment on it'],
    ['pen', 'Pen', 'Draw freehand'],
    ['highlight', 'Highlight', 'Highlight an area'],
    ['arrow', 'Arrow', 'Draw an arrow'],
    ['ellipse', 'Circle', 'Circle something'],
    ['rect', 'Box', 'Draw a box'],
  ];

  const S = {
    active: false, tool: 'pick', color: COLORS[0], doc: null, marks: [], views: new Map(),
    hover: null, draft: null, editing: null, elements: new Map(), lastInk: null, noteTimer: null,
  };

  const send = async (message) => {
    const reply = await chrome.runtime.sendMessage(message);
    if (!reply?.ok) throw new Error(reply?.error || 'Annotate is not responding');
    return reply.result;
  };
  const makeId = () => Math.random().toString(36).slice(2, 10);
  const round = (v) => Math.round(v * 10) / 10;
  const pageUrl = () => location.href.split('#')[0];

  let host = null;
  let root = null;
  const ui = {};

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font: 13px/1.4 system-ui, "Segoe UI", sans-serif; }
    .layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
    .scroll { position: absolute; left: 0; top: 0; }
    svg { position: absolute; left: 0; top: 0; overflow: visible; }
    .catcher { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; touch-action: none; }
    .catcher[hidden] { display: none; }
    .hover { position: fixed; border: 2px solid #0090ff; background: rgb(0 144 255 / .1); border-radius: 3px; pointer-events: none; }
    .hover[hidden] { display: none; }
    .label { position: absolute; left: -2px; bottom: 100%; margin-bottom: 4px; max-width: 320px; padding: 2px 6px; border-radius: 4px; background: #0090ff; color: #fff; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pin { cursor: pointer; pointer-events: auto; }
    .pin text { font-size: 12px; font-weight: 600; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
    .bar { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); width: max-content; display: flex; align-items: center; gap: 4px; padding: 6px; background: #18181b; color: #ececef; border: 1px solid #34343a; border-radius: 10px; box-shadow: 0 8px 28px rgb(0 0 0 / .4); pointer-events: auto; max-width: calc(100vw - 24px); flex-wrap: wrap; justify-content: center; }
    button { border: 0; background: none; color: inherit; cursor: pointer; border-radius: 6px; }
    button:focus-visible, textarea:focus-visible { outline: 2px solid #5b9dff; outline-offset: 1px; }
    .tool { height: 30px; padding: 0 9px; color: #a1a1aa; }
    .tool:hover { background: #2b2b30; color: #ececef; }
    .tool[aria-pressed="true"] { background: #ececef; color: #18181b; }
    .sep { width: 1px; height: 20px; margin: 0 3px; background: #34343a; }
    .swatch { width: 24px; height: 30px; display: grid; place-items: center; }
    .swatch i { width: 14px; height: 14px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgb(255 255 255 / .35); }
    .swatch[aria-checked="true"] i { box-shadow: 0 0 0 2px #18181b, 0 0 0 4px #ececef; }
    .count { padding: 0 8px; color: #a1a1aa; white-space: nowrap; }
    .card { position: fixed; width: 300px; padding: 10px; background: #18181b; color: #ececef; border: 1px solid #34343a; border-radius: 10px; box-shadow: 0 8px 28px rgb(0 0 0 / .45); pointer-events: auto; }
    .card[hidden] { display: none; }
    .target { margin-bottom: 8px; color: #a1a1aa; font-size: 12px; overflow-wrap: anywhere; }
    .target b { display: block; color: #ececef; font-weight: 500; }
    .tags { display: flex; gap: 4px; margin-bottom: 8px; }
    .tag { height: 26px; padding: 0 9px; border: 1px solid #34343a; color: #a1a1aa; }
    .tag[aria-pressed="true"] { background: #ececef; border-color: #ececef; color: #18181b; }
    textarea { display: block; width: 100%; min-height: 72px; resize: vertical; padding: 6px 8px; color: #ececef; background: #1f1f23; border: 1px solid #34343a; border-radius: 6px; }
    .row { display: flex; align-items: center; gap: 4px; margin-top: 8px; }
    .spacer { flex: 1; }
    .act { height: 28px; padding: 0 10px; color: #a1a1aa; }
    .act:hover { background: #2b2b30; color: #ececef; }
    .primary { background: #e5484d; color: #fff; }
    .primary:hover { background: #d13b40; color: #fff; }
    .danger:hover { color: #ff8589; }
    .notice { position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); padding: 6px 10px; border-radius: 8px; background: #18181b; color: #ececef; border: 1px solid #34343a; max-width: 80vw; }
    .notice[hidden] { display: none; }
  `;

  function make(tag, className, parent) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (parent) parent.append(el);
    return el;
  }

  function build() {
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];

    const layer = make('div', 'layer', root);
    ui.scroll = make('div', 'scroll', layer);
    ui.svg = document.createElementNS(NS, 'svg');
    ui.svg.setAttribute('width', 1);
    ui.svg.setAttribute('height', 1);
    ui.scroll.append(ui.svg);

    ui.catcher = make('div', 'catcher', root);
    ui.hover = make('div', 'hover', root);
    ui.hover.hidden = true;
    ui.label = make('div', 'label', ui.hover);

    ui.bar = make('div', 'bar', root);
    ui.tools = {};
    for (const [id, label, title] of TOOLS) {
      const button = make('button', 'tool', ui.bar);
      button.textContent = label;
      button.title = title;
      button.addEventListener('click', () => setTool(id));
      ui.tools[id] = button;
    }
    make('span', 'sep', ui.bar);
    ui.swatches = PALETTE.map(([name, color]) => {
      const button = make('button', 'swatch', ui.bar);
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-label', name);
      button.title = name;
      button.style.setProperty('--c', color);
      make('i', '', button);
      button.addEventListener('click', () => { S.color = color; syncBar(); });
      return button;
    });
    make('span', 'sep', ui.bar);
    ui.count = make('span', 'count', ui.bar);
    const close = make('button', 'tool', ui.bar);
    close.textContent = 'Close';
    close.title = 'Turn annotation off on this page';
    close.addEventListener('click', () => send({ type: 'close' }).catch(() => setActive(false)));

    ui.card = make('div', 'card', root);
    ui.card.hidden = true;
    ui.target = make('div', 'target', ui.card);
    ui.tags = make('div', 'tags', ui.card);
    ui.tagButtons = TAGS.map((tag) => {
      const button = make('button', 'tag', ui.tags);
      button.textContent = tag;
      button.addEventListener('click', () => {
        S.editing.tag = S.editing.tag === tag ? null : tag;
        syncTags();
      });
      return button;
    });
    ui.text = make('textarea', '', ui.card);
    ui.text.placeholder = 'What should change?';
    const row = make('div', 'row', ui.card);
    ui.remove = make('button', 'act danger', row);
    ui.remove.textContent = 'Delete';
    make('span', 'spacer', row);
    const cancel = make('button', 'act', row);
    cancel.textContent = 'Cancel';
    ui.save = make('button', 'act primary', row);
    ui.save.textContent = 'Save';
    ui.notice = make('div', 'notice', root);
    ui.notice.hidden = true;

    cancel.addEventListener('click', closeCard);
    ui.save.addEventListener('click', saveCard);
    ui.remove.addEventListener('click', removeCard);
    ui.text.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveCard(); }
      if (e.key === 'Escape') { e.preventDefault(); closeCard(); }
    });
    ui.catcher.addEventListener('pointermove', onMove);
    ui.catcher.addEventListener('pointerdown', onDown);
    ui.catcher.addEventListener('pointerup', onUp);
    ui.catcher.addEventListener('pointerleave', () => { ui.hover.hidden = true; });
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('keydown', (e) => {
      if (S.active && e.key === 'Escape' && ui.card.hidden) setTool('browse');
    });
    document.documentElement.append(host);
  }

  function notice(text) {
    ui.notice.textContent = text;
    ui.notice.hidden = !text;
    clearTimeout(notice.timer);
    if (text) notice.timer = setTimeout(() => { ui.notice.hidden = true; }, 5000);
  }

  function setTool(tool) {
    S.tool = tool;
    stopNoteTimer();
    S.lastInk = null;
    closeCard();
    ui.hover.hidden = true;
    ui.catcher.hidden = tool === 'browse';
    syncBar();
  }

  function syncBar() {
    for (const [id, button] of Object.entries(ui.tools)) button.setAttribute('aria-pressed', id === S.tool);
    ui.swatches.forEach((button, i) => button.setAttribute('aria-checked', COLORS[i] === S.color));
    ui.count.textContent = `${S.marks.length} mark${S.marks.length === 1 ? '' : 's'}`;
  }

  function syncTags() {
    ui.tagButtons.forEach((button, i) => button.setAttribute('aria-pressed', S.editing?.tag === TAGS[i]));
  }

  // ---------------------------------------------------------------- elements

  function underPointer(e) {
    return document.elementsFromPoint(e.clientX, e.clientY).find((el) => el !== host) || null;
  }

  function topElement(x, y) {
    const skip = [host, document.documentElement, document.body];
    return document.elementsFromPoint(x, y).find((el) => !skip.includes(el)) || null;
  }

  // Samples the whole area, because the middle of a circle is often empty.
  function elementUnder(points) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const counts = new Map();
    for (let i = 0; i < SAMPLES; i++) {
      for (let j = 0; j < SAMPLES; j++) {
        const x = x0 + ((x1 - x0) * i) / (SAMPLES - 1);
        const y = y0 + ((y1 - y0) * j) / (SAMPLES - 1);
        const el = topElement(x, y);
        if (el) counts.set(el, (counts.get(el) || 0) + 1);
      }
    }
    const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([el]) => el);
    return ranked.find((el) => describe(el).text) || ranked[0] || null;
  }

  function endOf(point) {
    const el = topElement(point[0], point[1]);
    if (!el) return null;
    const info = describe(el);
    return { selector: cssPath(el), text: info.text, label: info.label };
  }

  // What a drawn mark is on, so the note says it without anyone opening the image.
  async function targetOf(kind, points) {
    const ends = kind === 'arrow' ? { from: endOf(points[0]), to: endOf(points.at(-1)) } : undefined;
    const el = kind === 'arrow'
      ? topElement(...points.at(-1)) || topElement(...points[0])
      : elementUnder(points);
    if (!el) return ends ? { ends } : undefined;
    const [info, code] = [describe(el), await inspect(el)];
    return {
      selector: cssPath(el), text: info.text, label: info.label,
      component: code.component || undefined, source: code.source || undefined, ends,
    };
  }

  function cssPath(el) {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && parts.length < 5; node = node.parentElement) {
      const tag = node.localName;
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
        parts.unshift(`${tag}#${node.id}`);
        break;
      }
      const test = node.getAttribute('data-testid');
      if (test) {
        parts.unshift(`${tag}[data-testid="${test}"]`);
        break;
      }
      const same = node.parentElement ? [...node.parentElement.children].filter((c) => c.localName === tag) : [];
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
    }
    return parts.join(' > ');
  }

  function describe(el) {
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '').trim().replace(/\s+/g, ' ');
    return { text: text.slice(0, 200), label: `${el.localName}${text ? ` "${text.slice(0, 60)}"` : ''}` };
  }

  function inspect(el) {
    return new Promise((resolve) => {
      const id = makeId();
      const finish = (found) => {
        clearTimeout(timer);
        document.removeEventListener('annotate-inspected', listener);
        el.removeAttribute('data-annotate-probe');
        resolve(found);
      };
      const listener = (event) => {
        const found = JSON.parse(event.detail);
        if (found.id === id) finish(found);
      };
      const timer = setTimeout(() => finish({}), 2500);
      document.addEventListener('annotate-inspected', listener);
      el.setAttribute('data-annotate-probe', id);
      document.dispatchEvent(new CustomEvent('annotate-inspect', { detail: JSON.stringify({ id }) }));
    });
  }

  // ---------------------------------------------------------------- screenshots

  const nextFrame = () => new Promise((done) => { requestAnimationFrame(() => requestAnimationFrame(done)); });

  async function viewForNow() {
    const key = [pageUrl(), scrollX, scrollY, innerWidth, innerHeight].join('|');
    if (S.views.has(key)) return S.views.get(key);
    // The overlay is hidden for the shot, because the tool draws the marks itself.
    host.style.visibility = 'hidden';
    await nextFrame();
    try {
      const view = await send({
        type: 'capture',
        view: {
          url: pageUrl(), title: document.title, dpr: devicePixelRatio, scroll: [Math.round(scrollX), Math.round(scrollY)],
        },
      });
      S.doc = view.doc;
      S.views.set(key, { ...view, scroll: [Math.round(scrollX), Math.round(scrollY)] });
      return S.views.get(key);
    } finally {
      host.style.visibility = '';
    }
  }

  // ---------------------------------------------------------------- pointer

  function onMove(e) {
    if (S.draft) {
      const point = [round(e.clientX), round(e.clientY)];
      if (DRAG_KINDS.includes(S.draft.kind)) S.draft.points[1] = point;
      else S.draft.points.push(point);
      drawDraft();
      return;
    }
    if (S.tool !== 'pick' || !ui.card.hidden) return;
    const el = underPointer(e);
    S.hover = el;
    if (!el) { ui.hover.hidden = true; return; }
    const r = el.getBoundingClientRect();
    Object.assign(ui.hover.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    ui.label.textContent = el.localName + (el.id ? `#${el.id}` : '');
    ui.label.style.top = r.top < 26 ? '100%' : '';
    ui.hover.hidden = false;
  }

  function onDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    stopNoteTimer();
    closeCard();
    if (S.tool === 'pick') { pick(e); return; }
    const point = [round(e.clientX), round(e.clientY)];
    S.draft = { kind: S.tool, points: DRAG_KINDS.includes(S.tool) ? [point, point] : [point] };
    ui.catcher.setPointerCapture(e.pointerId);
  }

  function stopNoteTimer() {
    clearTimeout(S.noteTimer);
    S.noteTimer = null;
  }

  function gapTo(mark, point) {
    return Math.min(...mark.doc.flat().map(([x, y]) => Math.hypot(x - point[0] - scrollX, y - point[1] - scrollY)));
  }

  // Quick strokes close together are one thought, as in the site.
  function inkToJoin(kind, points, view) {
    const last = S.lastInk;
    if (!last || last.mark.kind !== kind || last.mark.color !== S.color || last.page !== view.page) return null;
    if (Date.now() - last.at > INK_MERGE_MS) return null;
    return gapTo(last.mark, points[0]) <= INK_MERGE_GAP ? last.mark : null;
  }

  function askForNote(mark) {
    stopNoteTimer();
    S.noteTimer = setTimeout(() => {
      if (!S.draft && ui.card.hidden) openCard(mark, null);
    }, INK_MERGE_MS);
  }

  async function onUp(e) {
    const draft = S.draft;
    if (!draft) return;
    S.draft = null;
    ui.catcher.releasePointerCapture(e.pointerId);
    ui.draftShape?.remove();
    ui.draftShape = null;
    const [a, b] = [draft.points[0], draft.points.at(-1)];
    const span = Math.max(...draft.points.map((p) => Math.hypot(p[0] - a[0], p[1] - a[1])));
    if (span < 6 || (DRAG_KINDS.includes(draft.kind) && Math.hypot(a[0] - b[0], a[1] - b[1]) < 6)) return;
    try {
      const [view, target] = await Promise.all([viewForNow(), targetOf(draft.kind, draft.points)]);
      const isInk = INK_KINDS.includes(draft.kind);
      const joined = isInk ? inkToJoin(draft.kind, draft.points, view) : null;
      if (joined) {
        joined.strokes = [...joined.strokes, draft.points];
        joined.doc = placed(joined, joined.scroll).doc;
        render();
        S.lastInk.at = Date.now();
        await saveMark(joined);
        askForNote(joined);
        return;
      }
      const item = {
        id: makeId(), kind: draft.kind, color: S.color, page: view.page, strokes: [draft.points], text: '',
        width: draft.kind === 'highlight' ? HIGHLIGHT : STROKE, created: Date.now(), target,
      };
      const mark = placed(item, view.scroll);
      S.marks.push(mark);
      render();
      await saveMark(mark);
      if (isInk) {
        S.lastInk = { mark, at: Date.now(), page: view.page };
        askForNote(mark);
      } else {
        S.lastInk = null;
        openCard(mark, null);
      }
    } catch (error) {
      notice(error.message);
    }
  }

  async function pick(e) {
    const el = underPointer(e);
    if (!el) return;
    ui.hover.hidden = true;
    const r = el.getBoundingClientRect();
    const point = [round(e.clientX), round(e.clientY)];
    try {
      const [view, code] = await Promise.all([viewForNow(), inspect(el)]);
      const info = describe(el);
      const item = {
        id: makeId(), kind: 'comment', color: S.color, page: view.page, strokes: [[point]], size: PIN, width: 2, text: '',
        created: Date.now(),
        target: {
          selector: cssPath(el), text: info.text, label: info.label, rect: [round(r.left), round(r.top), round(r.width), round(r.height)],
          component: code.component || undefined, source: code.source || undefined,
        },
      };
      S.elements.set(item.id, { el, dx: point[0] - r.left, dy: point[1] - r.top });
      openCard(placed(item, view.scroll), info.label, true);
    } catch (error) {
      notice(error.message);
    }
  }

  // Marks are kept in page coordinates here and in view coordinates on the server.
  function placed(item, scroll) {
    return { ...item, scroll, doc: item.strokes.map((s) => s.map(([x, y]) => [x + scroll[0], y + scroll[1]])) };
  }

  function stored(mark) {
    const { scroll, doc, isNew, saved, ...item } = mark;
    return item;
  }

  // ---------------------------------------------------------------- comment card

  function openCard(mark, label, isNew = false) {
    const live = S.marks.find((m) => m.id === mark.id);
    S.editing = live || { ...mark, isNew };
    const rect = screenBox(S.editing);
    ui.target.replaceChildren();
    const target = S.editing.target;
    if (target || label) {
      const title = make('b', '', ui.target);
      title.textContent = label || target.label;
      if (target?.source || target?.component) {
        ui.target.append(target.source || target.component);
      }
    }
    ui.target.hidden = !ui.target.childNodes.length;
    syncTags();
    ui.text.value = S.editing.text || '';
    ui.remove.hidden = Boolean(S.editing.isNew);
    ui.card.hidden = false;
    placeCard(S.elements.get(S.editing.id)?.el?.getBoundingClientRect() ?? { left: rect.x1, right: rect.x1, top: rect.y0 });
    ui.text.focus();
  }

  // Beside the element when there is room, so the card never hides what it's about.
  function placeCard(box) {
    const width = ui.card.offsetWidth;
    const height = ui.card.offsetHeight;
    const gap = 12;
    let left = box.right + gap;
    if (left + width > innerWidth - gap) left = box.left - width - gap;
    if (left < gap) left = Math.min(Math.max(box.left, gap), innerWidth - width - gap);
    const top = Math.min(Math.max(box.top, gap), innerHeight - height - 84);
    Object.assign(ui.card.style, { left: `${left}px`, top: `${Math.max(top, gap)}px` });
  }

  function closeCard() {
    const mark = S.editing;
    S.editing = null;
    if (ui.card) ui.card.hidden = true;
    // A drawn shape stays without a note. Only a brand new comment is dropped on cancel.
    if (mark && !mark.isNew && !mark.saved) saveMark(mark);
  }

  async function saveMark(mark) {
    try {
      const reply = await send({ type: 'mark', doc: S.doc, item: stored(mark) });
      mark.n = reply.item.n;
      mark.saved = true;
      render();
    } catch (error) {
      notice(error.message);
    }
  }

  async function saveCard() {
    const mark = S.editing;
    if (!mark) return;
    mark.text = ui.text.value.trim();
    if (mark.kind === 'comment' && !mark.text) { ui.text.focus(); return; }
    delete mark.isNew;
    if (!S.marks.includes(mark)) S.marks.push(mark);
    S.editing = null;
    ui.card.hidden = true;
    render();
    await saveMark(mark);
  }

  async function removeCard() {
    const mark = S.editing;
    if (!mark) return;
    S.editing = null;
    ui.card.hidden = true;
    S.marks = S.marks.filter((m) => m !== mark);
    render();
    try {
      await send({ type: 'remove', doc: S.doc, id: mark.id });
    } catch (error) {
      notice(error.message);
    }
  }

  // ---------------------------------------------------------------- drawing

  function svg(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  }

  function shapeFor(kind, points, color, width) {
    const [a, b] = [points[0], points.at(-1)];
    const common = { stroke: color, 'stroke-width': width, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    if (kind === 'rect') {
      return svg('rect', { ...common, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) });
    }
    if (kind === 'ellipse') {
      return svg('ellipse', { ...common, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, rx: Math.abs(a[0] - b[0]) / 2, ry: Math.abs(a[1] - b[1]) / 2 });
    }
    if (kind === 'arrow') {
      const group = svg('g', {});
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const head = width * 4;
      const wing = (turn) => [b[0] - head * Math.cos(angle + turn), b[1] - head * Math.sin(angle + turn)];
      group.append(
        svg('path', { ...common, d: `M${a}L${b}` }),
        svg('path', { ...common, d: `M${wing(0.45)}L${b}L${wing(-0.45)}` }),
      );
      return group;
    }
    const d = `M${points.map((p) => p.join(' ')).join('L')}`;
    return svg('path', { ...common, d, ...(kind === 'highlight' ? { opacity: 0.35 } : {}) });
  }

  function drawDraft() {
    const { kind, points } = S.draft;
    ui.draftShape?.remove();
    ui.draftShape = shapeFor(kind, points.map(([x, y]) => [x + scrollX, y + scrollY]), S.color, kind === 'highlight' ? HIGHLIGHT : STROKE);
    ui.svg.append(ui.draftShape);
  }

  function pinPoint(mark) {
    const anchor = S.elements.get(mark.id);
    if (anchor?.el.isConnected) {
      const r = anchor.el.getBoundingClientRect();
      if (r.width || r.height) return [r.left + anchor.dx + scrollX, r.top + anchor.dy + scrollY];
    }
    return mark.doc[0][0];
  }

  function screenBox(mark) {
    const points = mark.kind === 'comment' ? [pinPoint(mark)] : mark.doc.flat();
    const xs = points.map((p) => p[0] - scrollX);
    const ys = points.map((p) => p[1] - scrollY);
    return { x1: Math.max(...xs) + (mark.kind === 'comment' ? PIN * 2.4 : 0), y0: Math.min(...ys) };
  }

  function drawPin(mark) {
    const [x, y] = pinPoint(mark);
    const r = PIN;
    const top = y - r * 2.8;
    const c = r * 0.6;
    const group = svg('g', { class: 'pin' });
    group.append(
      svg('path', {
        fill: mark.color,
        stroke: '#fff',
        'stroke-width': 1.5,
        d: `M${x + c} ${top}H${x + r * 2.4 - c}a${c} ${c} 0 0 1 ${c} ${c}V${top + r * 2 - c}a${c} ${c} 0 0 1 ${-c} ${c}H${x + r * 1.1}L${x} ${y}L${x + r * 0.3} ${top + r * 2}H${x + c}a${c} ${c} 0 0 1 ${-c} ${-c}V${top + c}a${c} ${c} 0 0 1 ${c} ${-c}Z`,
      }),
    );
    const label = svg('text', { x: x + r * 1.2, y: top + r, fill: LIGHT.includes(mark.color) ? '#1c2024' : '#fff' });
    label.textContent = mark.n ?? '';
    group.append(label);
    group.addEventListener('click', () => openCard(mark, null));
    return group;
  }

  function render() {
    ui.svg.replaceChildren();
    for (const mark of S.marks) {
      if (mark.kind === 'comment') ui.svg.append(drawPin(mark));
      else {
        for (const stroke of mark.doc) {
          const shape = shapeFor(mark.kind, stroke, mark.color, mark.width);
          shape.style.pointerEvents = 'stroke';
          shape.style.cursor = 'pointer';
          shape.addEventListener('click', () => openCard(mark, null));
          ui.svg.append(shape);
        }
      }
    }
    place();
    syncBar();
  }

  let queued = false;
  function schedule() {
    if (queued || !S.active) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (S.elements.size) render();
      else place();
    });
  }

  function place() {
    ui.scroll.style.transform = `translate(${-scrollX}px, ${-scrollY}px)`;
  }

  // ---------------------------------------------------------------- start and stop

  async function loadMarks() {
    try {
      const state = await send({ type: 'state', url: pageUrl() });
      S.doc = state.doc;
      S.marks = state.items.map((item) => ({ ...placed(item, item.scroll), saved: true }));
      for (const mark of S.marks) {
        const selector = mark.target?.selector;
        const el = selector ? document.querySelector(selector) : null;
        if (el) {
          const r = el.getBoundingClientRect();
          const [x, y] = mark.doc[0][0];
          S.elements.set(mark.id, { el, dx: x - scrollX - r.left, dy: y - scrollY - r.top });
        }
      }
      render();
    } catch {
      notice('Annotate is not running at localhost:3190');
    }
  }

  function setActive(active) {
    S.active = active;
    if (active) {
      if (!host) build();
      host.style.display = '';
      setTool(S.tool);
      loadMarks();
    } else if (host) {
      closeCard();
      host.style.display = 'none';
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === 'toggle') {
      setActive(message.active);
      reply({ ok: true });
    }
    if (message.type === 'status') reply({ active: S.active, marks: S.marks.length });
  });

  chrome.runtime.sendMessage({ type: 'hello' }, (reply) => {
    if (reply?.result?.active) setActive(true);
  });
})();
