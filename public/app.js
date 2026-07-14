// === Auth ===
const TOKEN_KEY = "docflock_token";
const EXPIRY_KEY = "docflock_expiry";
const DEFAULT_ZOOM_NAME = "Doc Flock";
const DEFAULT_ZOOM_URL = "https://us02web.zoom.us/j/84886374828?pwd=MkhPSVl3Wjg3cUZJbjlSVTNkM2FjQT09";
const ZOOM_MEETING_NAME_KEY = "docflock_zoom_meeting_name";
const ZOOM_MEETING_URL_KEY = "docflock_zoom_meeting_url";
const ZOOM_LEAVE_TIMER_KEY = "docflock_zoom_leave_timer";
const ZOOM_LEAVE_TIMER_STALE_MS = 60 * 1000;
let statusInterval = null;
let videosCache = [];

function getToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = localStorage.getItem(EXPIRY_KEY);
  if (!token || !expiry || Date.now() > parseInt(expiry, 10)) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    return null;
  }
  return token;
}

async function api(path, options = {}) {
  const token = getToken();
  if (!token) {
    showLogin();
    throw new Error("Not authenticated");
  }
  const resp = await fetch(path, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (resp.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    showLogin();
    throw new Error("Unauthorized");
  }
  return resp;
}

// === Screens ===
const loginScreen = document.getElementById("login-screen");
const appScreen = document.getElementById("app-screen");

function showLogin() {
  loginScreen.classList.remove("hidden");
  appScreen.classList.add("hidden");
  stopPolling();
  stopZoomLeaveTimerClock();
}

function showApp() {
  loginScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  loadVideos();
  loadDelay();
  pollStatus();
  showResumePrompt();
  startZoomLeaveTimerClock();
}

async function loadDelay() {
  try {
    const resp = await api("/api/delay");
    const data = await resp.json();
    currentDelay = data.audio_delay_ms;
    delayValue.textContent = currentDelay + "ms";
  } catch {}
}

// === Login ===
document.getElementById("pin-submit").addEventListener("click", doLogin);
document.getElementById("pin-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});

async function doLogin() {
  const pin = document.getElementById("pin-input").value.trim();
  const errorEl = document.getElementById("pin-error");
  errorEl.classList.add("hidden");
  if (!pin) return;

  try {
    const resp = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      errorEl.textContent = data.error || "Login failed";
      errorEl.classList.remove("hidden");
      return;
    }
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(EXPIRY_KEY, data.expiry.toString());
    document.getElementById("pin-input").value = "";
    showApp();
  } catch {
    errorEl.textContent = "Connection failed";
    errorEl.classList.remove("hidden");
  }
}

// === Tabs ===
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");
const tabBar = document.querySelector(".tab-bar");
const tabStripWrap = document.querySelector(".tab-strip-wrap");
let activeTab = "all";

function updateTabOverflowHint() {
  if (!tabBar || !tabStripWrap) return;
  tabStripWrap.classList.toggle("has-overflow", tabBar.scrollWidth > tabBar.clientWidth + 2);
}

function activateTab(tabName, { focus = false } = {}) {
  activeTab = tabName;
  tabButtons.forEach((button) => {
    const selected = button.dataset.tab === tabName;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  });
  tabPanels.forEach((panel) => {
    const selected = panel.id === `tab-${tabName}`;
    panel.classList.toggle("active", selected);
    panel.hidden = !selected;
  });
  renderActiveTab();
  const activeButton = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (activeButton && tabBar) {
    const target = activeButton.offsetLeft - Math.max(0, (tabBar.clientWidth - activeButton.offsetWidth) / 2);
    tabBar.scrollTo({ left: target, behavior: "smooth" });
  }
  requestAnimationFrame(updateTabOverflowHint);
}

tabButtons.forEach((button, index) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
  button.addEventListener("keydown", (event) => {
    let targetIndex = null;
    if (event.key === "ArrowRight") targetIndex = (index + 1) % tabButtons.length;
    if (event.key === "ArrowLeft") targetIndex = (index - 1 + tabButtons.length) % tabButtons.length;
    if (event.key === "Home") targetIndex = 0;
    if (event.key === "End") targetIndex = tabButtons.length - 1;
    if (targetIndex === null) return;
    event.preventDefault();
    activateTab(tabButtons[targetIndex].dataset.tab, { focus: true });
  });
});

window.addEventListener("resize", updateTabOverflowHint);

// === Video list ===
let selectedId = "";
let ytCache = [];
let clipsCache = [];
let musicCache = [];
const langGroup = document.getElementById("lang-group");
const langCheckboxes = document.getElementById("lang-checkboxes");
const playBtn = document.getElementById("play-btn");
const selectionSummary = document.getElementById("selection-summary");
const playRow = document.querySelector(".play-row");
const mobileSmartScrollMedia = window.matchMedia("(max-width: 720px)");
const reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
let mobilePlayerScrollRequestedAt = 0;

const mediaTabs = {
  all: { listId: "list-all", searchId: "search-all", label: "lezingen", category: "Lecture", lecturePicker: true },
  clips: { listId: "list-clips", searchId: "search-clips", label: "clips", category: "Clip" },
  music: { listId: "list-music", searchId: "search-music", label: "muziek", category: "Music" },
  youtube: { listId: "list-youtube", searchId: "search-youtube", label: "YouTube-items", category: "YouTube" },
};

let lectureArchive = [];
let selectedLectureYear = "";
let openLectureSeriesId = "";
let lectureSearchQuery = "";

const lectureMonthNames = {
  jan: "January",
  feb: "February",
  mar: "March",
  apr: "April",
  may: "May",
  jun: "June",
  jul: "July",
  aug: "August",
  sep: "September",
  oct: "October",
  nov: "November",
  dec: "December",
};

const lectureCollectionDefinitions = {
  volume: { key: "collection-volume", label: "Volume", title: "Volume Series", order: 100 },
  office: { key: "collection-office", label: "Office", title: "Archival Office Visit Series", order: 101 },
  road: { key: "collection-road", label: "Road", title: "On the Road – Talk Series", order: 102 },
  discussion: { key: "collection-discussion", label: "Discussion", title: "Discussion Series with Dr. Hawkins & Wife Susan", order: 103 },
  satsang: { key: "collection-satsang", label: "Satsang", title: "Satsang Questions & Answers", order: 104 },
};

const lectureCollectionByTitle = new Map([
  ["a map of consciousness", "office"],
  ["become that which you are", "road"],
  ["love is a way of being", "road"],
  ["the presence of spiritual awareness", "road"],
  ["verification of spiritual realities", "road"],
  ["progressive levels of consciousness", "road"],
  ["spiritual will", "road"],
  ["permanent inner peace", "discussion"],
  ["what is real success", "discussion"],
  ["how to live your life like a prayer", "discussion"],
  ["what you are changes the world", "discussion"],
  ["improving your relationships", "discussion"],
  ["how to see the reality of life", "discussion"],
  ["what is meant by spiritual", "discussion"],
  ["the importance of family", "discussion"],
  ["q&a session", "satsang"],
]);

function expandLectureDate(value) {
  const match = String(value || "").trim().match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (!match) return String(value || "").trim();
  return `${lectureMonthNames[match[1].toLowerCase()] || match[1]} ${match[2]}`;
}

function stripTrailingLectureDates(value) {
  let title = String(value || "").trim();
  const trailingDate = /\s+\((?:[A-Za-z]{3}\s+)?\d{4}\)\s*$/i;
  while (trailingDate.test(title)) title = title.replace(trailingDate, "").trim();
  return title;
}

