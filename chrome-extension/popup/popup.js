/**
 * Popup — Live Session Monitor
 * Shows real-time status of the auto-apply session.
 * Controls: Skip Job, Pause, Resume, Stop.
 * No setup here — all setup happens on the Job Search page.
 */

const PLATFORM_URL  = 'http://localhost:3000/search';
const PLATFORM_ROOT = 'http://localhost:3000';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const el = {
  statusPill:       document.getElementById('status-pill'),
  statusDot:        document.getElementById('status-dot'),
  statusLabel:      document.getElementById('status-label'),

  idleView:         document.getElementById('idle-view'),
  activeView:       document.getElementById('active-view'),

  candidateRow:     document.getElementById('candidate-row'),
  candidateName:    document.getElementById('candidate-name'),

  jobTitle:         document.getElementById('current-job-title'),
  jobCompany:       document.getElementById('current-job-company'),
  jobPlatform:      document.getElementById('current-platform'),
  jobState:         document.getElementById('current-state'),

  progressDone:     document.getElementById('progress-done'),
  progressTotal:    document.getElementById('progress-total'),
  progressFill:     document.getElementById('progress-fill'),

  statApplied:      document.getElementById('stat-applied'),
  statSkipped:      document.getElementById('stat-skipped'),
  statErrors:       document.getElementById('stat-errors'),

  btnSkip:          document.getElementById('btn-skip'),
  btnPause:         document.getElementById('btn-pause'),
  btnResume:        document.getElementById('btn-resume'),
  btnStop:          document.getElementById('btn-stop'),

  logSection:       document.getElementById('log-section'),
  logList:          document.getElementById('log-list'),
  logClear:         document.getElementById('log-clear'),

  btnOpenPlatform:  document.getElementById('btn-open-platform'),
  footerLink:       document.getElementById('footer-platform-link'),
};

// ── Harvest Tab DOM refs ───────────────────────────────────────────────────────

const harvest = {
  tabBtn:       document.getElementById('tab-harvest'),
  applyTabBtn:  document.getElementById('tab-apply'),
  applyContent: document.getElementById('tab-apply-content'),
  content:      document.getElementById('tab-harvest-content'),
  keywords:     document.getElementById('harvest-keywords'),
  location:     document.getElementById('harvest-location'),
  easyApply:    document.getElementById('harvest-easy-apply'),
  recent:       document.getElementById('harvest-recent'),
  btnStart:     document.getElementById('btn-start-harvest'),
  statusDiv:    document.getElementById('harvest-status'),
  statusFill:   document.getElementById('harvest-fill'),
  statusText:   document.getElementById('harvest-status-text'),
  resultDiv:    document.getElementById('harvest-result'),
  resultNum:    document.getElementById('harvest-result-num'),
  btnView:      document.getElementById('btn-view-jobs'),
};

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  // Footer link
  el.footerLink.href = PLATFORM_URL;
  el.footerLink.addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: PLATFORM_URL });
  });

  el.btnOpenPlatform.addEventListener('click', () => {
    chrome.tabs.create({ url: PLATFORM_URL });
  });

  // Control buttons
  el.btnSkip.addEventListener('click',   () => send('SKIP_CURRENT'));
  el.btnPause.addEventListener('click',  () => send('PAUSE_SESSION'));
  el.btnResume.addEventListener('click', () => send('RESUME_SESSION'));
  el.btnStop.addEventListener('click',   handleStop);
  el.logClear.addEventListener('click',  () => { el.logList.innerHTML = ''; });

  // ── Tab switching ──────────────────────────────────────────────────────────
  harvest.applyTabBtn.addEventListener('click', () => {
    harvest.applyTabBtn.classList.add('active');
    harvest.tabBtn.classList.remove('active');
    harvest.applyContent.style.display = '';
    harvest.content.style.display = 'none';
  });

  harvest.tabBtn.addEventListener('click', () => {
    harvest.tabBtn.classList.add('active');
    harvest.applyTabBtn.classList.remove('active');
    harvest.content.style.display = '';
    harvest.applyContent.style.display = 'none';
  });

  // ── Harvest form handlers ──────────────────────────────────────────────────
  harvest.btnStart.addEventListener('click', startHarvest);

  harvest.btnView.addEventListener('click', () => {
    chrome.tabs.create({ url: PLATFORM_URL });
  });

  // Get current state
  await refresh();

  // Listen for live state updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATE' && message.state) {
      render(message.state);
    }
    if (message.type === 'HARVEST_PROGRESS') {
      onHarvestProgress(message);
    }
    if (message.type === 'HARVEST_COMPLETE') {
      onHarvestComplete(message);
    }
    if (message.type === 'HARVEST_ERROR') {
      onHarvestError(message.error);
    }
  });
}

