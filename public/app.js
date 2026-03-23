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
const musicSelect = document.getElementById("music-select");
const ytSelect = document.getElementById("yt-select");
let ytCache = [];
const langGroup = document.getElementById("lang-group");
const langCheckboxes = document.getElementById("lang-checkboxes");
const playBtn = document.getElementById("play-btn");
let musicCache = [];

async function loadVideos() {
  try {
    const resp = await api("/api/videos");
    videosCache = await resp.json();
    videoSelect.innerHTML = '<option value="">Select a lecture...</option>';

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

  try {
    const resp = await api("/api/music");
    musicCache = await resp.json();
    musicSelect.innerHTML = '<option value="">Select a song...</option>';
    for (const m of musicCache) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.title;
      musicSelect.appendChild(opt);
    }
  } catch {}

  try {
    const resp = await api("/api/youtube");
    ytCache = await resp.json();
    const group = document.getElementById("yt-cache-group");
    if (ytCache.length > 0) {
      ytSelect.innerHTML = '<option value="">Select a download...</option>';
      for (const v of ytCache) {
        const opt = document.createElement("option");
        opt.value = v.id;
        opt.textContent = v.title;
        ytSelect.appendChild(opt);
      }
      group.classList.remove("hidden");
    } else {
      group.classList.add("hidden");
    }
  } catch {}
}

// Only one dropdown active at a time
videoSelect.addEventListener("change", () => {
  if (videoSelect.value) { musicSelect.value = ""; ytSelect.value = ""; }
  onSelectionChange();
});

musicSelect.addEventListener("change", () => {
  if (musicSelect.value) { videoSelect.value = ""; ytSelect.value = ""; }
  onSelectionChange();
});

ytSelect.addEventListener("change", () => {
  if (ytSelect.value) { videoSelect.value = ""; musicSelect.value = ""; }
  onSelectionChange();
});

function getSelectedId() {
  return videoSelect.value || musicSelect.value || ytSelect.value || "";
}

function onSelectionChange() {
  const videoId = getSelectedId();
  if (!videoId) {
    langGroup.classList.add("hidden");
    playBtn.disabled = true;
    return;
  }

  const video = videosCache.find((v) => v.id === videoId);
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
}

// --- YouTube URL ---
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

  videoSelect.value = "";
  musicSelect.value = "";

  try {
    await api("/api/play-url", {
      method: "POST",
      body: JSON.stringify({ url }),
    });

    // Poll download status
    const pollDl = setInterval(async () => {
      try {
        const resp = await api("/api/play-url/status");
        const data = await resp.json();
        if (data.state === "already" || data.state === "done") {
          clearInterval(pollDl);
          const msg = data.state === "already"
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

// --- Player ---
playBtn.addEventListener("click", playVideo);
document.getElementById("pause-btn").addEventListener("click", togglePause);
document.getElementById("stop-btn").addEventListener("click", stopPlayback);
document.getElementById("prev-btn").addEventListener("click", async () => {
  try { await api("/api/prev", { method: "POST" }); fetchStatus(); } catch {}
});
document.getElementById("next-btn").addEventListener("click", async () => {
  try { await api("/api/next", { method: "POST" }); fetchStatus(); } catch {}
});
document.getElementById("autoplay-cb").addEventListener("change", async () => {
  try { await api("/api/autoplay", { method: "POST" }); } catch {}
});

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
  const videoId = getSelectedId();
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
  // Instantly update UI
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
  // Instantly update UI
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

// --- Status polling ---
function pollStatus() {
  stopPolling();
  fetchStatus();
  statusInterval = setInterval(fetchStatus, 3000);
  // Start local timer for smooth UI updates
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

  if (data.autoplay !== undefined) {
    document.getElementById("autoplay-cb").checked = data.autoplay;
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

// --- Refresh ---
document.getElementById("refresh-btn").addEventListener("click", () => {
  location.reload(true);
});

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