function normalizeLectureCollectionTitle(value) {
  return stripTrailingLectureDates(value)
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function resolveLectureCollection(seriesTitle, seriesName) {
  const titleKey = normalizeLectureCollectionTitle(seriesTitle);
  const titleCollection = lectureCollectionByTitle.get(titleKey);
  if (titleCollection) return lectureCollectionDefinitions[titleCollection];

  const normalizedSeries = String(seriesName || "").toLowerCase();
  if (normalizedSeries.includes("volume series")) return lectureCollectionDefinitions.volume;
  if (normalizedSeries.includes("archival office")) return lectureCollectionDefinitions.office;
  if (normalizedSeries.includes("discussion series")) return lectureCollectionDefinitions.discussion;
  if (normalizedSeries.includes("satsang")) return lectureCollectionDefinitions.satsang;
  if (normalizedSeries.includes("on the road") || normalizedSeries.includes("verification series")) {
    return lectureCollectionDefinitions.road;
  }
  return null;
}

function parseLectureMetadata(item) {
  const title = String(item.title || "Untitled lecture").trim();
  const titleMatch = title.match(/^(.*?)\s+(?:—|–|-)\s+(\d+)\s+of\s+(\d+)(?:\s+\(([^)]+)\))?\s*$/i);
  const idValue = String(item.sort_key || item.id || "");
  const idYear = idValue.match(/^(\d{4})/i)?.[1];
  const seriesYear = String(item.series || "").match(/^(\d{4})/)?.[1];
  const titleDates = [...title.matchAll(/\(((?:[A-Za-z]{3}\s+)?\d{4})\)/gi)].map((match) => match[1]);
  const verifiedDate = titleMatch?.[4] || titleDates[0] || "";
  const dateYear = verifiedDate.match(/(\d{4})/)?.[1];
  const year = idYear || seriesYear || dateYear || "Other";
  const fallbackPart = Number(idValue.match(/-(\d+)$/)?.[1] || 1);
  const seriesTitle = stripTrailingLectureDates(titleMatch?.[1]?.trim() || title);
  const partNumber = Number(titleMatch?.[2] || fallbackPart || 1);
  const partTotal = Number(titleMatch?.[3] || Math.max(partNumber, 1));
  const collection = resolveLectureCollection(seriesTitle, item.series);
  const collectionKeepsVerifiedDates = collection?.key === "collection-discussion" || collection?.key === "collection-satsang";
  const dateLabel = expandLectureDate(collection
    ? (collectionKeepsVerifiedDates ? verifiedDate : "")
    : verifiedDate || (year === "Other" ? "Archive" : year));
  return {
    item,
    year,
    archiveKey: collection?.key || year,
    archiveLabel: collection?.label || year,
    archiveTitle: collection?.title || item.series || (year === "Other" ? "Lecture archive" : `${year}: Lecture archive`),
    archiveOrder: collection ? 10000 + collection.order : Number(year) || 9999,
    seriesTitle,
    partNumber,
    partTotal,
    partLabel: `Part ${partNumber} of ${partTotal}`,
    dateLabel,
    searchText: `${title} ${item.series || ""} ${year} ${collection?.label || ""} ${collection?.title || ""} ${seriesTitle} ${dateLabel}`.toLowerCase(),
  };
}

function buildLectureArchive(items) {
  const sections = new Map();
  items.forEach((item) => {
    const meta = parseLectureMetadata(item);
    if (!sections.has(meta.archiveKey)) {
      sections.set(meta.archiveKey, {
        year: meta.archiveKey,
        label: meta.archiveLabel,
        sortOrder: meta.archiveOrder,
        collectionTitle: meta.archiveTitle,
        count: 0,
        groups: [],
        groupMap: new Map(),
      });
    }
    const sectionEntry = sections.get(meta.archiveKey);
    sectionEntry.count += 1;
    const groupKey = `${meta.seriesTitle}\u0000${meta.dateLabel}`;
    if (!sectionEntry.groupMap.has(groupKey)) {
      const group = {
        id: `lecture-series-${meta.archiveKey}-${sectionEntry.groups.length + 1}`,
        title: meta.seriesTitle,
        dateLabel: meta.dateLabel,
        parts: [],
      };
      sectionEntry.groupMap.set(groupKey, group);
      sectionEntry.groups.push(group);
    }
    sectionEntry.groupMap.get(groupKey).parts.push(meta);
  });

  return [...sections.values()]
    .map((entry) => {
      entry.groups.forEach((group) => group.parts.sort((a, b) => a.partNumber - b.partNumber));
      delete entry.groupMap;
      return entry;
    })
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return String(a.label).localeCompare(String(b.label));
    });
}

function createBootstrapIcon(iconName, className = "") {
  const icon = document.createElement("i");
  icon.className = `${className} bi ${iconName}`.trim();
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function setLectureRowState(row, selected) {
  row.classList.toggle("is-selected", selected);
  row.setAttribute("aria-pressed", String(selected));
  const indicator = row.querySelector(".lecture-selection-mark, .lecture-result-mark");
  if (indicator) {
    indicator.classList.remove("bi-check-lg", "bi-play-fill", "bi-chevron-right");
    indicator.classList.add(selected ? "bi-check-lg" : row.dataset.defaultIcon || "bi-play-fill");
  }
}

function createLectureContentHeading({ title, description, year = "", searchable = false }) {
  const heading = document.createElement("div");
  heading.className = "lecture-content-heading";
  const copy = document.createElement("div");
  if (!searchable) {
    const breadcrumb = document.createElement("div");
    breadcrumb.className = "lecture-breadcrumb";
    const root = document.createElement("span");
    root.textContent = "Lectures";
    breadcrumb.appendChild(root);
    breadcrumb.appendChild(createBootstrapIcon("bi-chevron-right"));
    const current = document.createElement("strong");
    current.textContent = year;
    breadcrumb.appendChild(current);
    copy.appendChild(breadcrumb);
  }
  const h2 = document.createElement("h2");
  h2.textContent = title;
  copy.appendChild(h2);
  if (description) {
    const meta = document.createElement("p");
    meta.textContent = description;
    copy.appendChild(meta);
  }
  heading.appendChild(copy);
  return heading;
}

function clearLectureSearch({ focus = false } = {}) {
  const input = document.getElementById("search-all");
  lectureSearchQuery = "";
  if (input) input.value = "";
  renderLecturePicker();
  if (focus) input?.focus();
}

function setupLectureSearch() {
  const input = document.getElementById("search-all");
  const clear = document.getElementById("lecture-search-clear");
  if (input && input.dataset.lectureSearchReady !== "true") {
    input.dataset.lectureSearchReady = "true";
    input.addEventListener("input", () => {
      lectureSearchQuery = input.value;
      if (activeTab === "all") renderLecturePicker();
    });
  }
  if (clear && clear.dataset.lectureSearchReady !== "true") {
    clear.dataset.lectureSearchReady = "true";
    clear.addEventListener("click", () => clearLectureSearch({ focus: true }));
  }
}

function createLectureResultRow(meta) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "lecture-result-row";
  row.dataset.id = meta.item.id;
  row.dataset.defaultIcon = "bi-chevron-right";
  const year = document.createElement("span");
  year.className = "lecture-result-year";
  year.textContent = meta.archiveLabel;
  const copy = document.createElement("span");
  copy.className = "lecture-result-copy";
  const title = document.createElement("strong");
  title.textContent = meta.seriesTitle;
  const detail = document.createElement("span");
  detail.textContent = [meta.partLabel, meta.dateLabel].filter(Boolean).join(" · ");
  copy.appendChild(title);
  copy.appendChild(detail);
  const mark = createBootstrapIcon("bi-chevron-right", "lecture-result-mark");
  row.appendChild(year);
  row.appendChild(copy);
  row.appendChild(mark);
  setLectureRowState(row, meta.item.id === selectedId);
  row.addEventListener("click", () => selectItem(meta.item.id));
  return row;
}

