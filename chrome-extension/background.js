// TherapAI Meet Launcher — background service worker
//
// Watches for Chrome tabs navigating to a Google Meet call URL, then POSTs
// the meeting URL to /api/recall/launch on the TherapAI backend. The backend
// resolves the authenticated clinician via the user's existing TherapAI
// session cookies (credentials: 'include' on fetch).
//
// Dedup: a 10-minute sliding window keyed on the cleaned Meet URL prevents
// double-launching when a tab reloads or the user navigates back to the
// same meeting.

const MEET_CALL_URL_RE = /^https:\/\/meet\.google\.com\/([a-z]{3,4}-[a-z0-9]{3,4}-[a-z0-9]{3,4})(?:[\/?#].*)?$/i;
const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 min
const STABILIZATION_DELAY_MS = 2000; // wait for Meet UI to settle

// ─── Config ────────────────────────────────────────────────────────────────

async function getApiBase() {
  const { apiBase } = await chrome.storage.sync.get(['apiBase']);
  return (apiBase || 'https://therapai-one.vercel.app').replace(/\/$/, '');
}

// ─── Dedup store ───────────────────────────────────────────────────────────

function cleanMeetUrl(url) {
  const m = url.match(MEET_CALL_URL_RE);
  if (!m) return null;
  return `https://meet.google.com/${m[1]}`;
}

async function readLaunched() {
  const { launched } = await chrome.storage.local.get(['launched']);
  return launched || {};
}

async function isRecentlyLaunched(cleanUrl) {
  const launched = await readLaunched();
  const entry = launched[cleanUrl];
  return !!entry && Date.now() - entry.at < DEDUP_WINDOW_MS;
}

async function recordLaunch(cleanUrl, botId) {
  const launched = await readLaunched();
  launched[cleanUrl] = { at: Date.now(), botId };
  // Garbage collect: drop entries older than the dedup window
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  for (const [k, v] of Object.entries(launched)) {
    if (v.at < cutoff) delete launched[k];
  }
  await chrome.storage.local.set({ launched });
}

// ─── Notifications ─────────────────────────────────────────────────────────

function notify(title, message, id = `therapai-${Date.now()}`) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon-48.png',
    title,
    message,
    priority: 1,
  });
}

// ─── Launch ────────────────────────────────────────────────────────────────

async function launchBot(cleanUrl) {
  const apiBase = await getApiBase();
  try {
    console.log(`[TherapAI] launching bot for ${cleanUrl} via ${apiBase}`);
    const res = await fetch(`${apiBase}/api/recall/launch`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Source': 'chrome-meet-launcher',
      },
      body: JSON.stringify({ meeting_url: cleanUrl }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) {
      await recordLaunch(cleanUrl, body.bot_id);
      notify(
        'TherapAI bot launched',
        `Dispatched to ${cleanUrl.split('/').pop()}. It will knock to join in ~30s — click Admit when you see it.`,
      );
      return { ok: true, botId: body.bot_id };
    }
    if (res.status === 401) {
      notify(
        'TherapAI: not signed in',
        `Open ${apiBase} in this browser and sign in, then reload the Meet tab.`,
      );
      return { ok: false, status: 401 };
    }
    if (res.status === 403) {
      notify(
        'TherapAI: tenant not provisioned',
        'Your account is not yet provisioned in TherapAI. Contact André.',
      );
      return { ok: false, status: 403 };
    }
    notify(
      'TherapAI launch failed',
      body.message || `HTTP ${res.status}: ${body.error || 'unknown error'}`,
    );
    return { ok: false, status: res.status, body };
  } catch (err) {
    console.error('[TherapAI] launch error:', err);
    notify('TherapAI extension error', err.message || String(err));
    return { ok: false, error: err.message };
  }
}

// ─── Tab listener ──────────────────────────────────────────────────────────

const pendingTimeouts = new Map(); // tabId -> timeout id (cancel if user navigates away mid-debounce)

async function handleTabSettled(tabId, url) {
  const cleanUrl = cleanMeetUrl(url);
  if (!cleanUrl) return;
  if (await isRecentlyLaunched(cleanUrl)) {
    console.log(`[TherapAI] skip — recently launched: ${cleanUrl}`);
    return;
  }
  await launchBot(cleanUrl);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url) return;
  if (!MEET_CALL_URL_RE.test(tab.url)) return;

  // Debounce: cancel any pending fire for this tab, schedule new one
  if (pendingTimeouts.has(tabId)) {
    clearTimeout(pendingTimeouts.get(tabId));
  }
  const t = setTimeout(() => {
    pendingTimeouts.delete(tabId);
    handleTabSettled(tabId, tab.url).catch((e) => console.error('[TherapAI]', e));
  }, STABILIZATION_DELAY_MS);
  pendingTimeouts.set(tabId, t);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (pendingTimeouts.has(tabId)) {
    clearTimeout(pendingTimeouts.get(tabId));
    pendingTimeouts.delete(tabId);
  }
});

// ─── Lifecycle hooks ───────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  console.log('[TherapAI] meet launcher installed');
});
