// === Auth ===
const TOKEN_KEY = "docflock_token";
const EXPIRY_KEY = "docflock_expiry";
const DEFAULT_ZOOM_NAME = "Doc Flock";
const DEFAULT_ZOOM_URL = "https://us02web.zoom.us/j/84886374828?pwd=MkhPSVl3Wjg3cUZJbjlSVTNkM2FjQT09";
const ZOOM_MEETING_NAME_KEY = "docflock_zoom_meeting_name";
const ZOOM_MEETING_URL_KEY = "docflock_zoom_meeting_url";
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
}

function showApp() {
  loginScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  loadVideos();
  loadDelay();
  pollStatus();
  showResumePrompt();
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

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    tabPanels.forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

// === Video list ===
let selectedId = "";
let ytCache = [];
let clipsCache = [];
let multilangCache = [];
let musicCache = [];
const langGroup = document.getElementById("lang-group");
const langCheckboxes = document.getElementById("lang-checkboxes");
const playBtn = document.getElementById("play-btn");

function selectItem(id) {
  selectedId = id;
  // Update all list row highlights
  document.querySelectorAll(".item-list-row").forEach((row) => {
    row.classList.toggle("selected", row.dataset.id === id);
  });
  onSelectionChange();
}

function getSelectedId() {
  return selectedId;
}

function renderList(listId, items, opts = {}) {
  const list = document.getElementById(listId);
  list.innerHTML = "";
  let currentSeries = "";
  for (const item of items) {
    if (opts.grouped && item.series && item.series !== currentSeries) {
      currentSeries = item.series;
      const header = document.createElement("div");
      header.className = "item-list-group";
      header.textContent = currentSeries;
      list.appendChild(header);
    }
    const row = document.createElement("div");
    row.className = "item-list-row";
    row.dataset.id = item.id;
    row.dataset.search = (item.title + " " + (item.series || "")).toLowerCase();
    if (opts.showLangs && item.languages) {
      row.textContent = item.title + " [" + item.languages.map((l) => l.toUpperCase()).join(", ") + "]";
    } else {
      row.textContent = item.title;
    }
    if (item.id === selectedId) row.classList.add("selected");
    row.addEventListener("click", () => selectItem(item.id));
    list.appendChild(row);
  }
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "item-list-empty";
    empty.textContent = "No items";
    list.appendChild(empty);
  }
}

function setupSearch(searchId, listId) {
  const input = document.getElementById(searchId);
  if (!input) return;
  input.addEventListener("input", () => {
    const query = input.value.toLowerCase().trim();
    const list = document.getElementById(listId);
    const rows = list.querySelectorAll(".item-list-row");
    const groups = list.querySelectorAll(".item-list-group");
    rows.forEach((row) => {
      row.style.display = row.dataset.search.includes(query) ? "" : "none";
    });
    // Hide group headers if all their items are hidden
    groups.forEach((group) => {
      let next = group.nextElementSibling;
      let anyVisible = false;
      while (next && !next.classList.contains("item-list-group")) {
        if (next.classList.contains("item-list-row") && next.style.display !== "none") {
          anyVisible = true;
        }
        next = next.nextElementSibling;
      }
      group.style.display = anyVisible ? "" : "none";
    });
  });
}

async function loadVideos() {
  try {
    const resp = await api("/api/videos");
    videosCache = await resp.json();
    renderList("list-all", videosCache, { grouped: true });
    setupSearch("search-all", "list-all");
    updateTabCount("all", videosCache.length);
  } catch {}

  try {
    const respML = await api("/api/videos/multilang");
    multilangCache = await respML.json();
    renderList("list-multilang", multilangCache, { grouped: true, showLangs: true });
    setupSearch("search-multilang", "list-multilang");
    updateTabCount("multilang", multilangCache.length);
  } catch {}

  try {
    const resp2 = await api("/api/clips");
    clipsCache = await resp2.json();
    renderList("list-clips", clipsCache);
    setupSearch("search-clips", "list-clips");
    updateTabCount("clips", clipsCache.length);
  } catch {}

  try {
    const resp = await api("/api/music");
    musicCache = await resp.json();
    renderList("list-music", musicCache);
    setupSearch("search-music", "list-music");
    updateTabCount("music", musicCache.length);
  } catch {}

  try {
    const resp = await api("/api/youtube");
    ytCache = await resp.json();
    renderList("list-youtube", ytCache);
    setupSearch("search-youtube", "list-youtube");
    updateTabCount("youtube", ytCache.length);
  } catch {}
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
    playBtn.disabled = true;
    queueBtn.disabled = true;
    return;
  }

  const video =
    videosCache.find((v) => v.id === videoId) ||
    multilangCache.find((v) => v.id === videoId) ||
    clipsCache.find((v) => v.id === videoId) ||
    ytCache.find((v) => v.id === videoId);
  if (video && video.languages.length > 0) {
    langCheckboxes.innerHTML = "";
    for (const lang of video.languages) {
      const label = document.createElement("label");
      label.className = "lang-option";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = lang;
      cb.name = "lang";
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
    const pos = document.createElement("span");
    pos.className = "queue-pos";
    pos.textContent = i + 1;
    const span = document.createElement("span");
    span.textContent = item.title;
    const btn = document.createElement("button");
    btn.className = "queue-remove";
    btn.textContent = "\u00d7";
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
  statusInterval = setInterval(fetchStatus, 3000);
  startLocalTimer();
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
document.getElementById("shortcuts-close").addEventListener("click", () => {
  shortcutsOverlay.classList.add("hidden");
});

document.addEventListener("keydown", (e) => {
  // Don't capture when typing in inputs
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
  // Don't capture if login screen is showing
  if (!getToken()) return;

  const key = e.key;

  if (key === "?") {
    e.preventDefault();
    shortcutsOverlay.classList.toggle("hidden");
    return;
  }

  if (key === "Escape") {
    shortcutsOverlay.classList.add("hidden");
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

// === Logout ===
document.getElementById("logout-btn").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRY_KEY);
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
let zoomJoinStatusTimer = null;

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

async function pollZoomCommand(commandId) {
  if (!commandId) return;
  const started = Date.now();
  while (Date.now() - started < 15000) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const resp = await api(`/api/zoom/commands/${commandId}`);
    const data = await resp.json();
    if (["done", "failed", "timeout"].includes(data.status)) return data;
  }
}

async function runZoomAction(path, btn) {
  flashBtn(btn);
  const label = btn.querySelector("span");
  const originalText = label ? label.textContent : "";
  btn.disabled = true;
  if (label) label.textContent = "Working...";
  try {
    const resp = await api(path, { method: "POST" });
    const data = await resp.json();
    const command = data.command_id ? await pollZoomCommand(data.command_id) : null;
    if (command && command.status !== "done") {
      showToast(`Zoom: ${command.error || command.status}`);
    }
    if (!data.ok && data.error) showToast(`Zoom: ${data.error}`);
  } catch (e) {
    showToast(`Zoom: ${e.message}`);
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
  const confirmed = window.confirm("Leave the Zoom group on the Beelink?");
  if (!confirmed) return;
  await runZoomAction("/api/zoom/leave", zoomLeaveBtn);
});

// === Init ===
if (getToken()) {
  showApp();
} else {
  showLogin();
}