function createLectureSeriesCard(group) {
  const card = document.createElement("article");
  const open = group.id === openLectureSeriesId;
  card.className = `lecture-series-card${open ? " is-open" : ""}`;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "lecture-series-trigger";
  trigger.setAttribute("aria-expanded", String(open));
  trigger.setAttribute("aria-controls", `parts-${group.id}`);

  const copy = document.createElement("span");
  copy.className = "lecture-series-copy";
  const title = document.createElement("strong");
  title.textContent = group.title;
  const date = document.createElement("span");
  date.textContent = group.dateLabel;
  copy.appendChild(title);
  if (group.dateLabel) copy.appendChild(date);

  const meta = document.createElement("span");
  meta.className = "lecture-series-meta";
  const count = document.createElement("span");
  count.textContent = `${group.parts.length} ${group.parts.length === 1 ? "part" : "parts"}`;
  meta.appendChild(count);
  meta.appendChild(createBootstrapIcon(open ? "bi-chevron-up" : "bi-chevron-down"));
  trigger.appendChild(copy);
  trigger.appendChild(meta);
  trigger.addEventListener("click", () => {
    openLectureSeriesId = open ? "" : group.id;
    renderLecturePicker();
  });
  card.appendChild(trigger);

  if (open) {
    const parts = document.createElement("div");
    parts.className = "lecture-part-list";
    parts.id = `parts-${group.id}`;
    group.parts.forEach((part) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "lecture-part-row";
      row.dataset.id = part.item.id;
      row.dataset.defaultIcon = "bi-play-fill";
      row.title = part.item.title;
      const number = document.createElement("span");
      number.className = "lecture-part-number";
      number.textContent = String(part.partNumber);
      const rowCopy = document.createElement("span");
      rowCopy.className = "lecture-part-copy";
      const partTitle = document.createElement("strong");
      partTitle.textContent = part.partLabel;
      const topic = document.createElement("span");
      topic.textContent = group.title;
      rowCopy.appendChild(partTitle);
      rowCopy.appendChild(topic);
      const mark = createBootstrapIcon("bi-play-fill", "lecture-selection-mark");
      row.appendChild(number);
      row.appendChild(rowCopy);
      row.appendChild(mark);
      setLectureRowState(row, part.item.id === selectedId);
      row.addEventListener("click", () => selectItem(part.item.id));
      parts.appendChild(row);
    });
    card.appendChild(parts);
  }
  return card;
}

function renderLecturePicker() {
  const yearList = document.getElementById("lecture-year-list");
  const browser = document.getElementById("list-all");
  const clear = document.getElementById("lecture-search-clear");
  if (!yearList || !browser) return;
  yearList.replaceChildren();
  browser.replaceChildren();

  const normalizedQuery = lectureSearchQuery.trim().toLowerCase();
  clear?.classList.toggle("hidden", !normalizedQuery);

  if (lectureArchive.length === 0) {
    const empty = document.createElement("div");
    empty.className = "lecture-empty-state";
    empty.textContent = "No lectures available";
    browser.appendChild(empty);
    return;
  }

  if (!lectureArchive.some((entry) => entry.year === selectedLectureYear)) {
    selectedLectureYear = lectureArchive[0].year;
    openLectureSeriesId = "";
  }

  const appendNavigationGroup = (label, entries) => {
    if (entries.length === 0) return;
    const group = document.createElement("div");
    group.className = "lecture-nav-group";
    const heading = document.createElement("div");
    heading.className = "lecture-year-heading";
    heading.textContent = label;
    const buttons = document.createElement("div");
    buttons.className = "lecture-nav-buttons";
    entries.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = entry.label;
      const active = entry.year === selectedLectureYear && !normalizedQuery;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => {
        selectedLectureYear = entry.year;
        openLectureSeriesId = "";
        lectureSearchQuery = "";
        const input = document.getElementById("search-all");
        if (input) input.value = "";
        renderLecturePicker();
      });
      buttons.appendChild(button);
    });
    group.appendChild(heading);
    group.appendChild(buttons);
    yearList.appendChild(group);
  };
  appendNavigationGroup("Years", lectureArchive.filter((entry) => /^\d{4}$/.test(entry.year)));
  appendNavigationGroup("Collections", lectureArchive.filter((entry) => !/^\d{4}$/.test(entry.year)));

  if (normalizedQuery) {
    const results = lectureArchive.flatMap((entry) => entry.groups.flatMap((group) => group.parts))
      .filter((meta) => meta.searchText.includes(normalizedQuery));
    browser.appendChild(createLectureContentHeading({
      title: "Search results",
      description: `${results.length} ${results.length === 1 ? "lecture" : "lectures"} for “${lectureSearchQuery.trim()}”`,
      searchable: true,
    }));
    if (results.length > 0) {
      const list = document.createElement("div");
      list.className = "lecture-result-list";
      results.forEach((meta) => list.appendChild(createLectureResultRow(meta)));
      browser.appendChild(list);
    } else {
      const empty = document.createElement("div");
      empty.className = "lecture-empty-state";
      empty.appendChild(createBootstrapIcon("bi-search"));
      const title = document.createElement("strong");
      title.textContent = "No lectures found";
      const detail = document.createElement("span");
      detail.textContent = "Try a title, topic, or year such as “2002”.";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Clear search";
      button.addEventListener("click", () => clearLectureSearch({ focus: true }));
      empty.appendChild(title);
      empty.appendChild(detail);
      empty.appendChild(button);
      browser.appendChild(empty);
    }
    return;
  }

  const currentYear = lectureArchive.find((entry) => entry.year === selectedLectureYear) || lectureArchive[0];
  const heading = createLectureContentHeading({
    title: currentYear.collectionTitle,
    description: "",
    year: currentYear.label,
  });
  const collapse = document.createElement("button");
  collapse.type = "button";
  collapse.className = "lecture-collapse-all";
  collapse.appendChild(createBootstrapIcon("bi-arrows-collapse"));
  const collapseLabel = document.createElement("span");
  collapseLabel.textContent = "Collapse";
  collapse.appendChild(collapseLabel);
  collapse.addEventListener("click", () => {
    openLectureSeriesId = "";
    renderLecturePicker();
  });
  heading.appendChild(collapse);
  browser.appendChild(heading);

  const seriesList = document.createElement("div");
  seriesList.className = "lecture-series-list";
  currentYear.groups.forEach((group) => seriesList.appendChild(createLectureSeriesCard(group)));
  browser.appendChild(seriesList);
}

function getTabItems(tabName) {
  if (tabName === "all") return videosCache;
  if (tabName === "clips") return clipsCache;
  if (tabName === "music") return musicCache;
  if (tabName === "youtube") return ytCache;
  return [];
}

function getSelectedMedia() {
  for (const [tabName, config] of Object.entries(mediaTabs)) {
    const item = getTabItems(tabName).find((entry) => entry.id === selectedId);
    if (item) return { item, category: config.category };
  }
  return null;
}

function mobileElementRangeIsVisible(startElement, endElement = startElement) {
  const viewportPadding = 16;
  const startRect = startElement.getBoundingClientRect();
  const endRect = endElement.getBoundingClientRect();
  return startRect.top >= viewportPadding && endRect.bottom <= window.innerHeight - viewportPadding;
}

function scrollMobileRangeIntoView(startElement, endElement = startElement) {
  if (!mobileSmartScrollMedia.matches || !startElement) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!mobileSmartScrollMedia.matches || mobileElementRangeIsVisible(startElement, endElement)) return;
      startElement.scrollIntoView({
        behavior: reducedMotionMedia.matches ? "auto" : "smooth",
        block: "start",
      });
    });
  });
}

function requestMobilePlayerScroll() {
  if (!mobileSmartScrollMedia.matches) return;
  mobilePlayerScrollRequestedAt = Date.now();
}

function scrollToMobilePlayerWhenReady(card, state) {
  if (!mobilePlayerScrollRequestedAt) return;
  if (Date.now() - mobilePlayerScrollRequestedAt > 15000) {
    mobilePlayerScrollRequestedAt = 0;
    return;
  }
  if (!mobileSmartScrollMedia.matches || !["loading", "playing", "paused"].includes(state)) return;
  mobilePlayerScrollRequestedAt = 0;
  scrollMobileRangeIntoView(card);
}

function selectItem(id) {
  selectedId = id;
  document.querySelectorAll(".item-list-row, .lecture-part-row, .lecture-result-row").forEach((row) => {
    const selected = row.dataset.id === id;
    if (row.classList.contains("item-list-row")) {
      row.classList.toggle("selected", selected);
      row.setAttribute("aria-pressed", String(selected));
    } else {
      setLectureRowState(row, selected);
    }
  });
  onSelectionChange();
  scrollMobileRangeIntoView(selectionSummary, playRow);
}

function getSelectedId() {
  return selectedId;
}

