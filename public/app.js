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
  pollStatus();
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
      errorEl.textContent = data.error || "Login mislukt";
      errorEl.classList.remove("hidden");
      return;
    }
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(EXPIRY_KEY, data.expiry.toString());
    document.getElementById("pin-input").value = "";
    showApp();
  } catch {
    errorEl.textContent = "Verbinding mislukt";
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
    videoSelect.innerHTML = '<option value="">Selecteer een video...</option>';
    for (const v of videosCache) {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.title;
      videoSelect.appendChild(opt);
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

  // Show language checkboxes
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
      showError(data.error || "Afspelen mislukt");
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
    updateStatusUI(data);
  } catch {}
}

function updateStatusUI(data) {
  const card = document.getElementById("status-card");
  const titleEl = document.getElementById("status-title");
  const stateEl = document.getElementById("status-state");
  const langsEl = document.getElementById("status-langs");
  const progressFill = document.getElementById("progress-fill");
  const progressTime = document.getElementById("progress-time");
  const pauseIcon = document.getElementById("pause-icon");
  const playIcon = document.getElementById("play-icon");

  if (data.state === "stopped" && !data.title) {
    card.classList.add("hidden");
    return;
  }

  card.classList.remove("hidden");
  titleEl.textContent = data.title || "Laden...";

  const stateLabels = {
    playing: "Speelt af",
    paused: "Gepauzeerd",
    stopped: "Gestopt",
    loading: "Laden...",
  };
  stateEl.textContent = stateLabels[data.state] || data.state;
  stateEl.className = `status-state ${data.state}`;

  // Show active languages
  if (data.languages && data.languages.length > 0) {
    langsEl.textContent = data.languages.map((l) => l.toUpperCase()).join(" + ");
  } else {
    langsEl.textContent = "";
  }

  if (data.duration && data.current_time != null) {
    const pct = Math.min((data.current_time / data.duration) * 100, 100);
    progressFill.style.width = `${pct}%`;
    progressTime.textContent = `${formatTime(data.current_time)} / ${formatTime(data.duration)}`;
  } else if (data.current_time != null) {
    progressFill.style.width = "0%";
    progressTime.textContent = formatTime(data.current_time);
  } else {
    progressFill.style.width = "0%";
    progressTime.textContent = "";
  }

  if (data.state === "paused") {
    pauseIcon.classList.add("hidden");
    playIcon.classList.remove("hidden");
  } else {
    pauseIcon.classList.remove("hidden");
    playIcon.classList.add("hidden");
  }

  if (data.error) showError(data.error);
}

function formatTime(seconds) {
  if (seconds == null) return "--:--";
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