// ── State Management ──────────────────────────────────────────────────────────

async function refresh() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (res?.state) render(res.state);
    else showIdle();
  } catch (_) {
    showIdle();
  }
}

async function send(type, payload) {
  try {
    await chrome.runtime.sendMessage({ type, payload });
    await refresh();
  } catch (err) {
    console.error('Extension error:', err);
  }
}

async function handleStop() {
  await send('STOP_SESSION');
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(state) {
  if (!state.isRunning && !state.currentJob && state.stats.total === 0) {
    // Might have a log from a previous completed session
    if (state.sessionLog?.length > 0) {
      showCompleted(state);
    } else {
      showIdle();
    }
    return;
  }

  el.idleView.style.display  = 'none';
  el.activeView.style.display = 'flex';

  // Status pill
  if (!state.isRunning && state.stats.total > 0) {
    setStatus('done', 'Complete');
  } else if (state.isPaused) {
    setStatus('paused', 'Paused');
  } else {
    setStatus('running', 'Running');
  }

  // Candidate name
  const name = state.candidateProfile?.full_name || state.candidateProfile?.candidate_name || '—';
  el.candidateName.textContent = name;

  // Current job
  if (state.currentJob) {
    el.jobTitle.textContent   = state.currentJob.title   || '—';
    el.jobCompany.textContent = state.currentJob.company || '—';
    el.jobPlatform.textContent = state.currentJob.platform || 'web';
    el.jobPlatform.className = 'tag';

    const stateText = state.isPaused ? 'paused' : (state.isRunning ? 'filling' : 'complete');
    el.jobState.textContent = stateText;
    el.jobState.className = `tag state-tag ${stateText}`;
  } else if (!state.isRunning && state.stats.total > 0) {
    el.jobTitle.textContent   = 'All jobs processed';
    el.jobCompany.textContent = '';
    el.jobState.textContent   = 'done';
    el.jobState.className     = 'tag state-tag complete';
  }

  // Progress
  const done  = (state.stats.applied || 0) + (state.stats.skipped || 0) + (state.stats.errors || 0);
  const total = state.stats.total || 0;
  el.progressDone.textContent  = done;
  el.progressTotal.textContent = total;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  el.progressFill.style.width = `${pct}%`;

  // Stats
  el.statApplied.textContent = state.stats.applied || 0;
  el.statSkipped.textContent = state.stats.skipped || 0;
  el.statErrors.textContent  = state.stats.errors  || 0;

  // Buttons
  const running = state.isRunning;
  const paused  = state.isPaused;

  el.btnSkip.style.display   = running ? '' : 'none';
  el.btnPause.style.display  = (running && !paused) ? '' : 'none';
  el.btnResume.style.display = (running && paused)  ? '' : 'none';
  el.btnStop.style.display   = running ? '' : 'none';

  // Session log
  if (state.sessionLog?.length > 0) {
    el.logSection.style.display = 'block';
    renderLog(state.sessionLog);
  }
}

function showIdle() {
  el.idleView.style.display   = 'block';
  el.activeView.style.display = 'none';
  el.logSection.style.display = 'none';
  setStatus('idle', 'Idle');
}

function showCompleted(state) {
  el.idleView.style.display   = 'none';
  el.activeView.style.display = 'flex';
  setStatus('done', 'Complete');

  el.jobTitle.textContent     = 'Session complete';
  el.jobCompany.textContent   = '';
  el.jobState.textContent     = 'done';
  el.jobState.className       = 'tag state-tag complete';

  const done = (state.stats.applied || 0) + (state.stats.skipped || 0) + (state.stats.errors || 0);
  el.progressDone.textContent  = done;
  el.progressTotal.textContent = state.stats.total || done;
  el.progressFill.style.width  = '100%';

  el.statApplied.textContent = state.stats.applied || 0;
  el.statSkipped.textContent = state.stats.skipped || 0;
  el.statErrors.textContent  = state.stats.errors  || 0;

  el.btnSkip.style.display   = 'none';
  el.btnPause.style.display  = 'none';
  el.btnResume.style.display = 'none';
  el.btnStop.style.display   = 'none';

  if (state.sessionLog?.length > 0) {
    el.logSection.style.display = 'block';
    renderLog(state.sessionLog);
  }
}

function setStatus(type, label) {
  el.statusPill.className = `status-pill ${type}`;
  el.statusLabel.textContent = label;
}

// ── Log Render ────────────────────────────────────────────────────────────────

let renderedLogLength = 0;

function renderLog(log) {
  if (log.length === renderedLogLength) return; // No change
  renderedLogLength = log.length;

  const icons = { applied: '✅', skipped: '⏭', error: '❌' };
  el.logList.innerHTML = [...log].reverse().slice(0, 30).map(entry => `
    <div class="log-entry">
      <span class="log-icon">${icons[entry.status] || '•'}</span>
      <span class="log-text" title="${esc(entry.title)} @ ${esc(entry.company)}${entry.reason ? ' — ' + esc(entry.reason) : ''}">${esc(entry.title)}${entry.reason ? ' <em style="opacity:.6;font-size:10px">(' + esc(entry.reason) + ')</em>' : ''}</span>
      <span class="log-badge ${entry.status}">${entry.status}</span>
    </div>
  `).join('');
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Harvest Functions ─────────────────────────────────────────────────────────

async function startHarvest() {
  const keywords = harvest.keywords.value.trim();
  if (!keywords) {
    harvest.keywords.focus();
    harvest.keywords.style.borderColor = '#f85149';
    setTimeout(() => harvest.keywords.style.borderColor = '', 1500);
    return;
  }

  const params = {
    keywords,
    location:       harvest.location.value.trim(),
    easy_apply_only: harvest.easyApply.checked,
    recent_only:    harvest.recent.checked,
  };

  // Show progress UI
  harvest.btnStart.disabled = true;
  harvest.btnStart.textContent = '⏳ Harvesting…';
  harvest.statusDiv.style.display = '';
  harvest.resultDiv.style.display = 'none';
  harvest.statusFill.style.width = '5%';
  harvest.statusText.textContent = 'Opening LinkedIn…';

  try {
    await chrome.runtime.sendMessage({ type: 'START_HARVEST', payload: params });
  } catch (err) {
    onHarvestError('Could not start harvest: ' + err.message);
  }
}

function onHarvestProgress(msg) {
  const pct = Math.min(90, Math.round((msg.cycle / msg.total_cycles) * 90));
  harvest.statusFill.style.width = pct + '%';
  harvest.statusText.textContent = `Found ${msg.found} jobs (scroll ${msg.cycle}/${msg.total_cycles})…`;
}

function onHarvestComplete(msg) {
  harvest.statusFill.style.width = '100%';
  harvest.statusDiv.style.display = 'none';
  harvest.resultDiv.style.display = '';
  harvest.resultNum.textContent = msg.saved || msg.total || 0;
  harvest.btnStart.disabled = false;
  harvest.btnStart.textContent = '🔍 Start Harvesting';
}

function onHarvestError(errMsg) {
  harvest.statusDiv.style.display = 'none';
  harvest.statusText.textContent = '❌ ' + errMsg;
  harvest.statusDiv.style.display = '';
  harvest.btnStart.disabled = false;
  harvest.btnStart.textContent = '🔍 Start Harvesting';
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
