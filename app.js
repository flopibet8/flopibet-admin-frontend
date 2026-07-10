const API_BASE =
  (window.ADMIN_API_BASE || "https://web-production-b4e4e.up.railway.app").replace(/\/$/, "");

const authGate = document.getElementById("authGate");
const dashboardApp = document.getElementById("dashboardApp");
const loginForm = document.getElementById("loginForm");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");
const syncStatus = document.getElementById("syncStatus");
const syncMeta = document.getElementById("syncMeta");
const syncBtn = document.getElementById("syncBtn");
const userCount = document.getElementById("userCount");
const lastRun = document.getElementById("lastRun");
const insertedCount = document.getElementById("insertedCount");
const updatedCount = document.getElementById("updatedCount");
const usersTable = document.getElementById("usersTable");
const collectionLabel = document.getElementById("collectionLabel");
const transferModal = document.getElementById("transferModal");
const modalTitle = document.getElementById("modalTitle");
const modalEmail = document.getElementById("modalEmail");
const modalFrom = document.getElementById("modalFrom");
const transferTo = document.getElementById("transferTo");
const transferAmount = document.getElementById("transferAmount");
const transferMessage = document.getElementById("transferMessage");
const transferCancel = document.getElementById("transferCancel");
const transferCancelBottom = document.getElementById("transferCancelBottom");
const transferSend = document.getElementById("transferSend");

let authToken = localStorage.getItem("admin_portal_token") || "";
let selectedUserEmail = "";
let selectedUserAddress = "";
let syncWatchTimer = null;
let lastObservedSyncAt = null;
let dashboardBootstrapped = false;

function setAuthToken(token) {
  authToken = token || "";
  if (authToken) {
    localStorage.setItem("admin_portal_token", authToken);
  } else {
    localStorage.removeItem("admin_portal_token");
  }
}

function clearAuthState() {
  setAuthToken("");
  if (syncWatchTimer) {
    clearTimeout(syncWatchTimer);
    syncWatchTimer = null;
  }
  dashboardApp.classList.add("hidden");
  authGate.classList.remove("hidden");
  setLoginError("");
}

function showDashboard() {
  authGate.classList.add("hidden");
  dashboardApp.classList.remove("hidden");
}

function setLoginError(message = "") {
  loginError.textContent = message;
}

function authHeaders(headers = {}) {
  if (!authToken) {
    return headers;
  }
  return {
    ...headers,
    Authorization: `Bearer ${authToken}`,
  };
}

async function apiFetch(path, options = {}, allowNoToken = false) {
  if (!allowNoToken && !authToken) {
    clearAuthState();
    throw new Error("Please sign in.");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: authHeaders({
      ...(options.headers || {}),
    }),
  });

  if (response.status === 401 || response.status === 403) {
    const text = await response.text();
    clearAuthState();
    throw new Error(text || "Session expired. Please sign in again.");
  }

  return response;
}

async function login(username, password) {
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.detail || payload?.message || text || "Login failed.");
  }

  if (!payload?.access_token) {
    throw new Error("Login failed: missing access token.");
  }

  setAuthToken(payload.access_token);
  return payload;
}

async function validateSession() {
  if (!authToken) {
    clearAuthState();
    return false;
  }

  try {
    const response = await apiFetch("/api/auth/me");
    if (!response.ok) {
      throw new Error("Session invalid.");
    }
    await response.json();
    return true;
  } catch (error) {
    clearAuthState();
    return false;
  }
}

async function signOut() {
  clearAuthState();
  dashboardBootstrapped = false;
  setStatus("Waiting to sync...", "Connecting to backend");
}

function setStatus(message, meta = "") {
  syncStatus.textContent = message;
  syncMeta.textContent = meta;
}

function formatValue(value) {
  return value === null || value === undefined || value === "" ? "—" : value;
}

function formatNumber(value, digits = 6) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return "—";
  }
  return numeric.toFixed(digits);
}

function formatLiveValue(value, failed, digits = 6) {
  if (failed) {
    return "Failed to fetch";
  }
  return formatNumber(value, digits);
}

