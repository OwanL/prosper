import Split from 'split.js';

const KEY = 'prosper.panel-layout.v1';
const valid = (sizes, count) => Array.isArray(sizes) && sizes.length === count
  && sizes.every(n => Number.isFinite(n) && n > 0 && n < 100)
  && Math.abs(sizes.reduce((a, b) => a + b, 0) - 100) < .1;

export function setupLayout() {
  const dashboard = document.querySelector('#dashboard');
  const workspace = document.querySelector('#workspace');
  let saved = {};
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
  } catch { /* Storage is optional. */ }
  const width = workspace.clientWidth;
  const height = dashboard.clientHeight;
  const feed = Math.min(290, Math.max(210, innerHeight * .26));
  const columns = [(216 + 5) / width * 100, 100 - (216 + 308 + 10) / width * 100, (308 + 5) / width * 100];
  const rows = [100 - (feed + 5) / height * 100, (feed + 5) / height * 100];
  const store = (key, sizes) => {
    saved[key] = sizes;
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* Resize still works. */ }
  };
  const create = (ids, key, direction, defaults, minSize) => {
    let split;
    const gutters = [];
    const update = () => gutters.forEach((gutter, i) => gutter.setAttribute('aria-valuenow', split.getSizes()[i].toFixed(1)));
    const save = () => { store(key, split.getSizes()); update(); };
    split = Split(ids, {
      direction, sizes: valid(saved[key], ids.length) ? saved[key] : defaults,
      minSize, expandToMin: true, gutterSize: 10, snapOffset: 8,
      onDragEnd: save,
      gutter: (index, axis) => {
        const gutter = document.createElement('div');
        gutter.className = `gutter gutter-${axis}`;
        gutter.tabIndex = 0;
        gutter.setAttribute('role', 'separator');
        gutter.setAttribute('aria-orientation', axis === 'horizontal' ? 'vertical' : 'horizontal');
        gutter.setAttribute('aria-valuemin', '0');
        gutter.setAttribute('aria-valuemax', '100');
        gutters.push(gutter);
        gutter.setAttribute('aria-label', axis === 'horizontal' ? 'Resize adjacent columns' : 'Resize world and communications');
        gutter.title = 'Drag to resize. Arrow keys adjust; Home or double-click resets.';
        const reset = () => { split.setSizes(defaults); save(); };
        gutter.addEventListener('dblclick', reset);
        gutter.addEventListener('keydown', event => {
          if (event.key === 'Home') { event.preventDefault(); reset(); return; }
          const positive = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
          const negative = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
          if (![positive, negative].includes(event.key)) return;
          event.preventDefault();
          const sizes = split.getSizes();
          const delta = event.key === positive ? 2 : -2;
          sizes[index - 1] += delta; sizes[index] -= delta;
          split.setSizes(sizes); save();
        });
        return gutter;
      },
    });
    update();
    return split;
  };
  const horizontal = create(['#citizens-panel', '#map-panel', '#inspector-panel'], 'columns', 'horizontal', columns, [180, 320, 240]);
  workspace.classList.add('is-split');
  const vertical = create(['#workspace', '#communications-panel'], 'rows', 'vertical', rows, [360, 140]);
  dashboard.classList.add('is-split');
  const communications = create(['#trades-feed', '#private-feed', '#public-feed'], 'communicationColumns', 'horizontal', [30, 40, 30], [220, 260, 220]);
  document.querySelector('#communications-panel').classList.add('is-split');
  window.addEventListener('resize', () => {
    horizontal.setSizes(horizontal.getSizes());
    vertical.setSizes(vertical.getSizes());
    communications.setSizes(communications.getSizes());
  });
}
