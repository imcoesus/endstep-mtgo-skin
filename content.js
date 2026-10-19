// Toggles the skin by adding/removing a class on <html>. All styles in
// mtgo.css are scoped under html.mtgo-skin so turning it off is instant.
const root = document.documentElement;
root.classList.add('mtgo-skin');

chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
  root.classList.toggle('mtgo-skin', enabled);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) root.classList.toggle('mtgo-skin', changes.enabled.newValue);
});

// ---------------------------------------------------------------------------
// Game log → docked right column, full height, like MTGO.
// Endstep renders the log as a floating, draggable window whose header has
// the .gl-title class. We find that window, tag it, and let mtgo.css pin it.
// ---------------------------------------------------------------------------
const DOCK_CLASS = 'mtgo-log-dock';
const OPEN_CLASS = 'mtgo-log-open';

function findLogWindow() {
  const title = document.querySelector('.gl-title');
  if (!title) return null;
  // The window is the nearest fixed-position ancestor (absolute as fallback).
  let fallback = null;
  for (let el = title.parentElement; el && el !== document.body; el = el.parentElement) {
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed') return el;
    if (pos === 'absolute' && !fallback) fallback = el;
  }
  return fallback;
}

let docked = null;
function syncLogDock() {
  const win = findLogWindow();
  if (win !== docked) {
    docked?.classList.remove(DOCK_CLASS);
    win?.classList.add(DOCK_CLASS);
    docked = win;
  }
  root.classList.toggle(OPEN_CLASS, !!win);
}

// Open the log once per game page so it's there from the start, as in MTGO.
// If the player closes it afterwards, we leave it closed.
let autoOpenedFor = null;
function autoOpenLog() {
  if (!root.classList.contains('mtgo-skin')) return;
  if (!location.pathname.startsWith('/game/') || autoOpenedFor === location.pathname) return;
  if (docked) { autoOpenedFor = location.pathname; return; }
  const opener = [...document.querySelectorAll('button[aria-label="Open game log"]')]
    .find((b) => b.offsetParent !== null);
  if (opener) {
    autoOpenedFor = location.pathname;
    opener.click();
  }
}