function renderList(listId, items, opts = {}) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = "";
  let currentSeries = "";
  for (const item of items) {
    if (opts.grouped && item.series && item.series !== currentSeries) {
      currentSeries = item.series;
      const header = document.createElement("div");
      header.className = "item-list-group";
      const title = document.createElement("span");
      title.textContent = currentSeries;
      const chevron = document.createElement("i");
      chevron.className = "bi bi-chevron-up";
      chevron.setAttribute("aria-hidden", "true");
      header.appendChild(title);
      header.appendChild(chevron);
      list.appendChild(header);
    }
    const row = document.createElement("button");
    row.type = "button";
    row.className = "item-list-row";
    row.dataset.id = item.id;
    row.dataset.search = (item.title + " " + (item.series || "")).toLowerCase();
    row.setAttribute("aria-pressed", String(item.id === selectedId));
    const label = document.createElement("span");
    label.className = "item-row-label";
    label.textContent = opts.showLangs && item.languages
      ? item.title + " [" + item.languages.map((l) => l.toUpperCase()).join(", ") + "]"
      : item.title;
    const indicator = document.createElement("i");
    indicator.className = "item-selected-indicator bi bi-check-lg";
    indicator.setAttribute("aria-hidden", "true");
    row.appendChild(label);
    row.appendChild(indicator);
    if (item.id === selectedId) row.classList.add("selected");
    row.addEventListener("click", () => selectItem(item.id));
    list.appendChild(row);
  }
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "item-list-empty";
    empty.textContent = "No items available";
    list.appendChild(empty);
  }
}

function applySearchFilter(searchId, listId, label) {
  const input = document.getElementById(searchId);
  const list = document.getElementById(listId);
  if (!input || !list) return;
  const query = input.value.toLowerCase().trim();
  const rows = [...list.querySelectorAll(".item-list-row")];
  const groups = list.querySelectorAll(".item-list-group");
  let visibleRows = 0;
  rows.forEach((row) => {
    const visible = row.dataset.search.includes(query);
    row.hidden = !visible;
    if (visible) visibleRows += 1;
  });
  groups.forEach((group) => {
    let next = group.nextElementSibling;
    let anyVisible = false;
    while (next && !next.classList.contains("item-list-group")) {
      if (next.classList.contains("item-list-row") && !next.hidden) {
        anyVisible = true;
      }
      next = next.nextElementSibling;
    }
    group.hidden = !anyVisible;
  });

  let empty = list.querySelector(".item-search-empty");
  if (query && visibleRows === 0) {
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "item-search-empty";
      const message = document.createElement("p");
      message.className = "item-search-empty-message";
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "item-search-clear";
      clear.textContent = "Zoekopdracht wissen";
      clear.addEventListener("click", () => {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      });
      empty.appendChild(message);
      empty.appendChild(clear);
      list.appendChild(empty);
    }
    empty.querySelector(".item-search-empty-message").textContent = `Geen ${label} gevonden voor ‘${input.value.trim()}’`;
    empty.hidden = false;
  } else if (empty) {
    empty.hidden = true;
  }
  const searchEmpty = Boolean(query && visibleRows === 0);
  list.classList.toggle("search-empty", searchEmpty);
  list.closest(".tab-panel")?.classList.toggle("search-empty-panel", searchEmpty);
  list.closest(".browse-card")?.classList.toggle("search-empty-state", searchEmpty);
}

function setupSearch(searchId, listId, label) {
  const input = document.getElementById(searchId);
  if (!input || input.dataset.searchReady === "true") return;
  input.dataset.searchReady = "true";
  input.addEventListener("input", () => applySearchFilter(searchId, listId, label));
}

function renderActiveTab() {
  const config = mediaTabs[activeTab];
  if (!config) return;
  Object.values(mediaTabs).forEach(({ listId }) => {
    if (listId !== config.listId) {
      const list = document.getElementById(listId);
      if (list) list.replaceChildren();
    }
  });
  if (config.lecturePicker) {
    setupLectureSearch();
    renderLecturePicker();
    return;
  }
  document.getElementById("lecture-year-list")?.replaceChildren();
  renderList(config.listId, getTabItems(activeTab), { grouped: config.grouped });
  setupSearch(config.searchId, config.listId, config.label);
  applySearchFilter(config.searchId, config.listId, config.label);
}

async function loadVideos() {
  const requests = [
    ["all", "/api/videos"],
    ["clips", "/api/clips"],
    ["music", "/api/music"],
    ["youtube", "/api/youtube"],
  ];
  const results = await Promise.all(requests.map(async ([tabName, path]) => {
    try {
      const response = await api(path);
      return [tabName, await response.json()];
    } catch {
      return [tabName, []];
    }
  }));
  results.forEach(([tabName, items]) => {
    if (tabName === "all") videosCache = items;
    if (tabName === "clips") clipsCache = items;
    if (tabName === "music") musicCache = items;
    if (tabName === "youtube") ytCache = items;
    updateTabCount(tabName, items.length);
  });
  lectureArchive = buildLectureArchive(videosCache);
  if (!lectureArchive.some((entry) => entry.year === selectedLectureYear)) {
    selectedLectureYear = lectureArchive[0]?.year || "";
    openLectureSeriesId = "";
  }
  renderActiveTab();
  onSelectionChange();
  requestAnimationFrame(updateTabOverflowHint);
}

function updateTabCount(tab, count) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (!btn) return;
  let span = btn.querySelector(".tab-count");
  if (!span) {
    span = document.createElement("span");
    span.className = "tab-count";
    btn.appendChild(span);
  }
  span.textContent = `(${count})`;
}

function onSelectionChange() {
  const videoId = getSelectedId();
  if (!videoId) {
    langGroup.classList.add("hidden");
    selectionSummary.classList.add("hidden");
    playBtn.disabled = true;
    queueBtn.disabled = true;
    return;
  }

  const selected = getSelectedMedia();
  const video = selected?.item;
  if (!video) {
    selectionSummary.classList.add("hidden");
    langGroup.classList.add("hidden");
    playBtn.disabled = true;
    queueBtn.disabled = true;
    return;
  }
  selectionSummary.textContent = `Selected: ${video.title} · ${selected.category}`;
  selectionSummary.classList.remove("hidden");
  if (Array.isArray(video.languages) && video.languages.length > 0) {
    langCheckboxes.innerHTML = "";
    for (const lang of video.languages) {
      const label = document.createElement("label");
      label.className = "lang-option";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = lang;
      cb.name = "lang";
      cb.setAttribute("aria-label", `${lang.toUpperCase()} subtitles`);
      if (lang === "en") cb.checked = true;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(lang.toUpperCase()));
      langCheckboxes.appendChild(label);
    }
    langGroup.classList.remove("hidden");
  } else {
    langGroup.classList.add("hidden");
  }
  playBtn.disabled = false;
  queueBtn.disabled = false;
}

// === Live language switch (instant apply — no Apply button) ===
function applyLiveLanguages() {
  const chips = document.querySelectorAll("#live-lang-checkboxes .lang-chip");
  const selected = [];
  chips.forEach((chip) => {
    if (chip.classList.contains("active")) selected.push(chip.dataset.lang);
  });
  api("/api/languages", {
    method: "POST",
    body: JSON.stringify({ languages: selected }),
  })
    .then(() => {
      fetchStatus();
      showToast("Subtitles: " + (selected.length ? selected.map((l) => l.toUpperCase()).join(" + ") : "OFF"));
    })
    .catch(() => {});
}

// === YouTube URL ===
document.getElementById("yt-play-btn").addEventListener("click", playYouTubeUrl);
document.getElementById("yt-url").addEventListener("keydown", (e) => {
  if (e.key === "Enter") playYouTubeUrl();
});

async function playYouTubeUrl() {
  const input = document.getElementById("yt-url");
  const url = input.value.trim();
  if (!url) return;

  const btn = document.getElementById("yt-play-btn");
  const statusEl = document.getElementById("yt-status");
  btn.disabled = true;
  statusEl.textContent = "Downloading...";
  statusEl.classList.remove("hidden");
  hideError();

  selectedId = "";

  try {
    await api("/api/play-url", {
      method: "POST",
      body: JSON.stringify({ url }),
    });

    const pollDl = setInterval(async () => {
      try {
        const resp = await api("/api/play-url/status");
        const data = await resp.json();
        if (data.state === "already" || data.state === "done") {
          clearInterval(pollDl);
          const msg =
            data.state === "already"
              ? `"${data.title}" is already downloaded.`
              : `Downloaded "${data.title}"!`;
          statusEl.innerHTML = `${msg} <a href="#" id="yt-play-link">Click here to play it!</a>`;
          document.getElementById("yt-play-link").addEventListener("click", async (e) => {
            e.preventDefault();
            try {
              await api("/api/play", {
                method: "POST",
                body: JSON.stringify({ video_id: data.video_id, languages: ["en"] }),
              });
              statusEl.classList.add("hidden");
              pollStatus();
              showToast("Now playing: " + data.title);
            } catch {}
          });
          input.value = "";
          btn.disabled = false;
          loadVideos();
        } else if (data.state === "error") {
          clearInterval(pollDl);
          showError(data.error || "Download failed");
          statusEl.classList.add("hidden");
          btn.disabled = false;
        } else {
          statusEl.textContent = data.title ? `Downloading: ${data.title}` : "Downloading...";
        }
      } catch {}
    }, 2000);
  } catch (e) {
    showError(e.message);
    statusEl.classList.add("hidden");
    btn.disabled = false;
  }
}

