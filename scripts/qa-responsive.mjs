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
        { id: "2002-01-1", sort_key: "2002-01-1", title: "Causality: The Ego's Foundation - 1 of 3 (Jan 2002)", series: "2002: The Way to God", languages: ["en", "nl", "pl"] },
        { id: "2002-01-2", sort_key: "2002-01-2", title: "Causality: The Ego's Foundation - 2 of 3 (Jan 2002)", series: "2002: The Way to God", languages: ["en", "nl", "pl"] },
        { id: "2002-01-3", sort_key: "2002-01-3", title: "Causality: The Ego's Foundation - 3 of 3 (Jan 2002)", series: "2002: The Way to God", languages: ["en", "nl", "pl"] },
        { id: "2002-02-1", sort_key: "2002-02-1", title: "Radical Subjectivity: The ‘I’ of Self - 1 of 3 (Feb 2002)", series: "2002: The Way to God", languages: ["en", "nl", "pl"] },
        { id: "2002-02-2", sort_key: "2002-02-2", title: "Radical Subjectivity: The ‘I’ of Self - 2 of 3 (Feb 2002)", series: "2002: The Way to God", languages: ["en", "nl", "pl"] },
        { id: "2002-02-3", sort_key: "2002-02-3", title: "Radical Subjectivity: The ‘I’ of Self - 3 of 3 (Feb 2002)", series: "2002: The Way to God", languages: ["en", "nl", "pl"] },
      ];
      const namedCollections = [
        { id: "2013-01-1", sort_key: "2013-01-1", title: "Vol I: Power vs. Force - Muscle Testing - 1 of 2", series: "Volume Series", languages: ["en"] },
        { id: "2013-01-2", sort_key: "2013-01-2", title: "Vol I: Power vs. Force - Muscle Testing - 2 of 2", series: "Volume Series", languages: ["en"] },
        { id: "2014-13-1", sort_key: "2014-13-1", title: "Stress", series: "Archival Office Visit Series", languages: ["en"] },
        { id: "2015-11-1", sort_key: "2015-11-1", title: "A Map of Consciousness", series: "On The Road Talks", languages: ["en"] },
        { id: "2015-05-1", sort_key: "2015-05-1", title: "Progressive Levels of Consciousness", series: "On The Road Talks", languages: ["en"] },
        { id: "2015-01-1", sort_key: "2015-01-1", title: "How to Live Your Life Like A Prayer (2012)", series: "On The Road Talks", languages: ["en"] },
        { id: "2012-02-1", sort_key: "2012-02-1", title: "Q&A Session (Jul 2011) (Jul 2012)", series: "2012: Supporting Programs", languages: ["en"] },
        { id: "2003-20-1", sort_key: "2003-20-1", title: "Verification of Spiritual Realities - 1 of 3 (Sep 2003)", series: "2003: Verification Series (2003)", languages: ["en"] },
        { id: "2004-00-1", sort_key: "2004-00-1", title: "Love is a Way of Being - 1 of 3 (Jan 2004)", series: "2004: Transcending the Mind", languages: ["en"] },
      ];
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const videos = featured.concat(namedCollections, Array.from({ length: 236 }, (_, index) => {
        const groupIndex = Math.floor(index / 3);
        const year = 2003 + (groupIndex % 9);
        const month = (groupIndex % 12) + 1;
        const part = (index % 3) + 1;
        return {
          id: `${year}-${String(month).padStart(2, "0")}-${groupIndex + 1}-${part}`,
          sort_key: `${year}-${String(month).padStart(2, "0")}-${groupIndex + 1}-${part}`,
          title: `Archive Topic ${groupIndex + 1} - ${part} of 3 (${monthNames[month - 1]} ${year})`,
          series: `${year}: Lecture Archive`,
          languages: ["en"],
        };
      }));
      localStorage.setItem("docflock_token", "visual-qa-token");
      localStorage.setItem("docflock_expiry", String(Date.now() + 86400000));
      localStorage.setItem("docflock_resume", JSON.stringify({
        video_id: "lecture-resume",
        title: "Perception and Illusion - 2 of 3 (May 2002)",
        current_time: 197,
        languages: ["en"],
        saved_at: Date.now(),
      }));
      window.__zoomJoined = true;
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
        else if (url === "/api/zoom/state") data = { in_meeting: window.__zoomJoined, bridge_connected: false, can_read_state: false, audio_on: true, video_on: true, screen_name: "Hoge Heer" };
        else if (url === "/api/status") data = { state: "stopped", queue: [] };
        return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
      };
    });

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForSelector("#list-all .lecture-series-trigger", { timeout: 10000 });
    if (name === "1440" || name === "390") {
      await page.screenshot({ path: resolve(outputDir, `picker-initial-${name}.png`), fullPage: false });
    }
    const assertions = await page.evaluate(async (isSmartScrollViewport) => {
      const result = {};
      window.__smartScrollTargets = [];
      Element.prototype.scrollIntoView = function scrollIntoView(options) {
        window.__smartScrollTargets.push({ id: this.id, options });
      };
      const topActions = document.querySelector(".top-actions").getBoundingClientRect();
      result.headerActionsInsideViewport = topActions.right <= window.innerWidth;
      result.zoomJoinedStatus = document.getElementById("zoom-connection-text").textContent === "Hoge Heer is ready";
      window.__zoomJoined = false;
      await fetchZoomState();
      result.zoomWaitingStatus = document.getElementById("zoom-connection-text").textContent === "Not in Zoom yet"
        && document.getElementById("zoom-connection-status").classList.contains("waiting");
      window.__zoomJoined = true;
      await fetchZoomState();
      const resumePrompt = document.getElementById("resume-prompt");
      result.resumeIsSubtleAndInsideBrowse = resumePrompt.parentElement.classList.contains("browse-card")
        && !resumePrompt.classList.contains("hidden")
        && resumePrompt.getBoundingClientRect().top >= document.querySelector(".browse-heading").getBoundingClientRect().bottom
        && resumePrompt.getBoundingClientRect().bottom <= document.querySelector(".tab-strip-wrap").getBoundingClientRect().top + 1;
      result.initialArchiveCollapsed = document.querySelectorAll(".lecture-part-row").length === 0
        && [...document.querySelectorAll(".lecture-series-trigger")]
          .every((trigger) => trigger.getAttribute("aria-expanded") === "false");
      document.querySelector(".lecture-series-trigger").click();
      const firstRow = document.querySelector("#list-all .lecture-part-row");
      firstRow.click();
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      result.selectionSmartScroll = isSmartScrollViewport
        ? window.__smartScrollTargets.some((call) => call.id === "selection-summary" && call.options.block === "start")
        : window.__smartScrollTargets.length === 0;
      result.rowsAreButtons = firstRow.tagName === "BUTTON" && firstRow.getAttribute("aria-pressed") === "true";
      firstRow.focus();
      result.rowsKeyboardFocusable = document.activeElement === firstRow;
      const firstLanguage = document.querySelector("#lang-checkboxes input");
      firstLanguage.focus();
      result.languagePillsFocusable = document.activeElement === firstLanguage;
      result.lectureHierarchy = document.querySelectorAll(".lecture-year-list button").length > 1
        && document.querySelector(".lecture-content-heading h2").textContent.startsWith("2002:")
        && document.querySelector(".lecture-series-trigger").getAttribute("aria-expanded") === "true";
      const archiveLabels = [...document.querySelectorAll(".lecture-year-list button")]
        .map((button) => button.textContent.trim());
      result.yearButtonsHaveNoCounts = archiveLabels
        .every((label) => /^(?:\d{4}|Volume|Office|Road|Discussion|Satsang|Other)$/.test(label));
      result.namedCollectionsPresent = ["Volume", "Office", "Road", "Discussion", "Satsang"]
        .every((label) => archiveLabels.includes(label));
      result.syntheticArchiveYearsRemoved = ["2012", "2013", "2014", "2015"]
        .every((label) => !archiveLabels.includes(label));
      const nextYear = document.querySelectorAll(".lecture-year-list button")[1];
      nextYear.click();
      result.yearChangeStartsCollapsed = document.querySelectorAll(".lecture-part-row").length === 0
        && [...document.querySelectorAll(".lecture-series-trigger")]
          .every((trigger) => trigger.getAttribute("aria-expanded") === "false");
      const firstSeries = document.querySelector(".lecture-series-trigger");
      firstSeries.click();
      result.seriesExpandsOnDemand = document.querySelectorAll(".lecture-part-row").length > 0
        && document.querySelector(".lecture-series-trigger").getAttribute("aria-expanded") === "true";
      const officeButton = [...document.querySelectorAll(".lecture-year-list button")]
        .find((button) => button.textContent.trim() === "Office");
      officeButton.click();
      result.officeCollectionNamedCorrectly = document.querySelector(".lecture-content-heading h2").textContent === "Archival Office Visit Series"
        && document.querySelector(".lecture-breadcrumb strong").textContent === "Office"
        && !document.getElementById("list-all").textContent.includes("2014");
      const roadButton = [...document.querySelectorAll(".lecture-year-list button")]
        .find((button) => button.textContent.trim() === "Road");
      roadButton.click();
      result.roadCollectionHidesUnverifiedYears = document.querySelectorAll(".lecture-series-copy > span").length === 0
        && !document.getElementById("list-all").textContent.match(/\b(?:2003|2004|2012|2015)\b/);
      const volumeButton = [...document.querySelectorAll(".lecture-year-list button")]
        .find((button) => button.textContent.trim() === "Volume");
      volumeButton.click();
      document.querySelector(".lecture-series-trigger").click();
      result.collectionPartsGrouped = document.querySelector(".lecture-series-trigger strong").textContent.startsWith("Vol I:")
        && document.querySelectorAll(".lecture-part-row").length === 2;

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
      const empty = document.querySelector("#list-all .lecture-empty-state");
      result.emptySearchState = empty?.textContent.includes("No lectures found") && Boolean(empty?.querySelector("button"));
      empty?.querySelector("button")?.click();
      result.clearSearchWorks = search.value === "";

      firstRow.click();
      clipsTab.click();
      result.selectionPersistsExplicitly = document.getElementById("selection-summary").textContent.includes("Lecture");
      result.onlyActiveListRendered = document.querySelectorAll("#list-all .lecture-part-row, #list-all .lecture-result-row").length === 0 && document.querySelectorAll("#list-clips .item-list-row").length === 41 && document.querySelectorAll("#list-music .item-list-row, #list-youtube .item-list-row").length === 0;
      lectureTab.click();

      localStorage.setItem("docflock_zoom_leave_timer", JSON.stringify({ status: "completed", completedAt: Date.now() }));
      renderZoomLeaveTimer();
      result.finishedTimerIsSilent = document.getElementById("zoom-leave-timer-status").classList.contains("hidden")
        && document.getElementById("zoom-leave-timer-status").textContent === ""
        && !document.getElementById("zoom-leave-timer").classList.contains("completed")
        && !document.getElementById("zoom-leave-timer").classList.contains("failed");
      localStorage.setItem("docflock_zoom_leave_timer", JSON.stringify({
        id: "stale-firing",
        status: "firing",
        deadline: Date.now() - 61000,
      }));
      tickZoomLeaveTimer();
      result.staleFiringTimerRecoversSilently = document.getElementById("zoom-leave-timer-status").classList.contains("hidden")
        && document.getElementById("zoom-leave-timer-status").textContent === ""
        && !document.getElementById("zoom-leave-timer-minutes").disabled
        && !document.getElementById("zoom-leave-timer-start").classList.contains("hidden");
      localStorage.setItem("docflock_zoom_leave_timer", JSON.stringify({
        id: "finished-while-away",
        status: "firing",
        firedAt: Date.now(),
      }));
      window.__zoomJoined = false;
      await fetchZoomState();
      result.firingTimerReconcilesSilently = readZoomLeaveTimer().status === "completed"
        && document.getElementById("zoom-leave-timer-status").classList.contains("hidden")
        && document.getElementById("zoom-leave-timer-status").textContent === "";
      window.__zoomJoined = true;
      await fetchZoomState();
      localStorage.removeItem("docflock_zoom_leave_timer");
      renderZoomLeaveTimer(null);

      const mockedFetch = window.fetch;
      const toastCountBeforeSilentFailure = document.querySelectorAll("#toast-container .toast").length;
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (url === "/api/zoom/exit") {
          return new Response(JSON.stringify({ error: "QA timer failure" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        return mockedFetch(input, init);
      };
      const silentFailureResult = await runZoomAction("/api/zoom/exit", document.getElementById("zoom-leave-btn"), { reportErrors: false });
      result.automaticTimerFailureHasNoToast = silentFailureResult === false
        && document.querySelectorAll("#toast-container .toast").length === toastCountBeforeSilentFailure;
      window.fetch = mockedFetch;

      window.__smartScrollTargets = [];
      window.scrollTo(0, document.documentElement.scrollHeight);
      requestMobilePlayerScroll();
      updateStatusUI({ state: "playing", title: "Smart scroll QA", current_time: 1, duration: 60, languages: ["en"], queue: [] });
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      result.playerSmartScroll = isSmartScrollViewport
        ? window.__smartScrollTargets.some((call) => call.id === "status-card" && call.options.block === "start")
        : window.__smartScrollTargets.length === 0;
      updateStatusUI({ state: "stopped" });
      window.scrollTo(0, 0);

      const tabBar = document.querySelector(".tab-bar");
      const tabHint = document.querySelector(".tab-scroll-hint");
      const tabsFit = tabBar.scrollWidth <= tabBar.clientWidth + 2;
      result.tabsDiscoverable = tabsFit || getComputedStyle(tabHint).display !== "none";
      result.noPageHorizontalScroll = document.documentElement.scrollWidth <= document.documentElement.clientWidth;
      result.layout = getComputedStyle(document.querySelector(".app-layout")).display;
      result.containerWidth = Math.round(document.querySelector(".container").getBoundingClientRect().width);
      result.tabClientWidth = tabBar.clientWidth;
      result.tabScrollWidth = tabBar.scrollWidth;
      result.domRows = document.querySelectorAll(".item-list-row, .lecture-part-row, .lecture-result-row").length;
      return result;
    }, width <= 720);

    if (name === "1440") {
      await page.evaluate(() => {
        const search = document.getElementById("search-all");
        search.value = "zzzz-no-result";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await delay(150);
      await page.screenshot({ path: resolve(outputDir, "state-empty-1440.png"), fullPage: false });
      await page.evaluate(() => document.querySelector(".lecture-empty-state button")?.click());
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
