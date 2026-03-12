/**
 * Background Service Worker
 *
 * Key design decisions (MV3-safe):
 * 1. All state is persisted to chrome.storage.local immediately.
 * 2. A TOP-LEVEL chrome.tabs.onUpdated listener (not inside a Promise) drives
 *    automation — this survives service worker restarts.
 * 3. After a tab finishes loading, we send BEGIN_AUTOMATION directly to the
 *    content script instead of waiting for CONTENT_READY from the tab.
 * 4. isRunning is NOT reset on service worker restart — it is restored from storage.
 */

// ── State ─────────────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  isRunning: false,
  isPaused: false,
  jobQueue: [],
  currentJobIndex: 0,
  currentJob: null,
  activeTabId: null,
  stats: { applied: 0, skipped: 0, errors: 0, total: 0 },
  sessionLog: [],
  candidateProfile: null,
};

let state = { ...DEFAULT_STATE };
let _stateLoadPromise = null; // shared promise — all callers await the same load

// ── Persistent top-level listeners (survive SW restart) ───────────────────────

/**
 * When the active automation tab finishes loading, push BEGIN_AUTOMATION
 * to the content script. This is the heartbeat of the automation loop.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;

  // ── Harvest tab loaded ────────────────────────────────────────────────────
  if (tabId === harvestTabId) {
    await triggerHarvestOnTab(tabId);
    return;
  }

  // ── Auto-apply tab loaded ─────────────────────────────────────────────────
  await ensureStateLoaded();
  if (!state.isRunning || state.isPaused) return;
  if (tabId !== state.activeTabId) return;

  // triggerAutomationOnTab handles its own initial delay internally
  await triggerAutomationOnTab(tabId);
});

/**
 * When a new tab is created, check if it was opened FROM the active automation tab
 * (e.g. LinkedIn "Apply" button opens the company ATS in a new tab).
 * If so, switch automation to the new tab and close the old one.
 */
chrome.tabs.onCreated.addListener(async (tab) => {
  await ensureStateLoaded();
  if (!state.isRunning || state.isPaused) return;
  if (!state.activeTabId) return;
  if (tab.openerTabId !== state.activeTabId) return;

  console.log(`[SW] New tab ${tab.id} opened from automation tab ${state.activeTabId} — switching to it`);
  const oldTabId = state.activeTabId;
  state.activeTabId = tab.id;
  await saveState();
  broadcastStateUpdate();

  // Close the original tab (LinkedIn/Indeed job page) after short delay
  setTimeout(() => chrome.tabs.remove(oldTabId).catch(() => {}), 800);
});

