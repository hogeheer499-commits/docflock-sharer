import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const puppeteerModule = process.env.PUPPETEER_MODULE;
if (!puppeteerModule) throw new Error("PUPPETEER_MODULE is required");
const { default: puppeteer } = await import(puppeteerModule);

const targetUrl = process.env.QA_URL || "http://127.0.0.1:8788";
const outputDir = resolve(process.env.QA_OUTPUT_DIR || "qa-screenshots");
const chromePath = process.env.CHROME_PATH;
const viewports = [
  ["2560", 2560, 1440],
  ["1578", 1578, 904],
  ["1440", 1440, 900],
  ["1024", 1024, 768],
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
      window.__apiCalls = [];
      window.__mockAfterVideoState = { status: "idle", video_id: null, video_title: null };
      window.__mockPlaybackState = { state: "stopped", queue: [] };
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (!url.startsWith("/api/")) return nativeFetch(input, init);
        window.__apiCalls.push({ url, method: init?.method || "GET" });
        let data = {};
        if (url === "/api/videos") data = videos;
        else if (url === "/api/clips") data = Array.from({ length: 41 }, (_, index) => ({ id: `clip-${index}`, title: `Clip ${index + 1}`, languages: [] }));
        else if (url === "/api/music") data = Array.from({ length: 21 }, (_, index) => ({ id: `music-${index}`, title: `Music ${index + 1}`, languages: [] }));
        else if (url === "/api/youtube") data = Array.from({ length: 27 }, (_, index) => ({ id: `youtube-${index}`, title: `YouTube ${index + 1}`, languages: [] }));
        else if (url === "/api/delay") data = { audio_delay_ms: 0 };
        else if (url === "/api/zoom/state") data = { in_meeting: window.__zoomJoined, bridge_connected: false, can_read_state: false, audio_on: true, video_on: true, screen_name: "Hoge Heer" };
        else if (url === "/api/play") {
          window.__mockPlaybackState = {
            state: "playing",
            title: "Causality: The Ego's Foundation - 1 of 3 (Jan 2002)",
            video_id: "2002-01-1",
            current_time: 1,
            duration: 3600,
            languages: ["en"],
            available_languages: ["en", "nl", "pl"],
            queue: [],
          };
          data = { title: window.__mockPlaybackState.title };
        }
        else if (url === "/api/status") data = {
          ...window.__mockPlaybackState,
          zoom_exit_after_video: window.__mockAfterVideoState,
        };
        else if (url === "/api/zoom/exit-after-video" && init?.method === "POST") {
          const request = JSON.parse(init.body || "{}");
          window.__mockAfterVideoState = {
            status: "armed",
            video_id: request.video_id,
            video_title: request.video_title,
            armed_at: Date.now() / 1000,
          };
          data = window.__mockAfterVideoState;
        }
        else if (url === "/api/zoom/exit-after-video" && init?.method === "DELETE") {
          window.__mockAfterVideoState = { status: "idle", video_id: null, video_title: null };
          data = window.__mockAfterVideoState;
        }
        return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
      };
    });

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForSelector("#list-all .lecture-series-trigger", { timeout: 10000 });
    if (name === "1440" || name === "390") {
      await page.screenshot({ path: resolve(outputDir, `picker-initial-${name}.png`), fullPage: false });
    }
    const assertions = await page.evaluate(async () => {
      const result = {};
      const timerCard = document.getElementById("zoom-leave-timer");
      result.timerHiddenWithoutPlayback = timerCard.hidden;
      updateStatusUI({ state: "paused", title: "Timer visibility QA", video_id: "timer-visibility-qa", queue: [] });
      result.timerVisibleWhilePlayerPaused = !timerCard.hidden;
      updateStatusUI({ state: "stopped" });
      result.timerHidesWhenPlayerStops = timerCard.hidden;
      window.__smartScrollTargets = [];
      window.__originalScrollIntoView = Element.prototype.scrollIntoView;
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
      const playRow = document.querySelector(".play-row");
      const playRectAfterSelection = playRow.getBoundingClientRect();
      const playWasVisible = playRectAfterSelection.top >= 16 && playRectAfterSelection.bottom <= window.innerHeight - 16;
      const selectionScrollCall = window.__smartScrollTargets.some((call) => call.id === "selection-summary" && call.options.block === "start");
      result.selectionSmartScroll = playWasVisible ? !selectionScrollCall : selectionScrollCall;

      window.__smartScrollTargets = [];
      const originalPlayRect = playRow.getBoundingClientRect.bind(playRow);
      playRow.getBoundingClientRect = () => ({ ...originalPlayRect(), top: 100, bottom: 154 });
      selectItem(firstRow.dataset.id);
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      playRow.getBoundingClientRect = originalPlayRect;
      result.visiblePlayDoesNotScroll = window.__smartScrollTargets.length === 0;
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
      result.lectureSeriesLabel = document.querySelector(".lecture-nav-group .lecture-year-heading").textContent === "Lecture series";
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

      window.__apiCalls = [];
      window.confirm = () => true;
      updateStatusUI({ state: "playing", title: "Leave flow QA", current_time: 12, duration: 60, languages: ["en"], queue: [] });
      document.getElementById("zoom-leave-btn").click();
      await new Promise((resolveWait) => setTimeout(resolveWait, 80));
      const manualStopCall = window.__apiCalls.findIndex((call) => call.url === "/api/stop" && call.method === "POST");
      const manualExitCall = window.__apiCalls.findIndex((call) => call.url === "/api/zoom/exit" && call.method === "POST");
      const manualPauseCall = window.__apiCalls.findIndex((call) => call.url === "/api/pause");
      result.manualLeaveStopsPlaybackFirst = manualStopCall >= 0
        && manualExitCall > manualStopCall
        && manualPauseCall === -1
        && document.getElementById("status-card").classList.contains("hidden");

      window.__apiCalls = [];
      const timerExit = {
        id: "timer-stop-flow",
        status: "scheduled",
        minutes: 1,
        deadline: Date.now() - 1,
      };
      writeZoomLeaveTimer(timerExit);
      await fireZoomLeaveTimer(timerExit);
      const timerStopCall = window.__apiCalls.findIndex((call) => call.url === "/api/stop" && call.method === "POST");
      const timerExitCall = window.__apiCalls.findIndex((call) => call.url === "/api/zoom/exit" && call.method === "POST");
      const timerPauseCall = window.__apiCalls.findIndex((call) => call.url === "/api/pause");
      result.timerLeaveStopsPlaybackFirst = timerStopCall >= 0
        && timerExitCall > timerStopCall
        && timerPauseCall === -1;
      localStorage.removeItem("docflock_zoom_leave_timer");
      renderZoomLeaveTimer(null);

      updateStatusUI({
        state: "playing",
        title: "End-after-video QA",
        video_id: "after-video-qa",
        current_time: 40,
        duration: 60,
        languages: ["en"],
        queue: [],
      });
      const afterVideoButton = document.getElementById("zoom-leave-after-video");
      result.afterVideoOptionAvailableDuringPlayback = !afterVideoButton.disabled;
      afterVideoButton.click();
      await new Promise((resolveWait) => setTimeout(resolveWait, 30));
      const armedAfterVideo = readZoomLeaveTimer();
      result.afterVideoOptionArmsCurrentVideo = armedAfterVideo?.mode === "after_video"
        && armedAfterVideo.videoId === "after-video-qa"
        && armedAfterVideo.status === "scheduled"
        && afterVideoButton.getAttribute("aria-pressed") === "true"
        && document.getElementById("zoom-leave-timer-minutes").disabled
        && window.__apiCalls.some((call) => call.url === "/api/zoom/exit-after-video" && call.method === "POST");
      result.afterVideoWaitsForCurrentVideo = readZoomLeaveTimer()?.status === "scheduled";
      window.__apiCalls = [];
      afterVideoButton.click();
      await new Promise((resolveWait) => setTimeout(resolveWait, 30));
      result.afterVideoOptionCanBeCancelled = readZoomLeaveTimer() === null
        && window.__apiCalls.some((call) => call.url === "/api/zoom/exit-after-video" && call.method === "DELETE");

      syncZoomExitAfterVideoState({
        status: "completed",
        video_id: "after-video-qa",
        video_title: "End-after-video QA",
        armed_at: Date.now() / 1000,
        completed_at: Date.now() / 1000,
      });
      result.afterVideoCompletionIsSilent = document.getElementById("zoom-leave-timer-status").classList.contains("hidden")
        && document.getElementById("zoom-leave-timer-status").textContent === "";
      localStorage.removeItem("docflock_zoom_leave_timer");
      window.__mockAfterVideoState = { status: "idle", video_id: null, video_title: null };
      renderZoomLeaveTimer(null);
      document.getElementById("zoom-leave-btn").classList.remove("flash");
      document.getElementById("toast-container").replaceChildren();

      window.__smartScrollTargets = [];
      const nativeScrollTo = window.scrollTo.bind(window);
      window.__playerTopScrollCalls = [];
      window.scrollTo = (...args) => {
        const top = typeof args[0] === "object" ? Number(args[0].top || 0) : Number(args[1] || 0);
        if (top === 0) window.__playerTopScrollCalls.push(args[0]);
        nativeScrollTo(...args);
      };
      updateStatusUI({ state: "playing", title: "Smart scroll QA", current_time: 1, duration: 60, languages: ["en"], queue: [] });
      window.scrollTo(0, document.documentElement.scrollHeight);
      window.__playerTopScrollCalls = [];
      requestPlayerScroll();
      updateStatusUI({ state: "playing", title: "Smart scroll QA", current_time: 1, duration: 60, languages: ["en"], queue: [] });
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      result.playScrollsToPageTop = window.__playerTopScrollCalls.length === 1;

      const statusCard = document.getElementById("status-card");
      const statusRectBeforeReveal = statusCard.getBoundingClientRect();
      window.scrollBy(0, statusRectBeforeReveal.top - 16);
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      window.__playerTopScrollCalls = [];
      requestPlayerScroll();
      updateStatusUI({ state: "playing", title: "Smart scroll QA", current_time: 2, duration: 60, languages: ["en"], queue: [] });
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      result.playAlwaysScrollsToPageTop = window.__playerTopScrollCalls.length === 1;
      window.scrollTo = nativeScrollTo;
      const playerRect = document.getElementById("status-card").getBoundingClientRect();
      const zoomRect = document.querySelector(".zoom-panel").getBoundingClientRect();
      const timerRect = document.getElementById("zoom-leave-timer").getBoundingClientRect();
      const browseRect = document.querySelector(".browse-card").getBoundingClientRect();
      const lectureBrowserRect = document.querySelector(".lecture-browser-layout").getBoundingClientRect();
      const topBarRect = document.querySelector(".top-bar").getBoundingClientRect();
      const appLayoutRect = document.querySelector(".app-layout").getBoundingClientRect();
      result.desktopPlayerAndLibraryLayout = window.innerWidth < 960 || (
        document.getElementById("status-card").parentElement.classList.contains("left-stack")
        && playerRect.top < zoomRect.top
        && Math.abs(playerRect.left - zoomRect.left) <= 1
        && browseRect.width <= 822
      );
      result.desktopZoomControlsAreCompact = window.innerWidth < 960 || zoomRect.height <= 260;
      result.mobileZoomButtonsRetainTouchSize = window.innerWidth >= 960
        || document.getElementById("zoom-join-btn").getBoundingClientRect().height >= 52;
      result.desktopLibraryHasUsefulHeight = window.innerWidth < 960 || lectureBrowserRect.height >= 280;
      result.topBarAlignedWithMainContent = window.innerWidth < 960 || (
        Math.abs(topBarRect.left - appLayoutRect.left) <= 1
        && Math.abs(topBarRect.right - appLayoutRect.right) <= 1
      );
      result.mobileStackingPreserved = window.innerWidth >= 960 || (
        zoomRect.top < timerRect.top
        && timerRect.top < playerRect.top
        && playerRect.top < browseRect.top
      );
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
      Element.prototype.scrollIntoView = window.__originalScrollIntoView;
      return result;
    });

    if (["1578", "1440", "1024", "390"].includes(name)) {
      await page.evaluate(() => {
        updateStatusUI({
          state: "playing",
          title: "What is Meant by Spiritual",
          video_id: "visual-playing-video",
          current_time: 1724,
          duration: 3206,
          languages: ["en", "es"],
          queue: [],
        });
        if (window.innerWidth < 960) {
          document.getElementById("status-card").scrollIntoView({ block: "start" });
        } else {
          window.scrollTo(0, 0);
        }
      });
      await delay(100);
      await page.screenshot({ path: resolve(outputDir, `state-playing-${name}.png`), fullPage: false });
      if (["1024", "390"].includes(name)) {
        await page.evaluate(() => {
          document.getElementById("zoom-leave-after-video").click();
          document.getElementById("zoom-leave-timer").scrollIntoView({ block: "center" });
        });
        await delay(150);
        await page.screenshot({ path: resolve(outputDir, `state-after-video-${name}.png`), fullPage: false });
        await page.evaluate(() => document.getElementById("zoom-leave-after-video").click());
        await delay(50);
        await page.evaluate(() => document.getElementById("toast-container").replaceChildren());
      }
      await page.evaluate(() => {
        updateStatusUI({ state: "stopped" });
        window.scrollTo(0, 0);
      });
    }

    if (name === "1024") {
      assertions.laptopLibraryExtendsBelowFold = await page.evaluate(() => {
        const browseRect = document.querySelector(".browse-card").getBoundingClientRect();
        const playRect = document.querySelector(".play-row").getBoundingClientRect();
        return browseRect.height >= 978 && playRect.bottom > window.innerHeight;
      });
      await page.evaluate(() => {
        updateStatusUI({ state: "stopped" });
        window.scrollTo(0, 0);
        selectItem("2002-01-1");
      });
      await delay(800);
      assertions.laptopSelectionShowsActions = await page.evaluate(() => {
        const rect = document.querySelector(".play-row").getBoundingClientRect();
        return rect.top >= 16 && rect.bottom <= window.innerHeight - 16;
      });
      await page.screenshot({ path: resolve(outputDir, "state-selection-actions-1024.png"), fullPage: false });
      await page.click("#play-btn");
      await delay(800);
      assertions.laptopPlayShowsPlayer = await page.evaluate(() => {
        const rect = document.getElementById("status-card").getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight - 16;
      });
      await page.screenshot({ path: resolve(outputDir, "state-playing-auto-scroll-1024.png"), fullPage: false });
      await page.evaluate(() => {
        stopPolling();
        updateStatusUI({ state: "stopped" });
        window.scrollTo(0, 0);
      });
    }

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