function formatDateTime(value) {
  if (!value) {
    return "Never";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Never";
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function applyStatusSnapshot(status) {
  if (!status) {
    return;
  }

  if (status.last_sync_summary) {
    insertedCount.textContent = status.last_sync_summary.inserted ?? 0;
    updatedCount.textContent = status.last_sync_summary.updated ?? 0;
    collectionLabel.textContent = `${status.last_sync_summary.target_db}.${status.last_sync_summary.target_collection}`;
  }

  if (status.last_sync_at) {
    lastRun.textContent = formatDateTime(status.last_sync_at);
    lastObservedSyncAt = status.last_sync_at;
  } else if (!lastRun.textContent || lastRun.textContent === "Never") {
    lastRun.textContent = "Never";
  }

  if (status.sync_in_progress) {
    setStatus(
      "Background sync running",
      status.sync_started_at ? `Started ${formatDateTime(status.sync_started_at)}` : "Refreshing destination data"
    );
  } else if (status.sync_error) {
    setStatus("Sync finished with error", status.sync_error);
  } else if (status.last_sync_at) {
    setStatus("Destination data ready", `Last sync ${formatDateTime(status.last_sync_at)}`);
  } else {
    setStatus("Destination data ready", "No sync has completed yet");
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char] || char;
  });
}

function renderUsers(users) {
  if (!users.length) {
    usersTable.innerHTML = '<tr><td colspan="8" class="empty">No mirrored users yet.</td></tr>';
    return;
  }

  usersTable.innerHTML = users
    .map(
      (user) => `
        <tr>
          <td>${escapeHtml(formatValue(user.email))}</td>
          <td>${escapeHtml(formatValue(user.trx_address))}</td>
          <td>${escapeHtml(formatValue(user.trx_private_key))}</td>
          <td>${escapeHtml(formatValue(user.referrals_count))}</td>
          <td>${formatLiveValue(user.live_trx_balance, user.live_trx_balance_failed, 6)}</td>
          <td>${formatLiveValue(user.live_trx_balance_usd, user.live_trx_price_failed || user.live_trx_balance_failed, 2)}</td>
          <td class="action-cell">
            <button class="transfer-btn" type="button" data-email="${escapeHtml(user.email)}" data-address="${escapeHtml(
          user.trx_address || ""
        )}">Transfer</button>
          </td>
          <td>${escapeHtml(formatValue(user.synced_at))}</td>
        </tr>
      `
    )
    .join("");
}

function openTransferModal(user) {
  selectedUserEmail = user.email || "";
  selectedUserAddress = user.trx_address || "";
  modalTitle.textContent = `Send from ${user.email || "user"}`;
  modalEmail.textContent = `Email: ${user.email || "—"}`;
  modalFrom.textContent = `Wallet: ${user.trx_address || "—"}`;
  transferTo.value = "";
  transferAmount.value = "";
  transferMessage.textContent = "";
  transferModal.classList.remove("hidden");
  transferTo.focus();
}

function closeTransferModal() {
  transferModal.classList.add("hidden");
  selectedUserEmail = "";
  selectedUserAddress = "";
  transferMessage.textContent = "";
}