// === Queue ===
const queueBtn = document.getElementById("queue-btn");
const queueCard = document.getElementById("queue-card");
const queueList = document.getElementById("queue-list");
const queueCount = document.getElementById("queue-count");

queueBtn.addEventListener("click", addToQueue);
document.getElementById("queue-clear").addEventListener("click", clearQueue);

async function addToQueue() {
  const videoId = getSelectedId();
  if (!videoId) return;
  const selected = [...document.querySelectorAll('input[name="lang"]:checked')].map((cb) => cb.value);
  try {
    const resp = await api("/api/queue/add", {
      method: "POST",
      body: JSON.stringify({ video_id: videoId, languages: selected }),
    });
    const data = await resp.json();
    updateQueueUI(data.queue);
    showToast("Added to queue");
  } catch {}
}

async function removeFromQueue(videoId) {
  try {
    const resp = await api("/api/queue/remove", {
      method: "POST",
      body: JSON.stringify({ video_id: videoId }),
    });
    const data = await resp.json();
    updateQueueUI(data.queue);
  } catch {}
}

async function clearQueue() {
  try {
    const resp = await api("/api/queue/clear", { method: "POST" });
    const data = await resp.json();
    updateQueueUI(data.queue);
    showToast("Queue cleared");
  } catch {}
}

function updateQueueUI(queue) {
  if (!queue || queue.length === 0) {
    queueCard.classList.add("hidden");
    queueCount.textContent = "0";
    return;
  }
  queueCard.classList.remove("hidden");
  queueCount.textContent = queue.length;
  queueList.innerHTML = "";
  queue.forEach((item, i) => {
    const li = document.createElement("li");
    const pos = document.createElement("i");
    pos.className = "queue-pos bi bi-list";
    pos.setAttribute("aria-hidden", "true");
    const span = document.createElement("span");
    span.textContent = item.title;
    const btn = document.createElement("button");
    btn.className = "queue-remove";
    const removeIcon = document.createElement("i");
    removeIcon.className = "bi bi-x-lg";
    removeIcon.setAttribute("aria-hidden", "true");
    btn.appendChild(removeIcon);
    btn.title = "Remove";
    btn.addEventListener("click", () => removeFromQueue(item.video_id));
    li.appendChild(pos);
    li.appendChild(span);
    li.appendChild(btn);
    queueList.appendChild(li);
  });
}

// === Player ===
playBtn.addEventListener("click", playVideo);
document.getElementById("pause-btn").addEventListener("click", togglePause);
document.getElementById("stop-btn").addEventListener("click", stopPlayback);
document.getElementById("prev-btn").addEventListener("click", async () => {
  try {
    await api("/api/prev", { method: "POST" });
    fetchStatus();
  } catch {}
});
document.getElementById("next-btn").addEventListener("click", async () => {
  try {
    await api("/api/next", { method: "POST" });
    fetchStatus();
  } catch {}
});
document.getElementById("autoplay-cb").addEventListener("change", async () => {
  try {
    await api("/api/autoplay", { method: "POST" });
    fetchStatus();
  } catch {}
});
document.getElementById("loop-cb").addEventListener("change", async () => {
  try {
    await api("/api/loop", { method: "POST" });
    fetchStatus();
  } catch {}
});

// Audio sync
const delayValue = document.getElementById("delay-value");
let currentDelay = 0;

async function adjustDelay(delta) {
  currentDelay += delta;
  delayValue.textContent = currentDelay + "ms";
  try {
    await api("/api/delay", {
      method: "POST",
      body: JSON.stringify({ ms: currentDelay }),
    });
  } catch {}
}

document.getElementById("sync-m50").addEventListener("click", () => adjustDelay(-50));
document.getElementById("sync-m10").addEventListener("click", () => adjustDelay(-10));
document.getElementById("sync-m5").addEventListener("click", () => adjustDelay(-5));
document.getElementById("sync-p5").addEventListener("click", () => adjustDelay(5));
document.getElementById("sync-p10").addEventListener("click", () => adjustDelay(10));
document.getElementById("sync-p50").addEventListener("click", () => adjustDelay(50));
document.getElementById("skip-back-30").addEventListener("click", () => skip(-30));
document.getElementById("skip-back-10").addEventListener("click", () => skip(-10));
document.getElementById("skip-fwd-10").addEventListener("click", () => skip(10));
document.getElementById("skip-fwd-30").addEventListener("click", () => skip(30));

// Seekable progress bar
document.getElementById("progress-bar").addEventListener("click", (e) => {
  const bar = e.currentTarget;
  const rect = bar.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const duration = lastStatus?.duration;
  if (duration) {
    seek(pct * duration);
  }
});

let lastStatus = null;

