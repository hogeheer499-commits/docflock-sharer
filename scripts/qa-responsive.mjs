import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const puppeteerModule = process.env.PUPPETEER_MODULE;
if (!puppeteerModule) throw new Error("PUPPETEER_MODULE is required");
const { default: puppeteer } = await import(puppeteerModule);

const targetUrl = process.env.QA_URL || "http://127.0.0.1:8788";
const outputDir = resolve(process.env.QA_OUTPUT_DIR || "qa-screenshots");
const chromePath = process.env.CHROME_PATH;
const viewports = [
  ["2560", 2560, 1080],
  ["1440", 1440, 900],
  ["1024", 1024, 900],
  ["768", 768, 900],
  ["390", 390, 844],
  ["320", 320, 720],
  ["844x390", 844, 390],
];
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

await mkdir(outputDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server"],
});

const results = [];
try {
  for (const [name, width, height] of viewports) {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => {
      const featured = [
        { id: "lecture-1", title: "Causality: The Ego's Foundation — 1 of 3 (Jan 2002)", series: "2002: The Way to God", languages: ["en", "nl", "pl"] },
        { id: "lecture-2", title: "Causality: The Ego's Foundation — 2 of 3 (Jan 2002)", series: "2002: The Way to God", languages: ["en", "nl", "pl"] },
        { id: "lecture-3", title: "Causality: The Ego's Foundation — 3 of 3 (Jan 2002)", series: "2002: The Way to God", languages: ["en", "nl", "pl"] },
        { id: "lecture-4", title: "Radical Subjectivity: The ‘I’ of Self — 1 of 3 (Feb 2002)", series: "2002: The Way to God", languages: ["en", "nl", "pl"] },
        { id: "lecture-5", title: "Radical Subjectivity: The ‘I’ of Self — 2 of 3 (Feb 2002)", series: "2002: The Way to God", languages: ["en", "nl", "pl"] },
        { id: "lecture-6", title: "Radical Subjectivity: The ‘I’ of Self — 3 of 3 (Feb 2002)", series: "2002: The Way to God", languages: ["en", "nl", "pl"] },
      ];
      const videos = featured.concat(Array.from({ length: 245 }, (_, index) => ({
        id: `lecture-extra-${index}`,
        title: `Lecture ${index + 7}`,
        series: "Archive",
        languages: ["en"],
      })));
      localStorage.setItem("docflock_token", "visual-qa-token");
      localStorage.setItem("docflock_expiry", String(Date.now() + 86400000));
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (!url.startsWith("/api/")) return nativeFetch(input, init);
        let data = {};
        if (url === "/api/videos") data = videos;
        else if (url === "/api/clips") data = Array.from({ length: 41 }, (_, index) => ({ id: `clip-${index}`, title: `Clip ${index + 1}`, languages: [] }));
        else if (url === "/api/music") data = Array.from({ length: 21 }, (_, index) => ({ id: `music-${index}`, title: `Music ${index + 1}`, languages: [] }));
        else if (url === "/api/youtube") data = Array.from({ length: 27 }, (_, index) => ({ id: `youtube-${index}`, title: `YouTube ${index + 1}`, languages: [] }));
        else if (url === "/api/delay") data = { audio_delay_ms: 0 };
        else if (url === "/api/zoom/state") data = { bridge_connected: true, can_read_state: true, audio_on: true, video_on: true };
        else if (url === "/api/status") data = { state: "stopped", queue: [] };
        return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
      };
    });

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForSelector("#list-all .item-list-row", { timeout: 10000 });
    const assertions = await page.evaluate(() => {
      const result = {};
      const firstRow = document.querySelector("#list-all .item-list-row");
      firstRow.click();
      result.rowsAreButtons = firstRow.tagName === "BUTTON" && firstRow.getAttribute("aria-pressed") === "true";
      firstRow.focus();
      result.rowsKeyboardFocusable = document.activeElement === firstRow;
      const firstLanguage = document.querySelector("#lang-checkboxes input");
      firstLanguage.focus();
      result.languagePillsFocusable = document.activeElement === firstLanguage;

      const settingsButton = document.getElementById("header-settings-btn");
      const shortcuts = document.getElementById("shortcuts-overlay");
      settingsButton.focus();
      settingsButton.click();
      result.shortcutsDialog = shortcuts.getAttribute("role") === "dialog" && shortcuts.getAttribute("aria-modal") === "true";
      result.shortcutsMovesFocus = document.activeElement.id === "shortcuts-close";
      result.shortcutsLocksScroll = document.body.classList.contains("modal-open");
      const logoutButton = document.getElementById("logout-btn");
      logoutButton.focus();
      logoutButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      result.shortcutsTrapsFocus = document.activeElement.id === "shortcuts-close";
      document.getElementById("shortcuts-close").click();
      result.shortcutsRestoresFocus = document.activeElement === settingsButton;

      const lectureTab = document.querySelector('[data-tab="all"]');
      const clipsTab = document.querySelector('[data-tab="clips"]');
      clipsTab.click();
      result.tabsSwitch = document.getElementById("tab-clips").classList.contains("active");
      result.tabSemantics = document.querySelector(".tab-bar").getAttribute("role") === "tablist" && clipsTab.getAttribute("aria-selected") === "true";
      clipsTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      result.tabArrowNavigation = lectureTab.getAttribute("aria-selected") === "true" && document.activeElement === lectureTab;

      const search = document.getElementById("search-all");
      search.value = "zzzz-no-result";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      const empty = document.querySelector("#list-all .item-search-empty:not([hidden])");
      result.emptySearchState = empty?.textContent.includes("Geen lezingen gevonden") && Boolean(empty?.querySelector(".item-search-clear"));
      empty?.querySelector(".item-search-clear")?.click();
      result.clearSearchWorks = search.value === "";

      firstRow.click();
      clipsTab.click();
      result.selectionPersistsExplicitly = document.getElementById("selection-summary").textContent.includes("Lecture");
      result.onlyActiveListRendered = document.querySelectorAll("#list-all .item-list-row").length === 0 && document.querySelectorAll("#list-clips .item-list-row").length === 41 && document.querySelectorAll("#list-music .item-list-row, #list-youtube .item-list-row").length === 0;
      lectureTab.click();

      localStorage.setItem("docflock_zoom_leave_timer", JSON.stringify({ status: "completed", completedAt: Date.now() }));
      renderZoomLeaveTimer();
      result.timerHistorySeparated = document.getElementById("zoom-leave-timer-status").textContent === "No timer set" && document.getElementById("zoom-leave-timer-history").textContent.startsWith("Last auto-exit:");
      localStorage.removeItem("docflock_zoom_leave_timer");
      renderZoomLeaveTimer(null);

      const tabBar = document.querySelector(".tab-bar");
      const tabHint = document.querySelector(".tab-scroll-hint");
      const tabsFit = tabBar.scrollWidth <= tabBar.clientWidth + 2;
      result.tabsDiscoverable = tabsFit || getComputedStyle(tabHint).display !== "none";
      result.noPageHorizontalScroll = document.documentElement.scrollWidth <= document.documentElement.clientWidth;
      result.layout = getComputedStyle(document.querySelector(".app-layout")).display;
      result.containerWidth = Math.round(document.querySelector(".container").getBoundingClientRect().width);
      result.tabClientWidth = tabBar.clientWidth;
      result.tabScrollWidth = tabBar.scrollWidth;
      result.domRows = document.querySelectorAll(".item-list-row").length;
      return result;
    });

    if (name === "1440") {
      await page.evaluate(() => {
        const search = document.getElementById("search-all");
        search.value = "zzzz-no-result";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await delay(150);
      await page.screenshot({ path: resolve(outputDir, "state-empty-1440.png"), fullPage: false });
      await page.evaluate(() => document.querySelector(".item-search-clear")?.click());
      await page.evaluate(() => document.getElementById("header-settings-btn").click());
      await delay(100);
      await page.screenshot({ path: resolve(outputDir, "state-shortcuts-1440.png"), fullPage: false });
      await page.keyboard.press("Escape");
    }
    await page.screenshot({ path: resolve(outputDir, `responsive-${name}.png`), fullPage: false });
    results.push({ name, width, height, assertions, consoleErrors });
    await page.close();
  }
} finally {
  await browser.close();
}

await writeFile(resolve(outputDir, "responsive-results.json"), JSON.stringify(results, null, 2));
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