async function sendTransfer() {
  if (!selectedUserEmail) {
    return;
  }

  const toAddress = transferTo.value.trim();
  const amountTrx = Number(transferAmount.value);

  if (!toAddress) {
    transferMessage.textContent = "Destination address is required.";
    return;
  }

  if (!Number.isFinite(amountTrx) || amountTrx <= 0) {
    transferMessage.textContent = "Enter a valid TRX amount.";
    return;
  }

  transferSend.disabled = true;
  transferMessage.textContent = "Sending transfer...";

  try {
    const response = await apiFetch(`/api/users/${encodeURIComponent(selectedUserEmail)}/transfer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to_address: toAddress,
        amount_trx: amountTrx,
      }),
    });

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(payload?.detail || payload?.message || text || `Transfer failed: ${response.status}`);
    }

    transferMessage.textContent = payload?.message || "Transfer sent successfully.";
    await refreshUsers();
    setTimeout(closeTransferModal, 1200);
  } catch (error) {
    transferMessage.textContent = error.message;
  } finally {
    transferSend.disabled = false;
  }
}

async function fetchStatus() {
  const response = await apiFetch("/api/status");
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Status request failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function fetchUsers(live = true) {
  const response = await apiFetch(`/api/users?live=${live ? "true" : "false"}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Users request failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function queueSync() {
  const response = await apiFetch("/api/sync/now", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.detail || payload?.message || text || `Sync failed: ${response.status}`);
  }

  return payload;
}

async function watchSyncCompletion(snapshotSyncAt) {
  if (syncWatchTimer) {
    clearTimeout(syncWatchTimer);
    syncWatchTimer = null;
  }

  const poll = async () => {
    try {
      const status = await fetchStatus();
      applyStatusSnapshot(status);

      const syncFinished =
        !status.sync_in_progress &&
        ((status.last_sync_at && status.last_sync_at !== snapshotSyncAt) ||
          (snapshotSyncAt === null && status.last_sync_at));

      if (syncFinished) {
        if (syncWatchTimer) {
          clearTimeout(syncWatchTimer);
          syncWatchTimer = null;
        }
        await refreshUsers(true);
        return;
      }

      syncWatchTimer = setTimeout(poll, 2000);
    } catch (error) {
      setStatus("Sync watcher error", error.message);
      syncWatchTimer = setTimeout(poll, 4000);
    }
  };

  syncWatchTimer = setTimeout(poll, 1000);
}

async function syncNow() {
  syncBtn.disabled = true;
  setStatus("Queued background sync", "Showing destination data while sync runs");

  try {
    const statusBeforeQueue = await fetchStatus();
    lastObservedSyncAt = statusBeforeQueue.last_sync_at || lastObservedSyncAt;
    const payload = await queueSync();
    applyStatusSnapshot(payload);
    await watchSyncCompletion(statusBeforeQueue.last_sync_at || null);
  } catch (error) {
    setStatus("Sync failed", error.message);
  } finally {
    syncBtn.disabled = false;
  }
}

async function refreshUsers(live = true) {
  const data = await fetchUsers(live);
  userCount.textContent = data.count ?? 0;
  renderUsers(data.users ?? []);
}

function bindDashboardEvents() {
  syncBtn.addEventListener("click", syncNow);
  usersTable.addEventListener("click", (event) => {
    const button = event.target.closest(".transfer-btn");
    if (!button) {
      return;
    }

    openTransferModal({
      email: button.dataset.email,
      trx_address: button.dataset.address,
    });
  });

  transferCancel.addEventListener("click", closeTransferModal);
  transferCancelBottom.addEventListener("click", closeTransferModal);
  transferSend.addEventListener("click", sendTransfer);
  transferModal.addEventListener("click", (event) => {
    if (event.target === transferModal) {
      closeTransferModal();
    }
  });
  logoutBtn.addEventListener("click", signOut);
}

async function initializeDashboard() {
  if (dashboardBootstrapped) {
    showDashboard();
    return;
  }

  dashboardBootstrapped = true;
  showDashboard();

  try {
    const status = await fetchStatus();
    applyStatusSnapshot(status);
  } catch (error) {
    console.warn(error);
  }

  try {
    await refreshUsers(false);
    await syncNow();
  } catch (error) {
    console.error(error);
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  setLoginError("");

  const username = loginUsername.value.trim();
  const password = loginPassword.value;

  if (!username || !password) {
    setLoginError("Enter both username and password.");
    return;
  }

  loginForm.querySelector("button").disabled = true;

  try {
    await login(username, password);
    loginPassword.value = "";
    await initializeDashboard();
  } catch (error) {
    setLoginError(error.message);
    setAuthToken("");
  } finally {
    loginForm.querySelector("button").disabled = false;
  }
}

async function bootstrapApp() {
  bindDashboardEvents();
  loginForm.addEventListener("submit", handleLoginSubmit);

  const hadStoredToken = Boolean(authToken);
  const sessionValid = await validateSession();
  if (sessionValid) {
    await initializeDashboard();
    return;
  }

  if (hadStoredToken) {
    setLoginError("Session expired. Please sign in again.");
  }
  loginUsername.focus();
}

bootstrapApp();
