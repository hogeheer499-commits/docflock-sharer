import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const targetUrl = process.env.CAPTURE_URL;
const outputPath = resolve(process.env.CAPTURE_OUTPUT || "capture.png");
const pin = process.env.DOCREMOTE_PIN || "";
const mockApi = process.env.CAPTURE_MOCK === "1";
const selectFirst = process.env.CAPTURE_SELECT_FIRST === "1";
const runAssertions = process.env.CAPTURE_ASSERT === "1";
const captureResume = process.env.CAPTURE_RESUME === "1";
const width = Number(process.env.CAPTURE_WIDTH || 1488);
const height = Number(process.env.CAPTURE_HEIGHT || 1056);
const deviceScaleFactor = Number(process.env.CAPTURE_DSF || 1);
const chromePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const port = Number(process.env.CHROME_DEBUG_PORT || 9224);
const debug = process.env.CAPTURE_DEBUG === "1";
const debugLog = (message) => {
  if (debug) process.stderr.write(`[capture] ${message}\n`);
};

if (!targetUrl) throw new Error("CAPTURE_URL is required");

const profileDir = await mkdtemp(`${tmpdir()}/docremote-capture-`);
const chrome = spawn(chromePath, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  "--hide-scrollbars",
  "about:blank",
], { stdio: "ignore" });

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function getDebuggerUrl() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = pages.find((entry) => entry.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await delay(100);
  }
  throw new Error("Chrome debugging endpoint did not become ready");
}

debugLog("waiting for debugger");
const socket = new WebSocket(await getDebuggerUrl());
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", rejectOpen, { once: true });
});
debugLog("debugger connected");

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve: resolveCommand, reject: rejectCommand } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) rejectCommand(new Error(message.error.message));
  else resolveCommand(message.result);
});