/**
 * If the user closes the active tab manually, skip that job.
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ensureStateLoaded();
  if (tabId !== state.activeTabId) return;
  state.activeTabId = null;
  if (state.isRunning && !state.isPaused) {
    await onJobSkipped({ reason: 'Tab closed by user' }, null);
  }
});

// ── Message Router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ensureStateLoaded().then(() => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  const { type, payload } = message;
  switch (type) {
    case 'START_SESSION':    return startSession(payload);
    case 'PAUSE_SESSION':    return pauseSession();
    case 'RESUME_SESSION':   return resumeSession();
    case 'STOP_SESSION':     return stopSession();
    case 'SKIP_CURRENT':     return skipCurrentJob('User skipped');
    case 'GET_STATE':        return { state };
    case 'JOB_APPLIED':      return onJobApplied(payload, sender.tab?.id);
    case 'JOB_SKIPPED':      return onJobSkipped(payload, sender.tab?.id);
    case 'JOB_ERROR':        return onJobError(payload, sender.tab?.id);
    case 'FORM_NEEDS_AI':    return handleAIFormQuestion(payload);
    // ── Harvest ──────────────────────────────────────────────────────────────
    case 'START_HARVEST':    return startHarvest(payload);
    case 'HARVESTER_READY':  return onHarvesterReady(sender.tab?.id);
    case 'HARVEST_PROGRESS': {
      forwardToPopup(message);
      // Also forward to the platform search page
      chrome.tabs.query({ url: 'http://localhost:3000/*' }, (tabs) => {
        tabs.forEach(t => {
          chrome.tabs.sendMessage(t.id, {
            type: 'HARVEST_PROGRESS',
            found: payload?.found,
            cycle: payload?.cycle,
            total_cycles: payload?.total_cycles,
          }).catch(() => {});
        });
      });
      return;
    }
    case 'HARVEST_COMPLETE': return onHarvestComplete(payload, sender.tab?.id);
    case 'HARVEST_ERROR':    return onHarvestError(payload, sender.tab?.id);
    default: return { error: `Unknown message type: ${type}` };
  }
}

// ── Session Lifecycle ─────────────────────────────────────────────────────────

async function startSession({ jobList, candidateProfile }) {
  if (state.isRunning) return { error: 'Session already running' };

  state.candidateProfile = candidateProfile;
  state.jobQueue = jobList.map(job => ({
    url: job.url,
    title: job.title || 'Unknown Position',
    company: job.company || 'Unknown Company',
    platform: detectPlatform(job.url),
  }));
  state.currentJobIndex = 0;
  state.isRunning = true;
  state.isPaused = false;
  state.stats = { applied: 0, skipped: 0, errors: 0, total: jobList.length };
  state.sessionLog = [];
  state.activeTabId = null;

  await saveState();
  broadcastStateUpdate();
  processNextJob();
  return { success: true, total: state.jobQueue.length };
}

function pauseSession() {
  state.isPaused = true;
  saveState();
  broadcastStateUpdate();
  if (state.activeTabId) {
    chrome.tabs.sendMessage(state.activeTabId, { type: 'PAUSE' }).catch(() => {});
  }
  return { success: true };
}

function resumeSession() {
  state.isPaused = false;
  saveState();
  broadcastStateUpdate();
  if (!state.activeTabId) {
    processNextJob();
  } else {
    chrome.tabs.sendMessage(state.activeTabId, { type: 'RESUME' }).catch(() => {});
  }
  return { success: true };
}

function stopSession() {
  const tabId = state.activeTabId;
  state.isRunning = false;
  state.isPaused = false;
  state.currentJob = null;
  state.activeTabId = null;
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { type: 'STOP' }).catch(() => {});
    chrome.tabs.remove(tabId).catch(() => {});
  }
  saveState();
  broadcastStateUpdate();
  return { success: true };
}

async function skipCurrentJob(reason = 'Skipped') {
  logJob(state.currentJob, 'skipped', reason);
  state.stats.skipped++;
  state.currentJobIndex++;
  state.activeTabId = null;
  await saveState();
  broadcastStateUpdate();
  if (state.isRunning && !state.isPaused) {
    setTimeout(processNextJob, randomDelay(1500, 3000));
  }
  return { success: true };
}

// ── Job Queue Processing ──────────────────────────────────────────────────────

function processNextJob() {
  if (!state.isRunning || state.isPaused) return;
  if (state.currentJobIndex >= state.jobQueue.length) {
    finishSession();
    return;
  }

  const job = state.jobQueue[state.currentJobIndex];
  state.currentJob = job;
  state.activeTabId = null;
  saveState();
  broadcastStateUpdate();

  // Open tab — the top-level onUpdated listener drives automation from here
  chrome.tabs.create({ url: job.url, active: true }, (tab) => {
    if (chrome.runtime.lastError) {
      console.error('[SW] Tab create error:', chrome.runtime.lastError.message);
      onJobError({ reason: 'Could not open tab: ' + chrome.runtime.lastError.message }, null);
      return;
    }
    state.activeTabId = tab.id;
    saveState();
    broadcastStateUpdate();
  });
}

/**
 * Push automation instructions to the content script.
 * Retries up to 5 times (every 2s) before giving up — needed because
 * content scripts may take a few seconds to inject on heavy pages.
 */
