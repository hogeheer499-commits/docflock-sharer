// --- Auth ---
const TOKEN_KEY = "docflock_token";
const EXPIRY_KEY = "docflock_expiry";
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

// --- Screens ---
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

// --- Login ---
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

// --- Video list ---
const videoSelect = document.getElementById("video-select");
const langGroup = document.getElementById("lang-group");
const langCheckboxes = document.getElementById("lang-checkboxes");
const playBtn = document.getElementById("play-btn");

async function loadVideos() {
  try {
    const resp = await api("/api/videos");
    videosCache = await resp.json();
    videoSelect.innerHTML = '<option value="">Select a video...</option>';

    // Group by series
    let currentSeries = "";
    let optgroup = null;
    for (const v of videosCache) {
      if (v.series && v.series !== currentSeries) {
        currentSeries = v.series;
        optgroup = document.createElement("optgroup");
        optgroup.label = currentSeries;
        videoSelect.appendChild(optgroup);
      }
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.title;
      (optgroup || videoSelect).appendChild(opt);
    }
  } catch {}
}

videoSelect.addEventListener("change", () => {
  const videoId = videoSelect.value;
  if (!videoId) {
    langGroup.classList.add("hidden");
    playBtn.disabled = true;
    return;
  }

  const video = videosCache.find((v) => v.id === videoId);
  if (!video || video.languages.length === 0) {
    langGroup.classList.add("hidden");
    playBtn.disabled = false;
    return;
  }

  langCheckboxes.innerHTML = "";
  for (const lang of video.languages) {
    const label = document.createElement("label");
    label.className = "lang-option";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = lang;
    cb.name = "lang";
    label.appendChild(cb);
    label.appendChild(document.createTextNode(lang.toUpperCase()));
    langCheckboxes.appendChild(label);
  }
  langGroup.classList.remove("hidden");
  playBtn.disabled = false;
});

// --- Player ---
playBtn.addEventListener("click", playVideo);
document.getElementById("pause-btn").addEventListener("click", togglePause);
document.getElementById("stop-btn").addEventListener("click", stopPlayback);

// Audio sync buttons
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
  const videoId = videoSelect.value;
  if (!videoId) return;

  const selected = [...document.querySelectorAll('input[name="lang"]:checked')]
    .map((cb) => cb.value);

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
  } catch {}
}

async function seek(position) {
  try {
    await api("/api/seek", {
      method: "POST",
      body: JSON.stringify({ position }),
    });
  } catch {}
}

async function skip(offset) {
  try {
    await api("/api/skip", {
      method: "POST",
      body: JSON.stringify({ offset }),
    });
  } catch {}
}

// --- Status polling ---
function pollStatus() {
  stopPolling();
  fetchStatus();
  statusInterval = setInterval(fetchStatus, 3000);
}

function stopPolling() {
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
}

async function fetchStatus() {
  try {
    const resp = await api("/api/status");
    const data = await resp.json();
    lastStatus = data;
    updateStatusUI(data);
  } catch {}
}

// --- Resume state ---
const RESUME_KEY = "docflock_resume";

function saveResumeState(data) {
  if (data.state === "playing" || data.state === "paused") {
    localStorage.setItem(RESUME_KEY, JSON.stringify({
      video_id: data.video_id,
      title: data.title,
      current_time: data.current_time,
      languages: data.languages || [],
      saved_at: Date.now(),
    }));
  }
}

function showResumePrompt() {
  const raw = localStorage.getItem(RESUME_KEY);
  if (!raw) return;
  try {
    const resume = JSON.parse(raw);
    // Only show if saved less than 7 days ago
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
        // Wait for playback to start, then seek
        setTimeout(async () => {
          await api("/api/seek", {
            method: "POST",
            body: JSON.stringify({ position: resume.current_time }),
          });
        }, 2000);
        pollStatus();
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

  if (data.error) showError(data.error);

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

// --- Logout ---
document.getElementById("logout-btn").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRY_KEY);
  showLogin();
});

// --- Init ---
if (getToken()) {
  showApp();
} else {
  showLogin();
}