async function playVideo() {
  const videoId = getSelectedId();
  if (!videoId) return;

  const selected = [...document.querySelectorAll('input[name="lang"]:checked')].map((cb) => cb.value);

  playBtn.disabled = true;
  hideError();

  try {
    const resp = await api("/api/play", {
      method: "POST",
      body: JSON.stringify({ video_id: videoId, languages: selected }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      showError(data.error || "Playback failed");
      return;
    }
    requestMobilePlayerScroll();
    pollStatus();
    showToast("Now playing: " + (data.title || ""));
  } catch (e) {
    showError(e.message);
  } finally {
    playBtn.disabled = false;
  }
}

async function togglePause() {
  try {
    await api("/api/pause", { method: "POST" });
  } catch {}
}

async function stopPlayback() {
  try {
    await api("/api/stop", { method: "POST" });
    updateStatusUI({ state: "stopped" });
    showToast("Playback stopped");
  } catch {}
}

async function seek(position) {
  if (lastStatus) {
    lastStatus.current_time = position;
    updateStatusUI(lastStatus);
  }
  try {
    await api("/api/seek", {
      method: "POST",
      body: JSON.stringify({ position }),
    });
  } catch {}
}

async function skip(offset) {
  if (lastStatus && lastStatus.current_time != null) {
    lastStatus.current_time = Math.max(0, lastStatus.current_time + offset);
    updateStatusUI(lastStatus);
  }
  try {
    await api("/api/skip", {
      method: "POST",
      body: JSON.stringify({ offset }),
    });
  } catch {}
}

// === Status polling ===
function pollStatus() {
  stopPolling();
  fetchStatus();
  fetchZoomState();
  statusInterval = setInterval(() => {
    fetchStatus();
    fetchZoomState();
  }, 3000);
  startLocalTimer();
}

async function fetchZoomState() {
  const connectionStatus = document.getElementById("zoom-connection-status");
  const connectionText = document.getElementById("zoom-connection-text");
  try {
    const resp = await api("/api/zoom/state");
    const state = await resp.json();
    const joined = state.in_meeting === true || Boolean(state.bridge_connected && state.can_read_state);
    const presenceKnown = typeof state.in_meeting === "boolean" || Boolean(state.bridge_connected && state.can_read_state);
    connectionStatus.classList.remove("ready", "waiting", "unavailable");
    connectionStatus.classList.add(joined ? "ready" : "waiting");
    connectionText.textContent = joined
      ? "Hoge Heer is ready"
      : presenceKnown ? "Not in Zoom yet" : "Checking Zoom…";
    reconcileZoomLeaveTimerWithState(joined, presenceKnown);

    if (joined && state.can_read_state) {
      document.querySelector("#zoom-mic-btn span").textContent = state.audio_on ? "Sound On" : "Sound Off";
      document.querySelector("#zoom-cam-btn span").textContent = state.video_on ? "Video On" : "Video Off";
    }
  } catch {
    connectionStatus.classList.remove("ready", "waiting");
    connectionStatus.classList.add("unavailable");
    connectionText.textContent = "Zoom unavailable";
  }
}

let localTimer = null;

function startLocalTimer() {
  stopLocalTimer();
  localTimer = setInterval(() => {
    if (lastStatus && lastStatus.state === "playing" && lastStatus.current_time != null) {
      lastStatus.current_time += 1;
      updateStatusUI(lastStatus);
    }
  }, 1000);
}

function stopLocalTimer() {
  if (localTimer) {
    clearInterval(localTimer);
    localTimer = null;
  }
}

function stopPolling() {
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
  stopLocalTimer();
}

let backendDown = false;
let failCount = 0;
const FAIL_THRESHOLD = 3;

async function fetchStatus() {
  try {
    const resp = await api("/api/status");
    const data = await resp.json();
    lastStatus = data;
    updateStatusUI(data);
    failCount = 0;
    if (backendDown) {
      backendDown = false;
      hideBackendOffline();
    }
  } catch {
    failCount++;
    if (!backendDown && failCount >= FAIL_THRESHOLD) {
      backendDown = true;
      showBackendOffline();
    }
  }
}

function showBackendOffline() {
  let el = document.getElementById("backend-offline");
  if (!el) {
    el = document.createElement("div");
    el.id = "backend-offline";
    el.className = "backend-offline";
    el.innerHTML = `
      <div class="offline-box">
        <h2>Backend is turned off.</h2>
        <p><strong>Step 1:</strong> Pray</p>
        <p><strong>Step 2:</strong> Ask Jesse or Bram to turn it back on.</p>
      </div>
    `;
    document.body.appendChild(el);
  }
  el.classList.remove("hidden");
}

function hideBackendOffline() {
  const el = document.getElementById("backend-offline");
  if (el) el.classList.add("hidden");
}

// === Resume state ===
const RESUME_KEY = "docflock_resume";

function saveResumeState(data) {
  if (data.state === "playing" || data.state === "paused") {
    localStorage.setItem(
      RESUME_KEY,
      JSON.stringify({
        video_id: data.video_id,
        title: data.title,
        current_time: data.current_time,
        languages: data.languages || [],
        saved_at: Date.now(),
      })
    );
  }
}

function showResumePrompt() {
  const raw = localStorage.getItem(RESUME_KEY);
  if (!raw) return;
  try {
    const resume = JSON.parse(raw);
    if (Date.now() - resume.saved_at > 7 * 24 * 60 * 60 * 1000) return;
    if (!resume.video_id || !resume.current_time) return;

    const time = formatTime(resume.current_time);
    const el = document.getElementById("resume-prompt");
    const textEl = document.getElementById("resume-text");
    textEl.textContent = `Continue "${resume.title}" from ${time}`;
    el.classList.remove("hidden");

    document.getElementById("resume-btn").onclick = async () => {
      el.classList.add("hidden");
      try {
        await api("/api/play", {
          method: "POST",
          body: JSON.stringify({ video_id: resume.video_id, languages: resume.languages }),
        });
        setTimeout(async () => {
          await api("/api/seek", {
            method: "POST",
            body: JSON.stringify({ position: resume.current_time }),
          });
        }, 2000);
        pollStatus();
        showToast("Resumed: " + resume.title);
      } catch {}
    };

    document.getElementById("resume-dismiss").onclick = () => {
      el.classList.add("hidden");
      localStorage.removeItem(RESUME_KEY);
    };
  } catch {}
}

function updateStatusUI(data) {
  const card = document.getElementById("status-card");
  const titleEl = document.getElementById("status-title");
  const stateEl = document.getElementById("status-state");
  const langsEl = document.getElementById("status-langs");
  const progressFill = document.getElementById("progress-fill");
  const timeCurrent = document.getElementById("time-current");
  const timeTotal = document.getElementById("time-total");
  const pauseIcon = document.getElementById("pause-icon");
  const playIcon = document.getElementById("play-icon");

  if (data.state === "stopped" && !data.title) {
    card.classList.add("hidden");
    return;
  }

  card.classList.remove("hidden");
  titleEl.textContent = data.title || "Loading...";

  const stateLabels = {
    playing: "Playing",
    paused: "Paused",
    stopped: "Stopped",
    loading: "Loading...",
  };
  stateEl.textContent = stateLabels[data.state] || data.state;
  stateEl.className = `status-state ${data.state}`;

  if (data.languages && data.languages.length > 0) {
    langsEl.textContent = data.languages.map((l) => l.toUpperCase()).join(" + ");
  } else {
    langsEl.textContent = "";
  }

  if (data.duration && data.current_time != null) {
    const pct = Math.min((data.current_time / data.duration) * 100, 100);
    progressFill.style.width = `${pct}%`;
    timeCurrent.textContent = formatTime(data.current_time);
    timeTotal.textContent = formatTime(data.duration);
  } else {
    progressFill.style.width = "0%";
    timeCurrent.textContent = formatTime(data.current_time);
    timeTotal.textContent = formatTime(data.duration);
  }

  if (data.state === "paused") {
    pauseIcon.classList.add("hidden");
    playIcon.classList.remove("hidden");
  } else {
    pauseIcon.classList.remove("hidden");
    playIcon.classList.add("hidden");
  }

  if (data.autoplay !== undefined) {
    document.getElementById("autoplay-cb").checked = data.autoplay;
  }
  if (data.loop !== undefined) {
    document.getElementById("loop-cb").checked = data.loop;
  }

  // Update document title
  if (data.state === "playing" && data.title) {
    document.title = "\u25B6 " + data.title + " \u2014 Doc Remote";
  } else if (data.state === "paused" && data.title) {
    document.title = "\u23F8 " + data.title + " \u2014 Doc Remote";
  } else {
    document.title = "Doc Remote";
  }

  // Live subtitle chips (instant apply)
  const liveLangGroup = document.getElementById("live-lang-group");
  const liveLangCbs = document.getElementById("live-lang-checkboxes");
  if (data.available_languages && data.available_languages.length > 0 && data.state !== "stopped") {
    const availKey = data.available_languages.join(",");
    const activeKey = (data.languages || []).join(",");
    const currentKey = liveLangGroup.dataset.avail + "|" + liveLangGroup.dataset.active;
    const newKey = availKey + "|" + activeKey;
    if (currentKey !== newKey) {
      liveLangGroup.dataset.avail = availKey;
      liveLangGroup.dataset.active = activeKey;
      liveLangCbs.innerHTML = "";
      for (const lang of data.available_languages) {
        const chip = document.createElement("button");
        chip.className = "lang-chip";
        chip.dataset.lang = lang;
        chip.textContent = lang.toUpperCase();
        if (data.languages && data.languages.includes(lang)) {
          chip.classList.add("active");
        }
        chip.addEventListener("click", () => {
          chip.classList.toggle("active");
          applyLiveLanguages();
        });
        liveLangCbs.appendChild(chip);
      }
    }
    liveLangGroup.classList.remove("hidden");
  } else {
    liveLangGroup.classList.add("hidden");
  }

  if (data.error) showError(data.error);

  if (data.queue !== undefined) updateQueueUI(data.queue);

  saveResumeState(data);
  scrollToMobilePlayerWhenReady(card, data.state);
}

function formatTime(seconds) {
  if (seconds == null) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function showError(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError() {
  document.getElementById("error-msg").classList.add("hidden");
}

// === Toast ===
function showToast(msg) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// === Keyboard Shortcuts ===
const shortcutsOverlay = document.getElementById("shortcuts-overlay");
const shortcutsClose = document.getElementById("shortcuts-close");
let shortcutsReturnFocus = null;

function openShortcuts() {
  if (!shortcutsOverlay.classList.contains("hidden")) return;
  shortcutsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  shortcutsOverlay.classList.remove("hidden");
  document.body.classList.add("modal-open");
  shortcutsClose.focus();
}

function closeShortcuts() {
  if (shortcutsOverlay.classList.contains("hidden")) return;
  shortcutsOverlay.classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (shortcutsReturnFocus?.isConnected) shortcutsReturnFocus.focus();
  shortcutsReturnFocus = null;
}

function getShortcutDialogFocusables() {
  return [...shortcutsOverlay.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => !element.hidden && element.getClientRects().length > 0);
}

shortcutsClose.addEventListener("click", closeShortcuts);
shortcutsOverlay.addEventListener("click", (event) => {
  if (event.target === shortcutsOverlay) closeShortcuts();
});
shortcutsOverlay.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const focusables = getShortcutDialogFocusables();
  if (focusables.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

document.addEventListener("keydown", (e) => {
  if (!shortcutsOverlay.classList.contains("hidden")) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeShortcuts();
    }
    return;
  }
  // Don't capture when typing in inputs
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
  // Don't capture if login screen is showing
  if (!getToken()) return;

  const key = e.key;

  if (key === "?") {
    e.preventDefault();
    openShortcuts();
    return;
  }

  if (key === " ") {
    e.preventDefault();
    togglePause();
    return;
  }

  if (key === "ArrowLeft") {
    e.preventDefault();
    skip(e.shiftKey ? -30 : -10);
    return;
  }

  if (key === "ArrowRight") {
    e.preventDefault();
    skip(e.shiftKey ? 30 : 10);
    return;
  }

  if (key === "n" || key === "N") {
    document.getElementById("next-btn").click();
    return;
  }

  if (key === "p" || key === "P") {
    document.getElementById("prev-btn").click();
    return;
  }

  if (key === "m" || key === "M") {
    zoomMicBtn.click();
    return;
  }

  if (key === "v" && !e.ctrlKey && !e.metaKey) {
    zoomCamBtn.click();
    return;
  }
});

// === Refresh ===
document.getElementById("refresh-btn").addEventListener("click", () => {
  location.reload(true);
});

document.getElementById("header-settings-btn").addEventListener("click", () => {
  openShortcuts();
});

// === Logout ===
document.getElementById("logout-btn").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRY_KEY);
  closeShortcuts();
  showLogin();
});