function command(method, params = {}) {
  const id = nextId;
  nextId += 1;
  return new Promise((resolveCommand, rejectCommand) => {
    pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

try {
  await command("Page.enable");
  await command("Runtime.enable");
  debugLog("page and runtime enabled");
  if (mockApi) {
    await command("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        (() => {
          const featuredVideos = [
            { id: 'lecture-1', title: "Causality: The Ego's Foundation — 1 of 3 (Jan 2002)", series: '2002: The Way to God', languages: ['en', 'nl', 'pl'] },
            { id: 'lecture-2', title: "Causality: The Ego's Foundation — 2 of 3 (Jan 2002)", series: '2002: The Way to God', languages: ['en', 'nl', 'pl'] },
            { id: 'lecture-3', title: "Causality: The Ego's Foundation — 3 of 3 (Jan 2002)", series: '2002: The Way to God', languages: ['en', 'nl', 'pl'] },
            { id: 'lecture-4', title: "Radical Subjectivity: The ‘I’ of Self — 1 of 3 (Feb 2002)", series: '2002: The Way to God', languages: ['en', 'nl', 'pl'] },
            { id: 'lecture-5', title: "Radical Subjectivity: The ‘I’ of Self — 2 of 3 (Feb 2002)", series: '2002: The Way to God', languages: ['en', 'nl', 'pl'] },
            { id: 'lecture-6', title: "Radical Subjectivity: The ‘I’ of Self — 3 of 3 (Feb 2002)", series: '2002: The Way to God', languages: ['en', 'nl', 'pl'] }
          ];
          const videos = featuredVideos.concat(Array.from({ length: 245 }, (_, index) => ({
            id: 'lecture-extra-' + index,
            title: 'Lecture ' + (index + 7),
            series: 'Archive',
            languages: ['en']
          })));
          localStorage.setItem('docflock_token', 'visual-qa-token');
          localStorage.setItem('docflock_expiry', String(Date.now() + 86400000));
          if (${captureResume}) {
            localStorage.setItem('docflock_resume', JSON.stringify({
              video_id: 'lecture-resume',
              title: 'Perception and Illusion - 2 of 3 (May 2002)',
              current_time: 197,
              languages: ['en'],
              saved_at: Date.now()
            }));
          }
          const nativeFetch = window.fetch.bind(window);
          window.fetch = async (input, init) => {
            const url = typeof input === 'string' ? input : input.url;
            if (!url.startsWith('/api/')) return nativeFetch(input, init);
            let data = {};
            if (url === '/api/videos') data = videos;
            else if (url === '/api/clips') data = Array.from({ length: 41 }, (_, index) => ({ id: 'clip-' + index, title: 'Clip ' + (index + 1), languages: [] }));
            else if (url === '/api/music') data = Array.from({ length: 21 }, (_, index) => ({ id: 'music-' + index, title: 'Music ' + (index + 1), languages: [] }));
            else if (url === '/api/youtube') data = Array.from({ length: 27 }, (_, index) => ({ id: 'youtube-' + index, title: 'YouTube ' + (index + 1), languages: [] }));
            else if (url === '/api/videos/multilang') data = [];
            else if (url === '/api/delay') data = { audio_delay_ms: 0 };
            else if (url === '/api/zoom/state') data = {
              bridge_connected: true,
              can_read_state: true,
              audio_on: true,
              video_on: true
            };
            else if (url === '/api/status') data = {
              state: 'stopped',
              queue: [{ video_id: 'lecture-1', title: "Causality: The Ego's Foundation — 1 of 3 (Jan 2002)" }]
            };
            return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
          };
        })();
      `,
    });
  }
  await command("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile: width < 700,
  });
  debugLog("device metrics set");
  await command("Page.navigate", { url: targetUrl });
  debugLog("page navigated");
  await delay(1800);

  if (pin && !mockApi) {
    const expression = `
      (async () => {
        const response = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: ${JSON.stringify(pin)} })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Login failed');
        localStorage.setItem('docflock_token', data.token);
        localStorage.setItem('docflock_expiry', String(data.expiry));
        return data.expiry;
      })()
    `;
    const auth = await command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (auth.exceptionDetails) throw new Error("Browser login failed");
    await command("Page.reload", { ignoreCache: true });
    await delay(4500);
  }

  if (selectFirst) {
    await command("Runtime.evaluate", {
      expression: `
        (() => {
          document.querySelector('.item-list-row')?.click();
          if (typeof updateQueueUI === 'function') {
            updateQueueUI([{ video_id: 'lecture-1', title: "Causality: The Ego's Foundation — 1 of 3 (Jan 2002)" }]);
          }
        })()
      `,
    });
    await delay(400);
    debugLog("first item selected");
  }

  if (runAssertions) {
    debugLog("running assertions");
    const assertionResult = await command("Runtime.evaluate", {
      expression: `
        (() => {
          const result = {};
          const joinDialog = document.getElementById('zoom-join-dialog');
          document.getElementById('zoom-join-btn').click();
          result.joinDialogOpens = !joinDialog.classList.contains('hidden');
          document.getElementById('zoom-join-cancel').click();
          result.joinDialogCloses = joinDialog.classList.contains('hidden');

          const shortcuts = document.getElementById('shortcuts-overlay');
          const settingsButton = document.getElementById('header-settings-btn');
          settingsButton.focus();
          settingsButton.click();
          result.settingsOpens = !shortcuts.classList.contains('hidden');
          result.shortcutsDialogSemantics =
            shortcuts.getAttribute('role') === 'dialog' &&
            shortcuts.getAttribute('aria-modal') === 'true' &&
            shortcuts.hasAttribute('aria-labelledby');
          result.shortcutsMovesFocus = document.activeElement.id === 'shortcuts-close';
          result.shortcutsLocksScroll = document.body.classList.contains('modal-open');
          document.getElementById('shortcuts-close').click();
          result.shortcutsRestoresFocus = document.activeElement === settingsButton;

          const lectureTab = document.querySelector('[data-tab="all"]');
          const clipsTab = document.querySelector('[data-tab="clips"]');
          clipsTab.click();
          result.tabsSwitch = document.getElementById('tab-clips').classList.contains('active');
          result.tabSemantics =
            document.querySelector('.tab-bar').getAttribute('role') === 'tablist' &&
            clipsTab.getAttribute('role') === 'tab' &&
            clipsTab.getAttribute('aria-selected') === 'true' &&
            clipsTab.getAttribute('aria-controls') === 'tab-clips';
          clipsTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
          result.tabArrowNavigation = lectureTab.getAttribute('aria-selected') === 'true';

          const search = document.getElementById('search-all');
          search.value = 'Radical Subjectivity';
          search.dispatchEvent(new Event('input', { bubbles: true }));
          result.searchFilters = [...document.querySelectorAll('#list-all .item-list-row')]
            .filter((row) => !row.hidden).length === 3;
          search.value = 'zzzz-no-result';
          search.dispatchEvent(new Event('input', { bubbles: true }));
          const emptyState = document.querySelector('#list-all .item-search-empty:not([hidden])');
          result.emptySearchState =
            emptyState?.textContent.includes('Geen lezingen gevonden') &&
            emptyState?.querySelector('.item-search-clear')?.textContent === 'Zoekopdracht wissen';
          emptyState?.querySelector('.item-search-clear')?.click();
          result.clearSearchWorks = search.value === '';
          search.value = '';
          search.dispatchEvent(new Event('input', { bubbles: true }));

          const firstRow = document.querySelector('#list-all .item-list-row');
          firstRow.click();
          result.selectionEnablesActions =
            !document.getElementById('play-btn').disabled &&
            !document.getElementById('queue-btn').disabled &&
            !document.getElementById('lang-group').classList.contains('hidden');
          result.rowsAreButtons = firstRow.tagName === 'BUTTON' && firstRow.getAttribute('aria-pressed') === 'true';
          firstRow.focus();
          result.rowsKeyboardFocusable = document.activeElement === firstRow;
          const firstLanguage = document.querySelector('#lang-checkboxes input');
          firstLanguage.focus();
          result.languagePillsFocusable = document.activeElement === firstLanguage;

          clipsTab.click();
          result.selectionPersistsExplicitly =
            document.getElementById('selection-summary').textContent.includes('Lecture') &&
            !document.getElementById('selection-summary').classList.contains('hidden');
          result.onlyActiveListRendered =
            document.querySelectorAll('#list-all .item-list-row').length === 0 &&
            document.querySelectorAll('#list-clips .item-list-row').length === 41 &&
            document.querySelectorAll('#list-music .item-list-row, #list-youtube .item-list-row').length === 0;
          lectureTab.click();

          document.getElementById('zoom-leave-timer-start').click();
          result.timerStarts = document.getElementById('zoom-leave-timer').classList.contains('active');
          document.getElementById('zoom-leave-timer-cancel').click();
          result.timerCancels = !document.getElementById('zoom-leave-timer').classList.contains('active');
          result.noPageHorizontalScroll = document.documentElement.scrollWidth <= document.documentElement.clientWidth;

          return result;
        })()
      `,
      returnByValue: true,
    });
    process.stdout.write(`${JSON.stringify(assertionResult.result.value)}\n`);
    debugLog("assertions complete");
  }

  debugLog("capturing screenshot");
  const screenshot = await command("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
  process.stdout.write(`${outputPath}\n`);
  debugLog("screenshot written");
} finally {
  socket.close();
  chrome.kill("SIGTERM");
  await new Promise((resolveExit) => chrome.once("exit", resolveExit));
  try {
    await rm(profileDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  } catch {}
}