// ---------------------------------------------------------------------------
// Zone windows (graveyard, exile, revealed…) → docked inside each battlefield,
// like MTGO: mine on the right edge of my half, the opponent's on the left
// edge of theirs. Endstep opens zones in a modal with a "Pop out" button that
// turns it into a floating window; we press it for the player and then pin
// the floating window.
// ---------------------------------------------------------------------------
const ZONE_CLASS = 'mtgo-zone-dock';
// Zone windows are titled "coe's Graveyard", "Garo's Exile"… — possessive and
// capitalized. Case-sensitive on purpose: notices say "coe's library to their
// graveyard" in lowercase and must not be docked.
const ZONE_TITLE = /['’]s (Graveyard|Exile|Library|Sideboard|Command Zone)(?![a-z])| revealed \d/;
// MTGO stacks each player's zones in this order
const ZONE_KINDS = [['graveyard', /graveyard/i], ['exile', /exile/i], ['revealed', /revealed/i], ['other', /./]];
const NOTICE = '[data-testid="chip-column"], [data-testid^="notice"]';

function playerName(anchor) {
  return document
    .querySelector(`[data-player-anchor="${anchor}"] .wr-player-nameplate`)
    ?.getAttribute('aria-label') || null;
}

// The modal's "Pop out" button: press it so zones always open as windows.
function autoPopOut() {
  if (!root.classList.contains('mtgo-skin')) return false;
  let popped = false;
  for (const btn of document.querySelectorAll('[role="dialog"] button')) {
    if (!/^\W*pop out\s*$/i.test(btn.textContent)) continue;
    const dialog = btn.closest('[role="dialog"]');
    if (dialog.dataset.mtgoPopped) continue;
    if (!ZONE_TITLE.test(dialog.textContent.slice(0, 200))) continue;
    dialog.dataset.mtgoPopped = '1';
    btn.click();
    popped = true;
  }
  return popped;
}

// Floating windows are fixed-position, smaller than the screen, not modal,
// and not the log. Their header text names the zone and its owner.
function findZoneWindows() {
  const seen = new Set();
  const out = [];
  for (const el of document.querySelectorAll('.fixed, [style*="position: fixed"], .' + ZONE_CLASS)) {
    if (seen.has(el) || el.classList.contains(DOCK_CLASS)) continue;
    seen.add(el);
    // Toasts and their expanded details are never zone windows
    if (el.closest(NOTICE) || el.querySelector(NOTICE)) continue;
    if (el.closest('[role="dialog"][aria-modal="true"]') || el.querySelector('.gl-title')) continue;
    // The modal version of the viewer (it's the one with the Pop out button)
    if ([...el.querySelectorAll('button')].some((b) => /pop out/i.test(b.textContent))) continue;
    if (getComputedStyle(el).position !== 'fixed') continue;
    const head = el.textContent.slice(0, 160);
    if (!ZONE_TITLE.test(head)) continue;
    // Skip big containers (overlays, the game root itself)
    if (!el.classList.contains(ZONE_CLASS) && el.offsetWidth > window.innerWidth * 0.6) continue;
    out.push({ el, head });
  }
  return out;
}

function zoneKind(head) {
  return ZONE_KINDS.findIndex(([, re]) => re.test(head));
}

// Zone windows live in a column left of the battlefields: the opponent's
// stacked beside their half, mine beside mine, each side split evenly
// between its open zones (graveyard, exile, revealed…), like MTGO.
function syncZoneDocks() {
  const me = playerName('me');
  const opp = playerName('opp');
  const zones = { me: [], opp: [] };
  for (const { el, head } of findZoneWindows()) {
    // Prefer the possessive ("coe's Graveyard") so "Ga" doesn't match "Garo"
    const mine = me && (head.includes(`${me}'s`) || head.includes(`${me}’s`));
    const theirs = opp && (head.includes(`${opp}'s`) || head.includes(`${opp}’s`));
    const side = mine ? 'me' : theirs ? 'opp' : me && head.includes(me) ? 'me' : 'opp';
    zones[side].push({ el, kind: zoneKind(head) });
  }
  for (const side of ['me', 'opp']) {
    zones[side].sort((a, b) => a.kind - b.kind);
    zones[side].forEach(({ el, kind }, i) => {
      el.classList.add(ZONE_CLASS);
      el.classList.toggle(ZONE_CLASS + '--me', side === 'me');
      el.classList.toggle(ZONE_CLASS + '--opp', side === 'opp');
      el.dataset.mtgoZone = ZONE_KINDS[kind][0];
      el.style.setProperty('--mtgo-zone-slot', i);
      el.style.setProperty('--mtgo-zone-count', zones[side].length);
    });
  }
  // Drop the tag from windows that were closed or are no longer zones
  const kept = new Set([...zones.me, ...zones.opp].map((z) => z.el));
  // No zone shown → mtgo.css collapses the zone column to nothing
  root.classList.toggle('mtgo-has-zones', kept.size > 0);
  for (const el of document.querySelectorAll('.' + ZONE_CLASS)) {
    if (!kept.has(el)) {
      el.classList.remove(ZONE_CLASS, ZONE_CLASS + '--me', ZONE_CLASS + '--opp');
      delete el.dataset.mtgoZone;
    }
  }
}

// Open each player's graveyard and exile as soon as they have cards, so the
// zone column fills itself like MTGO's. Each zone is opened, its modal popped
// out the moment it renders (checked every frame), then the next one — all
// in one quick chain, with the modals hidden so they don't flash. A zone the
// player hides stays hidden for the rest of that game.
const AUTO_ZONES = [
  ['opp-graveyard', 'opp', 'graveyard'],
  ['opp-exile', 'opp', 'exile'],
  ['my-graveyard', 'me', 'graveyard'],
  ['my-exile', 'me', 'exile'],
];
const autoOpenedZones = new Set();
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
let autoZoneBusy = false;

function pendingAutoZones() {
  const out = [];
  for (const [anchor, side, kind] of AUTO_ZONES) {
    const key = location.pathname + '|' + anchor;
    if (autoOpenedZones.has(key)) continue;
    const btn = document.querySelector(`button[data-zone-anchor="${anchor}"]`);
    if (!btn || btn.disabled || !/\((?:[1-9]\d*)\)/.test(btn.getAttribute('aria-label') || '')) continue;
    autoOpenedZones.add(key);
    if (!document.querySelector(`.${ZONE_CLASS}--${side}[data-mtgo-zone="${kind}"]`)) out.push(btn);
  }
  return out;
}

// Clicks a zone button and pops its modal out as soon as it appears.
async function openZoneDocked(btn) {
  btn.click();
  for (let i = 0; i < 60; i++) {          // ~1s at 60fps
    await nextFrame();
    if (autoPopOut()) {
      // Keep modals hidden until Endstep has actually removed this one
      for (let j = 0; j < 30 && document.querySelector('[role="dialog"][data-mtgo-popped]'); j++) {
        await nextFrame();
      }
      return;
    }
  }
}

async function autoOpenZones() {
  if (autoZoneBusy || !root.classList.contains('mtgo-skin') || window.innerWidth < 768) return;
  // A zone modal the player opened by hand is handled by autoPopOut()
  if ([...document.querySelectorAll('[role="dialog"] button')].some((b) => /pop out/i.test(b.textContent))) return;
  const queue = pendingAutoZones();
  if (!queue.length) return;
  autoZoneBusy = true;
  root.classList.add('mtgo-auto-zone');
  try {
    for (const btn of queue) await openZoneDocked(btn);
  } finally {
    root.classList.remove('mtgo-auto-zone');
    autoZoneBusy = false;
  }
}

// Docked windows are position:fixed, so they need the battlefield halves'
// on-screen boxes. Publish them as CSS variables on <html>. Uses the part of
// each half that is actually visible (clipped by its panel and kept below the
// top bar), so a window can never start under the bar or off-screen.
function publishHalfRects() {
  const barBottom = document.getElementById(TOPBAR_ID)?.getBoundingClientRect().bottom || 0;
  for (const [half, side] of [['self', 'me'], ['opp', 'opp']]) {
    const el = document.querySelector(`[data-half="${half}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const clip = (el.closest('.wr-resizable-panel') || el).getBoundingClientRect();
    const top = Math.max(r.top, clip.top, barBottom);
    const bottom = Math.min(r.bottom, clip.bottom);
    root.style.setProperty(`--mtgo-${side}-top`, top + 'px');
    root.style.setProperty(`--mtgo-${side}-left`, r.left + 'px');
    root.style.setProperty(`--mtgo-${side}-right`, window.innerWidth - r.right + 'px');
    root.style.setProperty(`--mtgo-${side}-height`, Math.max(0, bottom - top) + 'px');
  }
}
const halfObserver = new ResizeObserver(publishHalfRects);
let observedHalves = [];
function watchHalves() {
  const halves = [...document.querySelectorAll('[data-half]')];
  if (halves.length === observedHalves.length && halves.every((h, i) => h === observedHalves[i])) return;
  halfObserver.disconnect();
  halves.forEach((h) => halfObserver.observe(h));
  // The grid moves the halves without resizing them (top bar, log, zone
  // column), so watch it too
  const grid = document.querySelector('.wr-game-grid');
  if (grid) halfObserver.observe(grid);
  observedHalves = halves;
  publishHalfRects();
}
window.addEventListener('resize', publishHalfRects);
window.addEventListener('scroll', publishHalfRects, { capture: true, passive: true });

// Skull (graveyard) and flame (exile) buttons toggle that zone in the
// column: if it's already docked, close it instead of letting Endstep open
// its modal again. Runs in the capture phase, before React sees the click.
function zoneCloseButton(win) {
  const buttons = [...win.querySelectorAll('button')];
  return buttons.find((b) => /close/i.test(b.getAttribute('aria-label') || b.title || ''))
      || buttons.reverse().find((b) => /^[×✕x]$/i.test(b.textContent.trim()));
}
document.addEventListener('click', (e) => {
  if (!root.classList.contains('mtgo-skin') || !e.isTrusted) return;
  const btn = e.target.closest?.('button[data-zone-anchor]');
  const auto = btn && AUTO_ZONES.find(([anchor]) => anchor === btn.dataset.zoneAnchor);
  if (!auto) return;
  const [anchor, side, kind] = auto;
  const win = document.querySelector(`.${ZONE_CLASS}--${side}[data-mtgo-zone="${kind}"]`);
  // Either way the player chose: don't auto-open this zone again this game
  autoOpenedZones.add(location.pathname + '|' + anchor);
  if (!win) return;               // not shown → Endstep opens it, we dock it
  const close = zoneCloseButton(win);
  if (!close) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  close.click();
}, true);

// ---------------------------------------------------------------------------
// Match bar: a strip across the top of the game, like MTGO's window title
// bar, holding the match/game score, whose turn it is and the reveals.
// The bar is our own element; Endstep's chips stay where React rendered them
// and are only tagged here — mtgo.css pins them onto the bar with fixed
// positioning, so React never sees a moved node.
// ---------------------------------------------------------------------------
const TOPBAR_ID = 'mtgo-topbar';

function syncTopBar() {
  const inGame = !!document.querySelector('.wr-game-grid');
  root.classList.toggle('mtgo-has-topbar', inGame);
  let bar = document.getElementById(TOPBAR_ID);
  if (inGame && !bar) {
    bar = document.createElement('div');
    bar.id = TOPBAR_ID;
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
  } else if (!inGame && bar) {
    bar.remove();
  }
}

// Tags the outermost element under `scope` whose text matches `re`, without
// swallowing a parent that also holds other chips (checked with `notRe`).
function tagChip(scope, cls, re, notRe) {
  let found = null;
  for (const el of scope.querySelectorAll('div, span, button, a')) {
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    if (!re.test(text) || (notRe && notRe.test(text)) || text.length > 60) continue;
    if (el.closest('.mtgo-log-dock, .mtgo-zone-dock, [data-testid="chip-column"]')) continue;
    if (!found || el.contains(found)) found = el;
  }
  for (const el of document.querySelectorAll('.' + cls)) if (el !== found) el.classList.remove(cls);
  found?.classList.add(cls);
}

function syncMatchChips() {
  const scope = document.querySelector('.wr-game-grid');
  if (!scope) return;
  // textContent glues the spans together ("MatchGame 1 / 30 – 0"), so no \b
  tagChip(scope, 'mtgo-match-chip', /^match\s*game\s*\d+\s*\/\s*\d/i, /reveals/i);
  tagChip(scope, 'mtgo-reveals-chip', /^reveals?\s*\d+$/i, /match|game/i);
  // Endstep decorates these chips with absolutely positioned corner brackets
  // sized for their original box; once restyled on the bar they land on top
  // of the text. Hide any absolutely positioned descendant.
  for (const chip of document.querySelectorAll('.mtgo-match-chip, .mtgo-reveals-chip')) {
    for (const el of chip.querySelectorAll('*')) {
      const pos = getComputedStyle(el).position;
      el.classList.toggle('mtgo-chip-deco', pos === 'absolute' || pos === 'fixed');
      el.classList.toggle('mtgo-match-label', !el.children.length && /^match$/i.test(el.textContent.trim()));
    }
  }
}

// Right side of the bar, laid out right-to-left: full screen, reveals, hold
// priority, priority. Widths vary (and some chips come and go), so each one
// gets its offset measured here instead of a hard-coded right: value.
// The hold chip's wrapper is tagged rather than the button: the wrapper is a
// CSS container, which would trap a position:fixed child inside it.
function layoutBarRight() {
  const rail = document.querySelector('.wr-rail-right');
  if (!rail || !root.classList.contains('mtgo-has-topbar')) return;
  const items = [
    [rail.querySelector(':scope > .flex.justify-end'), 'mtgo-bar-fullscreen'],
    [document.querySelector('.mtgo-reveals-chip'), null],
    [rail.querySelector(':scope > [data-testid="hold-priority-chip"], :scope > :has([data-testid="hold-priority-chip"])'), 'mtgo-bar-hold'],
    [rail.querySelector('.wr-priority-badge'), 'mtgo-bar-priority'],
  ];
  let x = (docked?.offsetWidth || 0) + 8;
  for (const [el, cls] of items) {
    if (!el) continue;
    if (cls) el.classList.add(cls);
    el.style.setProperty('--mtgo-bar-right', x + 'px');
    if (el.offsetWidth) x += el.offsetWidth + 8;
  }
}
window.addEventListener('resize', layoutBarRight);

// ---------------------------------------------------------------------------
// Resizable panes: drag the left edge of the docked log or the right edge of
// the zone column. Widths live in CSS variables on <html> (--mtgo-log-w,
// --mtgo-zone-w) plus a scale factor the content zooms by, so cards and text
// grow with the pane. Double-click a handle to reset; sizes are remembered.
// ---------------------------------------------------------------------------
const PANES = {
  log:  { varName: '--mtgo-log-w',  scaleVar: '--mtgo-log-scale',  base: 300, min: 220, max: 640 },
  zone: { varName: '--mtgo-zone-w', scaleVar: '--mtgo-zone-scale', base: 200, min: 150, max: 440 },
};
const paneWidths = {};

function applyPaneWidth(key, width) {
  const pane = PANES[key];
  const w = Math.round(Math.min(pane.max, Math.max(pane.min, width || pane.base)));
  paneWidths[key] = w;
  root.style.setProperty(pane.varName, w + 'px');
  root.style.setProperty(pane.scaleVar, (w / pane.base).toFixed(3));
}

// Defaults first, then the saved sizes on top (whenever storage answers)
for (const key of Object.keys(PANES)) applyPaneWidth(key);
chrome.storage.local.get({ paneWidths: {} }, ({ paneWidths: saved }) => {
  for (const key of Object.keys(PANES)) if (saved[key]) applyPaneWidth(key, saved[key]);
});

function makeHandle(key, widthFromPointer) {
  const handle = document.createElement('div');
  handle.className = `mtgo-resize mtgo-resize--${key}`;
  handle.title = 'Drag to resize · double-click to reset';
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { handle.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    root.classList.add('mtgo-resizing');
    const move = (ev) => {
      applyPaneWidth(key, widthFromPointer(ev.clientX));
      publishHalfRects();
      layoutBarRight();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      root.classList.remove('mtgo-resizing');
      chrome.storage.local.set({ paneWidths: { ...paneWidths } });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
    handle.addEventListener('pointercancel', up, { once: true });
  });
  handle.addEventListener('dblclick', () => {
    applyPaneWidth(key, PANES[key].base);
    publishHalfRects();
    layoutBarRight();
    chrome.storage.local.set({ paneWidths: { ...paneWidths } });
  });
  return handle;
}

function syncResizeHandles() {
  const inGame = root.classList.contains('mtgo-has-topbar');
  for (const [key, fromPointer] of [
    ['log', (x) => window.innerWidth - x],
    ['zone', (x) => x - (document.querySelector('.wr-rail-left')?.getBoundingClientRect().right || 0)],
  ]) {
    let handle = document.querySelector(`.mtgo-resize--${key}`);
    if (inGame && !handle) document.body.appendChild(makeHandle(key, fromPointer));
    if (!inGame && handle) handle.remove();
  }
}

let scheduled = false;
new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    syncTopBar();
    syncResizeHandles();
    syncMatchChips();
    syncLogDock();
    autoOpenLog();
    autoPopOut();
    autoOpenZones();
    watchHalves();
    syncZoneDocks();
    publishHalfRects();
    layoutBarRight();
  });
}).observe(root, { childList: true, subtree: true });
