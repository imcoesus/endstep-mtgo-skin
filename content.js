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
const ZONE_TITLE = /['’]s (Graveyard|Exile|Library|Sideboard|Command Zone)(?![a-z])/;
const NOTICE = '[data-testid="chip-column"], [data-testid^="notice"]';
const ZONE_W = 190;  // keep in sync with --mtgo-zone-w in mtgo.css
const ZONE_GAP = 6;

function playerName(anchor) {
  return document
    .querySelector(`[data-player-anchor="${anchor}"] .wr-player-nameplate`)
    ?.getAttribute('aria-label') || null;
}

// The modal's "Pop out" button: press it so zones always open as windows.
function autoPopOut() {
  if (!root.classList.contains('mtgo-skin')) return;
  for (const btn of document.querySelectorAll('[role="dialog"] button')) {
    if (!/^\W*pop out\s*$/i.test(btn.textContent)) continue;
    const dialog = btn.closest('[role="dialog"]');
    if (dialog.dataset.mtgoPopped) continue;
    if (!ZONE_TITLE.test(dialog.textContent.slice(0, 200))) continue;
    dialog.dataset.mtgoPopped = '1';
    btn.click();
  }
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

function syncZoneDocks() {
  const me = playerName('me');
  const opp = playerName('opp');
  const zones = { me: [], opp: [] };
  for (const { el, head } of findZoneWindows()) {
    // Prefer the possessive ("coe's Graveyard") so "Ga" doesn't match "Garo"
    const mine = me && (head.includes(`${me}'s`) || head.includes(`${me}’s`));
    const theirs = opp && (head.includes(`${opp}'s`) || head.includes(`${opp}’s`));
    const side = mine ? 'me' : theirs ? 'opp' : me && head.includes(me) ? 'me' : 'opp';
    zones[side].push(el);
  }
  for (const side of ['me', 'opp']) {
    zones[side].forEach((el, i) => {
      el.classList.add(ZONE_CLASS);
      el.classList.toggle(ZONE_CLASS + '--me', side === 'me');
      el.classList.toggle(ZONE_CLASS + '--opp', side === 'opp');
      el.style.setProperty('--mtgo-zone-slot', i);
    });
    const space = zones[side].length ? zones[side].length * (ZONE_W + ZONE_GAP) + ZONE_GAP : 0;
    root.style.setProperty(`--mtgo-${side}-zone-space`, space + 'px');
  }
  // Drop the tag from windows that were closed or are no longer zones
  for (const el of document.querySelectorAll('.' + ZONE_CLASS)) {
    if (!zones.me.includes(el) && !zones.opp.includes(el)) {
      el.classList.remove(ZONE_CLASS, ZONE_CLASS + '--me', ZONE_CLASS + '--opp');
    }
  }
}

// Docked windows are position:fixed, so they need the battlefield halves'
// on-screen boxes. Publish them as CSS variables on <html>.
function publishHalfRects() {
  for (const [half, side] of [['self', 'me'], ['opp', 'opp']]) {
    const el = document.querySelector(`[data-half="${half}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    root.style.setProperty(`--mtgo-${side}-top`, r.top + 'px');
    root.style.setProperty(`--mtgo-${side}-left`, r.left + 'px');
    root.style.setProperty(`--mtgo-${side}-right`, window.innerWidth - r.right + 'px');
    root.style.setProperty(`--mtgo-${side}-height`, r.height + 'px');
  }
}
const halfObserver = new ResizeObserver(publishHalfRects);
let observedHalves = [];
function watchHalves() {
  const halves = [...document.querySelectorAll('[data-half]')];
  if (halves.length === observedHalves.length && halves.every((h, i) => h === observedHalves[i])) return;
  halfObserver.disconnect();
  halves.forEach((h) => halfObserver.observe(h));
  observedHalves = halves;
  publishHalfRects();
}
window.addEventListener('resize', publishHalfRects);

let scheduled = false;
new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    syncLogDock();
    autoOpenLog();
    autoPopOut();
    watchHalves();
    syncZoneDocks();
    publishHalfRects();
  });
}).observe(root, { childList: true, subtree: true });
