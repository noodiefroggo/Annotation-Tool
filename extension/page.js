'use strict';

// Runs in the page's own world, the only place React's internals are visible. Given an element,
// it finds the component and, on a dev server, the source file and line. Nothing here is a stable
// React API, so every step fails quietly and the mark falls back to its selector.
(() => {
  if (window.__annotatePage) return;
  window.__annotatePage = true;

  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const MAX_OWNERS = 12;
  const CODE_ROOTS = /\/(?:src|app|components|pages|lib|features|views)\//;
  const maps = new Map();

  function decodeSegment(segment) {
    const out = [];
    let value = 0;
    let shift = 0;
    for (const char of segment) {
      const digit = BASE64.indexOf(char);
      value += (digit & 31) << shift;
      if (digit & 32) {
        shift += 5;
      } else {
        out.push(value & 1 ? -(value >> 1) : value >> 1);
        value = 0;
        shift = 0;
      }
    }
    return out;
  }

  function lookup(map, line, column) {
    if (map.sections) {
      let section = null;
      for (const entry of map.sections) {
        const { offset } = entry;
        if (offset.line < line || (offset.line === line && offset.column <= column)) section = entry;
        else break;
      }
      if (!section) return null;
      const localLine = line - section.offset.line;
      return lookup(section.map, localLine, localLine === 0 ? column - section.offset.column : column);
    }
    const lines = map.mappings.split(';');
    let source = 0;
    let sourceLine = 0;
    let best = null;
    for (let i = 0; i <= line && i < lines.length; i++) {
      let generated = 0;
      for (const segment of lines[i].split(',').filter(Boolean)) {
        const fields = decodeSegment(segment);
        generated += fields[0];
        if (fields.length >= 4) {
          source += fields[1];
          sourceLine += fields[2];
          if (i === line && generated <= column) best = { file: map.sources[source], line: sourceLine + 1 };
        }
      }
    }
    return best;
  }

  async function mapFor(url) {
    if (!maps.has(url)) {
      maps.set(url, (async () => {
        const script = await (await fetch(url)).text();
        const found = script.match(/sourceMappingURL=(\S+)\s*$/m);
        if (!found) return null;
        const res = await fetch(new URL(decodeURIComponent(found[1]), url));
        return res.ok ? res.json() : null;
      })().catch(() => null));
    }
    return maps.get(url);
  }

  function cleanPath(file) {
    const decoded = decodeURIComponent(file).replace(/\\/g, '/');
    const root = decoded.search(CODE_ROOTS);
    return root >= 0 ? decoded.slice(root + 1) : decoded.replace(/^(?:file:\/+|webpack:\/+[^/]*\/+)/, '');
  }

  function frames(fiber) {
    const stack = fiber._debugStack?.stack || '';
    const found = [];
    for (const line of stack.split('\n')) {
      const match = line.match(/\(?(https?:[^()\s]+):(\d+):(\d+)\)?\s*$/);
      if (match && !/node_modules|turbopack-/.test(match[1])) {
        found.push({ url: match[1], line: Number(match[2]) - 1, column: Number(match[3]) - 1 });
      }
    }
    return found;
  }

  async function sourceOf(fiber) {
    if (fiber._debugSource?.fileName) {
      return `${cleanPath(fiber._debugSource.fileName)}:${fiber._debugSource.lineNumber}`;
    }
    for (const frame of frames(fiber)) {
      const map = await mapFor(frame.url);
      const hit = map && lookup(map, frame.line, frame.column);
      if (hit?.file && !hit.file.includes('node_modules')) return `${cleanPath(hit.file)}:${hit.line}`;
    }
    return null;
  }

  const fiberOf = (el) => {
    const key = Object.keys(el).find((name) => name.startsWith('__reactFiber$'));
    return key ? el[key] : null;
  };

  const nameOf = (fiber) => {
    const { type } = fiber;
    return typeof type === 'function' ? type.displayName || type.name : type?.displayName || type?.render?.name;
  };

  async function inspect(el) {
    let fiber = fiberOf(el);
    const names = [];
    let source = null;
    for (let i = 0; fiber && i < MAX_OWNERS; i++) {
      const name = nameOf(fiber);
      if (name && /^[A-Z]/.test(name) && !names.includes(name)) names.push(name);
      if (!source) source = await sourceOf(fiber).catch(() => null);
      fiber = fiber._debugOwner;
    }
    return { component: names.slice(0, 4).reverse().join(' > '), source };
  }

  document.addEventListener('annotate-inspect', async (event) => {
    const { id } = JSON.parse(event.detail);
    const el = document.querySelector(`[data-annotate-probe="${id}"]`);
    const found = el ? await inspect(el).catch(() => ({})) : {};
    document.dispatchEvent(new CustomEvent('annotate-inspected', { detail: JSON.stringify({ id, ...found }) }));
  });
})();