// === Playlist download ===
document.getElementById("yt-playlist-btn").addEventListener("click", downloadPlaylist);
document.getElementById("yt-playlist-url").addEventListener("keydown", (e) => {
  if (e.key === "Enter") downloadPlaylist();
});

async function downloadPlaylist() {
  const input = document.getElementById("yt-playlist-url");
  const url = input.value.trim();
  if (!url) return;

  const btn = document.getElementById("yt-playlist-btn");
  const statusEl = document.getElementById("playlist-status");
  btn.disabled = true;
  statusEl.textContent = "Fetching playlist info...";
  statusEl.classList.remove("hidden");

  try {
    await api("/api/playlist-url", {
      method: "POST",
      body: JSON.stringify({ url }),
    });

    const pollPl = setInterval(async () => {
      try {
        const resp = await api("/api/playlist-url/status");
        const data = await resp.json();

        if (data.state === "fetching") {
          statusEl.textContent = data.message || "Fetching playlist info...";
        } else if (data.state === "downloading") {
          const pct = data.total ? Math.round((data.done / data.total) * 100) : 0;
          statusEl.textContent = `Downloading ${data.done}/${data.total} (${pct}%) — ${data.current}`;
        } else if (data.state === "done") {
          clearInterval(pollPl);
          const ok = data.results.filter((r) => r.status === "ok").length;
          const cached = data.results.filter((r) => r.status === "cached").length;
          const failed = data.results.filter((r) => r.status === "failed").length;
          statusEl.textContent = `Done! ${ok} downloaded, ${cached} already cached, ${failed} failed`;
          input.value = "";
          btn.disabled = false;
          loadVideos();
          showToast(`Playlist complete: ${ok + cached}/${data.total} videos`);
        } else if (data.state === "error") {
          clearInterval(pollPl);
          statusEl.textContent = "Error: " + (data.error || "Unknown error");
          btn.disabled = false;
        }
      } catch {}
    }, 2000);
  } catch (e) {
    statusEl.textContent = "Error: " + e.message;
    btn.disabled = false;
  }
}

// === Zoom controls ===
const zoomJoinBtn = document.getElementById("zoom-join-btn");
const zoomMicBtn = document.getElementById("zoom-mic-btn");
const zoomCamBtn = document.getElementById("zoom-cam-btn");
const zoomLeaveBtn = document.getElementById("zoom-leave-btn");
const zoomJoinStatus = document.getElementById("zoom-join-status");
const zoomJoinDialog = document.getElementById("zoom-join-dialog");
const zoomMeetingNameInput = document.getElementById("zoom-meeting-name");
const zoomMeetingUrlInput = document.getElementById("zoom-meeting-url");
const zoomJoinCancel = document.getElementById("zoom-join-cancel");
const zoomJoinConfirm = document.getElementById("zoom-join-confirm");
const zoomLeaveTimer = document.getElementById("zoom-leave-timer");
const zoomLeaveTimerStatus = document.getElementById("zoom-leave-timer-status");
const zoomLeaveTimerMinutes = document.getElementById("zoom-leave-timer-minutes");
const zoomLeaveTimerStart = document.getElementById("zoom-leave-timer-start");
const zoomLeaveTimerCancel = document.getElementById("zoom-leave-timer-cancel");
let zoomJoinStatusTimer = null;
let zoomLeaveTimerClock = null;
let zoomLeaveTimerRunning = false;

function openZoomJoinDialog() {
  zoomMeetingNameInput.value = localStorage.getItem(ZOOM_MEETING_NAME_KEY) || DEFAULT_ZOOM_NAME;
  zoomMeetingUrlInput.value = localStorage.getItem(ZOOM_MEETING_URL_KEY) || DEFAULT_ZOOM_URL;
  zoomJoinDialog.classList.remove("hidden");
  setTimeout(() => zoomMeetingUrlInput.focus(), 0);
}

function closeZoomJoinDialog() {
  zoomJoinDialog.classList.add("hidden");
}

function showZoomJoinStatus() {
  if (zoomJoinStatusTimer) clearTimeout(zoomJoinStatusTimer);
  zoomJoinStatus.textContent = "Joining the Zoom group... ~10 seconds";
  zoomJoinStatus.classList.remove("ok");
  zoomJoinStatus.classList.remove("error");
  zoomJoinStatus.classList.remove("hidden");
}

function hideZoomJoinStatus(delayMs = 0) {
  if (zoomJoinStatusTimer) clearTimeout(zoomJoinStatusTimer);
  zoomJoinStatusTimer = setTimeout(() => zoomJoinStatus.classList.add("hidden"), delayMs);
}

function showZoomJoinedStatus(name) {
  if (zoomJoinStatusTimer) clearTimeout(zoomJoinStatusTimer);
  zoomJoinStatus.textContent = `Joined Zoom: ${name}`;
  zoomJoinStatus.classList.add("ok");
  zoomJoinStatus.classList.remove("error");
  zoomJoinStatus.classList.remove("hidden");
  hideZoomJoinStatus(5000);
}

function showZoomJoinError(message) {
  if (zoomJoinStatusTimer) clearTimeout(zoomJoinStatusTimer);
  zoomJoinStatus.textContent = `Zoom join failed: ${message}`;
  zoomJoinStatus.classList.remove("ok");
  zoomJoinStatus.classList.add("error");
  zoomJoinStatus.classList.remove("hidden");
}

async function joinZoomFromDialog() {
  const name = zoomMeetingNameInput.value.trim() || DEFAULT_ZOOM_NAME;
  const url = zoomMeetingUrlInput.value.trim();
  if (!url) {
    showToast("Zoom link is empty");
    zoomMeetingUrlInput.focus();
    return;
  }
  localStorage.setItem(ZOOM_MEETING_NAME_KEY, name);
  localStorage.setItem(ZOOM_MEETING_URL_KEY, url);
  closeZoomJoinDialog();
  zoomJoinBtn.disabled = true;
  zoomJoinBtn.querySelector("span").textContent = "Joining...";
  showZoomJoinStatus();
  try {
    await api("/api/zoom/join", {
      method: "POST",
      body: JSON.stringify({ name, url }),
    });
    setTimeout(() => showZoomJoinedStatus(name), 10000);
    setTimeout(() => {
      zoomJoinBtn.querySelector("span").textContent = "Join Zoom";
      zoomJoinBtn.disabled = false;
    }, 15000);
  } catch (e) {
    showToast(`Zoom: ${e.message}`);
    showZoomJoinError(e.message);
    zoomJoinBtn.querySelector("span").textContent = "Join Zoom";
    zoomJoinBtn.disabled = false;
  }
}