async function triggerAutomationOnTab(tabId) {
  const message = {
    type: 'BEGIN_AUTOMATION',
    job: state.currentJob,
    profile: state.candidateProfile,
    isPaused: state.isPaused,
  };

  const MAX_ATTEMPTS = 5;
  const RETRY_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // First attempt waits 800ms (page just loaded), subsequent waits 2s each
    await new Promise(r => setTimeout(r, attempt === 1 ? 800 : RETRY_DELAY_MS));

    // Bail if state changed while we were waiting
    await ensureStateLoaded();
    if (!state.isRunning || state.isPaused || tabId !== state.activeTabId) return;

    try {
      await chrome.tabs.sendMessage(tabId, message);
      console.log(`[SW] BEGIN_AUTOMATION sent on attempt ${attempt}`);
      return; // success
    } catch (err) {
      console.warn(`[SW] sendMessage attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err.message);
    }
  }

  // All attempts failed — content script is truly unreachable (unsupported page)
  console.warn('[SW] Content script unreachable after all retries — skipping job');
  await onJobSkipped({ reason: 'Unsupported page — content script could not inject' }, tabId);
}

// ── Outcome Handlers ──────────────────────────────────────────────────────────

async function onJobApplied(payload, tabId) {
  logJob(state.currentJob, 'applied', payload?.note);
  logToBackend(state.currentJob, 'applied', payload);
  state.stats.applied++;
  state.currentJobIndex++;
  state.activeTabId = null;
  await closeTab(tabId);
  await saveState();
  broadcastStateUpdate();
  if (state.isRunning && !state.isPaused) {
    setTimeout(processNextJob, randomDelay(2000, 4000));
  }
  return { success: true };
}

async function onJobSkipped(payload, tabId) {
  logJob(state.currentJob, 'skipped', payload?.reason);
  state.stats.skipped++;
  state.currentJobIndex++;
  state.activeTabId = null;
  await closeTab(tabId);
  await saveState();
  broadcastStateUpdate();
  if (state.isRunning && !state.isPaused) {
    setTimeout(processNextJob, randomDelay(1500, 3000));
  }
  return { success: true };
}

async function onJobError(payload, tabId) {
  logJob(state.currentJob, 'error', payload?.reason);
  state.stats.errors++;
  state.currentJobIndex++;
  state.activeTabId = null;
  await closeTab(tabId);
  await saveState();
  broadcastStateUpdate();
  if (state.isRunning && !state.isPaused) {
    setTimeout(processNextJob, randomDelay(2000, 4000));
  }
  return { success: true };
}

function finishSession() {
  state.isRunning = false;
  state.currentJob = null;
  state.activeTabId = null;
  saveState();
  broadcastStateUpdate();
  chrome.notifications?.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon48.png'),
    title: 'Auto Apply Complete',
    message: `Applied: ${state.stats.applied} | Skipped: ${state.stats.skipped} | Errors: ${state.stats.errors}`,
  });
}

async function closeTab(tabId) {
  const id = tabId || state.activeTabId;
  if (!id) return;
  try { await chrome.tabs.remove(id); } catch (_) {}
}

// ── AI Screening Questions ────────────────────────────────────────────────────

async function handleAIFormQuestion({ question, context, jobTitle, company }) {
  const profile = state.candidateProfile;
  if (!profile) return { answer: '' };
  try {
    const res = await fetch('http://localhost:8000/api/ai/screening-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, context, jobTitle, company, profile }),
    });
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    return { answer: data.answer || '' };
  } catch (_) {
    return { answer: generateFallbackAnswer(question, profile) };
  }
}

function generateFallbackAnswer(question, profile) {
  const q = question.toLowerCase();
  if (q.includes('year') && q.includes('experience')) return String(profile.experience_years || '3+');
  if (q.includes('sponsorship') || q.includes('authorization')) return 'Yes';
  if (q.includes('relocat')) return 'Yes';
  if (q.includes('remote')) return 'Yes';
  if (q.includes('salary') || q.includes('rate')) return profile.rate_expectation || 'Negotiable';
  return 'Yes';
}

// ── Backend Logging ───────────────────────────────────────────────────────────

async function logToBackend(job, status, payload) {
  if (!job) return;
  try {
    await fetch('http://localhost:8000/api/applications/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_url: job.url, job_title: job.title, company: job.company,
        platform: job.platform, status,
        candidate_id: state.candidateProfile?.id,
        note: payload?.note,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (_) {}
}

// ── Storage ───────────────────────────────────────────────────────────────────

async function saveState() {
  await chrome.storage.local.set({ autoApplyState: state });
}

/**
 * Ensures state is loaded from storage exactly once.
 * Uses a shared Promise so concurrent callers all wait for the SAME read —
 * prevents the race where stateLoaded=true but the read hasn't resolved yet.
 */
function ensureStateLoaded() {
  if (_stateLoadPromise) return _stateLoadPromise;
  _stateLoadPromise = chrome.storage.local.get('autoApplyState').then(result => {
    if (result.autoApplyState) {
      // Restore full state including isRunning — survives SW restarts
      state = { ...DEFAULT_STATE, ...result.autoApplyState };
      console.log('[SW] State restored from storage. isRunning:', state.isRunning);
    }
  }).catch(() => {});
  return _stateLoadPromise;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function logJob(job, status, reason) {
  if (!job) return;
  state.sessionLog.push({
    url: job.url, title: job.title, company: job.company,
    platform: job.platform, status, reason: reason || null,
    timestamp: new Date().toISOString(),
  });
}

function detectPlatform(url) {
  if (!url) return 'unknown';
  if (url.includes('linkedin.com'))      return 'linkedin';
  if (url.includes('indeed.com'))        return 'indeed';
  if (url.includes('ziprecruiter.com'))  return 'ziprecruiter';
  if (url.includes('naukri.com'))        return 'naukri';
  if (url.includes('dice.com'))          return 'dice';
  if (url.includes('myworkdayjobs.com')) return 'workday';
  if (url.includes('greenhouse.io'))     return 'greenhouse';
  if (url.includes('lever.co'))          return 'lever';
  return 'unknown';
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function broadcastStateUpdate() {
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state }).catch(() => {});
}

// ── Job Harvester ─────────────────────────────────────────────────────────────

let harvestTabId  = null;
let harvestParams = null;

/**
 * Build the LinkedIn jobs search URL from user params.
 */
function buildLinkedInUrl(params) {
  const base = 'https://www.linkedin.com/jobs/search/';
  const q = new URLSearchParams();
  if (params.keywords)  q.set('keywords', params.keywords);
  if (params.location)  q.set('location', params.location);
  if (params.easy_apply_only) q.set('f_LF', 'f_AL'); // Easy Apply filter
  if (params.recent_only)     q.set('f_TPR', 'r604800'); // Last 7 days
  q.set('sortBy', 'DD'); // Most recent first
  return `${base}?${q.toString()}`;
}

async function startHarvest(params) {
  if (harvestTabId) {
    // Already harvesting — close previous tab
    chrome.tabs.remove(harvestTabId).catch(() => {});
    harvestTabId = null;
  }

  harvestParams = params;
  const url = buildLinkedInUrl(params);

  chrome.tabs.create({ url, active: true }, (tab) => {
    if (chrome.runtime.lastError) {
      forwardToPopup({ type: 'HARVEST_ERROR', error: chrome.runtime.lastError.message });
      return;
    }
    harvestTabId = tab.id;
    console.log(`[SW] Harvest tab opened: ${tab.id} — ${url}`);
  });

  return { success: true };
}

/**
 * Content script signals it is ready — send BEGIN_HARVEST.
 * We also use the tabs.onUpdated listener as a fallback.
 */
async function onHarvesterReady(tabId) {
  if (tabId !== harvestTabId) return;
  await triggerHarvestOnTab(tabId);
}

async function triggerHarvestOnTab(tabId) {
  if (tabId !== harvestTabId) return;

  // Wait 1.5s for page to stabilise before sending message
  await new Promise(r => setTimeout(r, 1500));

  const MAX_ATTEMPTS = 4;
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'BEGIN_HARVEST',
        params: harvestParams || {},
      });
      console.log(`[SW] BEGIN_HARVEST sent (attempt ${i})`);
      return;
    } catch (err) {
      console.warn(`[SW] BEGIN_HARVEST attempt ${i}/${MAX_ATTEMPTS} failed:`, err.message);
      if (i < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 2000));
    }
  }

  forwardToPopup({ type: 'HARVEST_ERROR', error: 'Could not reach content script. Try reloading the LinkedIn page.' });
}

async function onHarvestComplete(payload, tabId) {
  forwardToPopup({ type: 'HARVEST_COMPLETE', ...payload });

  // Forward jobs to the platform search page so results appear there
  chrome.tabs.query({ url: 'http://localhost:3000/*' }, (tabs) => {
    tabs.forEach(t => {
      chrome.tabs.sendMessage(t.id, {
        type: 'LINKEDIN_HARVEST_COMPLETE',
        jobs: payload.jobs || [],
        total: payload.total || 0,
      }).catch(() => {});
    });
  });

  // Close harvest tab after a short delay
  setTimeout(() => {
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
    harvestTabId  = null;
    harvestParams = null;
  }, 3000);
  return { success: true };
}

function onHarvestError(payload, tabId) {
  forwardToPopup({ type: 'HARVEST_ERROR', error: payload?.error || 'Unknown error' });
  if (tabId) chrome.tabs.remove(tabId).catch(() => {});
  harvestTabId  = null;
  harvestParams = null;
  return { success: true };
}

function forwardToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
  return { success: true };
}

// ── Boot ──────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  // Only clear state on a fresh install — NOT on extension reload/update
  // (during development, reloading the extension fires onInstalled with reason='update')
  if (details.reason === 'install') {
    chrome.storage.local.remove('autoApplyState');
    console.log('[SW] Bench Sales Auto Apply — fresh install, state cleared.');
  } else {
    console.log('[SW] Bench Sales Auto Apply — reloaded/updated, state preserved.');
  }
});

// Load state immediately on every service worker startup
ensureStateLoaded();