zoomJoinBtn.addEventListener("click", openZoomJoinDialog);
zoomJoinCancel.addEventListener("click", closeZoomJoinDialog);
zoomJoinConfirm.addEventListener("click", joinZoomFromDialog);
zoomJoinDialog.addEventListener("click", (e) => {
  if (e.target === zoomJoinDialog) closeZoomJoinDialog();
});
zoomMeetingUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) joinZoomFromDialog();
});
zoomMeetingNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") zoomMeetingUrlInput.focus();
});

function flashBtn(btn) {
  btn.classList.add("flash");
  setTimeout(() => btn.classList.remove("flash"), 300);
}

async function zoomApiWithTimeout(path, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await api(path, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function pollZoomCommand(commandId) {
  if (!commandId) return;
  const started = Date.now();
  while (Date.now() - started < 15000) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const resp = await zoomApiWithTimeout(`/api/zoom/commands/${commandId}`, {}, 5000);
    const data = await resp.json();
    if (["done", "failed", "timeout"].includes(data.status)) return data;
  }
}

async function runZoomAction(path, btn, { reportErrors = true } = {}) {
  flashBtn(btn);
  const label = btn.querySelector("span");
  const originalText = label ? label.textContent : "";
  btn.disabled = true;
  if (label) label.textContent = "Working...";
  try {
    const resp = await zoomApiWithTimeout(path, { method: "POST" });
    const data = await resp.json();
    const command = data.command_id ? await pollZoomCommand(data.command_id) : null;
    if (command && command.status !== "done") {
      if (reportErrors) showToast(`Zoom: ${command.error || command.status}`);
      return false;
    }
    if (!data.ok && data.error) {
      if (reportErrors) showToast(`Zoom: ${data.error}`);
      return false;
    }
    return true;
  } catch (e) {
    if (reportErrors) showToast(`Zoom: ${e.name === "AbortError" ? "request timed out" : e.message}`);
    return false;
  } finally {
    if (label) label.textContent = originalText;
    btn.disabled = false;
  }
}

zoomMicBtn.addEventListener("click", async () => {
  await runZoomAction("/api/zoom/mute", zoomMicBtn);
});

zoomCamBtn.addEventListener("click", async () => {
  await runZoomAction("/api/zoom/video", zoomCamBtn);
});

zoomLeaveBtn.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Exit Zoom? If Hoge Heer is host, the meeting ends for everyone. Otherwise Hoge Heer leaves the meeting."
  );
  if (!confirmed) return;
  const ok = await runZoomAction("/api/zoom/exit", zoomLeaveBtn);
  if (ok) showToast("Zoom meeting ended or left successfully");
});

function readZoomLeaveTimer() {
  try {
    return JSON.parse(localStorage.getItem(ZOOM_LEAVE_TIMER_KEY)) || null;
  } catch {
    localStorage.removeItem(ZOOM_LEAVE_TIMER_KEY);
    return null;
  }
}

function writeZoomLeaveTimer(timer) {
  localStorage.setItem(ZOOM_LEAVE_TIMER_KEY, JSON.stringify(timer));
}

function finishZoomLeaveTimer(timer, status) {
  const finished = {
    ...timer,
    status,
    completedAt: Date.now(),
  };
  writeZoomLeaveTimer(finished);
  renderZoomLeaveTimer(finished);
  return finished;
}

function zoomLeaveTimerFiredAt(timer) {
  return Number(timer?.firedAt || timer?.deadline || 0);
}

function reconcileZoomLeaveTimerWithState(joined, presenceKnown) {
  const timer = readZoomLeaveTimer();
  if (!timer || timer.status !== "firing") return;
  if (presenceKnown && !joined) {
    finishZoomLeaveTimer(timer, "completed");
    return;
  }
  const firedAt = zoomLeaveTimerFiredAt(timer);
  if (firedAt && Date.now() - firedAt >= ZOOM_LEAVE_TIMER_STALE_MS) {
    finishZoomLeaveTimer(timer, "failed");
  }
}

function formatZoomLeaveCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderZoomLeaveTimer(timer = readZoomLeaveTimer()) {
  zoomLeaveTimer.classList.remove("active");
  zoomLeaveTimerStatus.classList.add("hidden");
  zoomLeaveTimerStatus.textContent = "";
  if (!timer) {
    zoomLeaveTimerMinutes.disabled = false;
    zoomLeaveTimerStart.classList.remove("hidden");
    zoomLeaveTimerCancel.classList.add("hidden");
    return;
  }

  if (timer.status === "scheduled") {
    zoomLeaveTimer.classList.add("active");
    zoomLeaveTimerStatus.textContent = `Exits Zoom in ${formatZoomLeaveCountdown(timer.deadline - Date.now())}`;
    zoomLeaveTimerStatus.classList.remove("hidden");
    zoomLeaveTimerMinutes.value = timer.minutes;
    zoomLeaveTimerMinutes.disabled = true;
    zoomLeaveTimerStart.classList.add("hidden");
    zoomLeaveTimerCancel.classList.remove("hidden");
    return;
  }

  if (timer.status === "firing") {
    zoomLeaveTimer.classList.add("active");
    zoomLeaveTimerStatus.textContent = "Exiting Zoom now...";
    zoomLeaveTimerStatus.classList.remove("hidden");
    zoomLeaveTimerMinutes.disabled = true;
    zoomLeaveTimerStart.classList.add("hidden");
    zoomLeaveTimerCancel.classList.add("hidden");
    return;
  }

  zoomLeaveTimerMinutes.disabled = false;
  zoomLeaveTimerStart.classList.remove("hidden");
  zoomLeaveTimerCancel.classList.add("hidden");
}

async function fireZoomLeaveTimer(timer) {
  if (zoomLeaveTimerRunning) return;
  const current = readZoomLeaveTimer();
  if (!current || current.id !== timer.id || current.status !== "scheduled") return;

  zoomLeaveTimerRunning = true;
  const firing = { ...current, status: "firing", firedAt: Date.now() };
  writeZoomLeaveTimer(firing);
  renderZoomLeaveTimer(firing);
  try {
    const ok = await runZoomAction("/api/zoom/exit", zoomLeaveBtn, { reportErrors: false });
    const latest = readZoomLeaveTimer();
    if (latest?.id === current.id && latest.status === "firing") {
      finishZoomLeaveTimer(latest, ok ? "completed" : "failed");
    }
  } finally {
    zoomLeaveTimerRunning = false;
  }
}

function tickZoomLeaveTimer() {
  const timer = readZoomLeaveTimer();
  if (!timer) {
    renderZoomLeaveTimer(null);
    return;
  }
  if (timer.status === "scheduled" && Date.now() >= timer.deadline) {
    fireZoomLeaveTimer(timer);
    return;
  }
  if (timer.status === "firing") {
    const firedAt = zoomLeaveTimerFiredAt(timer);
    if (firedAt && Date.now() - firedAt >= ZOOM_LEAVE_TIMER_STALE_MS) {
      finishZoomLeaveTimer(timer, "failed");
      return;
    }
  }
  renderZoomLeaveTimer(timer);
}

function startZoomLeaveTimerClock() {
  stopZoomLeaveTimerClock();
  tickZoomLeaveTimer();
  zoomLeaveTimerClock = setInterval(tickZoomLeaveTimer, 1000);
}

function stopZoomLeaveTimerClock() {
  if (zoomLeaveTimerClock) {
    clearInterval(zoomLeaveTimerClock);
    zoomLeaveTimerClock = null;
  }
}

zoomLeaveTimerStart.addEventListener("click", () => {
  const minutes = Number(zoomLeaveTimerMinutes.value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) {
    showToast("Choose a timer between 1 and 720 minutes");
    zoomLeaveTimerMinutes.focus();
    return;
  }
  const timer = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    minutes,
    deadline: Date.now() + minutes * 60 * 1000,
    status: "scheduled",
  };
  writeZoomLeaveTimer(timer);
  renderZoomLeaveTimer(timer);
  showToast(`Zoom will exit automatically in ${minutes} minute${minutes === 1 ? "" : "s"}`);
});

zoomLeaveTimerCancel.addEventListener("click", () => {
  localStorage.removeItem(ZOOM_LEAVE_TIMER_KEY);
  renderZoomLeaveTimer(null);
  showToast("Auto-exit timer cancelled");
});

window.addEventListener("storage", (event) => {
  if (event.key === ZOOM_LEAVE_TIMER_KEY) tickZoomLeaveTimer();
});

// === Init ===
if (getToken()) {
  showApp();
} else {
  showLogin();
}
