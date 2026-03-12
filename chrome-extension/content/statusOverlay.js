/**
 * Status Overlay
 * Injects a small floating panel into the job page showing live automation status.
 * Provides Skip and Stop controls without needing to open the extension popup.
 */

window.StatusOverlay = (() => {
  'use strict';

  let panel = null;
  let minimized = false;

  const STYLES = `
    #bench-auto-apply-overlay {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      width: 320px;
      background: #1a1a2e;
      color: #e0e0e0;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      overflow: hidden;
      transition: all 0.3s ease;
      border: 1px solid rgba(99, 102, 241, 0.3);
    }
    #bench-auto-apply-overlay.minimized {
      width: 180px;
    }
    #bench-auto-apply-overlay.minimized .baa-body { display: none; }
    #bench-auto-apply-overlay.minimized .baa-footer { display: none; }
    .baa-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      cursor: move;
      user-select: none;
    }
    .baa-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 13px;
      color: #fff;
    }
    .baa-pulse {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #4ade80;
      animation: baa-pulse-anim 1.5s ease-in-out infinite;
    }
    @keyframes baa-pulse-anim {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .baa-pulse.paused { background: #facc15; animation: none; }
    .baa-pulse.done { background: #94a3b8; animation: none; }
    .baa-header-btns { display: flex; gap: 6px; }
    .baa-header-btns button {
      background: rgba(255,255,255,0.2);
      border: none;
      color: #fff;
      width: 22px; height: 22px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .baa-header-btns button:hover { background: rgba(255,255,255,0.35); }
    .baa-body {
      padding: 12px 14px;
    }
    .baa-job-title {
      font-weight: 600;
      color: #fff;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .baa-job-company {
      color: #a5b4fc;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .baa-step {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #94a3b8;
      font-size: 12px;
      margin-bottom: 10px;
    }
    .baa-spinner {
      width: 14px; height: 14px;
      border: 2px solid rgba(99,102,241,0.3);
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: baa-spin 0.8s linear infinite;
    }
    @keyframes baa-spin { to { transform: rotate(360deg); } }
    .baa-progress {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .baa-progress-bar {
      flex: 1;
      height: 4px;
      background: rgba(99,102,241,0.2);
      border-radius: 2px;
      overflow: hidden;
    }
    .baa-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #6366f1, #8b5cf6);
      border-radius: 2px;
      transition: width 0.4s ease;
    }
    .baa-progress-text { font-size: 11px; color: #94a3b8; white-space: nowrap; }
    .baa-stats {
      display: flex;
      gap: 12px;
      font-size: 11px;
    }
    .baa-stat { display: flex; align-items: center; gap: 3px; }
    .baa-stat .applied { color: #4ade80; }
    .baa-stat .skipped { color: #facc15; }
    .baa-stat .errors { color: #f87171; }
    .baa-footer {
      display: flex;
      gap: 6px;
      padding: 8px 14px;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    .baa-footer button {
      flex: 1;
      padding: 6px 0;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: background 0.2s;
    }
    .baa-btn-skip {
      background: rgba(250,204,21,0.15);
      color: #facc15;
    }
    .baa-btn-skip:hover { background: rgba(250,204,21,0.25); }
    .baa-btn-pause {
      background: rgba(99,102,241,0.15);
      color: #a5b4fc;
    }
    .baa-btn-pause:hover { background: rgba(99,102,241,0.25); }
    .baa-btn-stop {
      background: rgba(248,113,113,0.15);
      color: #f87171;
    }
    .baa-btn-stop:hover { background: rgba(248,113,113,0.25); }
  `;

  function create() {
    if (panel) return;

    // Inject styles
    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.id = 'bench-auto-apply-overlay';
    panel.innerHTML = `
      <div class="baa-header">
        <div class="baa-header-left">
          <div class="baa-pulse" id="baa-pulse"></div>
          <span>Auto Apply</span>
        </div>
        <div class="baa-header-btns">
          <button id="baa-btn-minimize" title="Minimize">—</button>
          <button id="baa-btn-close" title="Hide overlay">×</button>
        </div>
      </div>
      <div class="baa-body">
        <div class="baa-job-title" id="baa-job-title">Starting...</div>
        <div class="baa-job-company" id="baa-job-company"></div>
        <div class="baa-step">
          <div class="baa-spinner" id="baa-spinner"></div>
          <span id="baa-step-text">Initializing</span>
        </div>
        <div class="baa-progress">
          <div class="baa-progress-bar">
            <div class="baa-progress-fill" id="baa-progress-fill" style="width: 0%"></div>
          </div>
          <span class="baa-progress-text" id="baa-progress-text">0 / 0</span>
        </div>
        <div class="baa-stats">
          <div class="baa-stat"><span class="applied">✓</span> <span id="baa-applied">0</span></div>
          <div class="baa-stat"><span class="skipped">⏭</span> <span id="baa-skipped">0</span></div>
          <div class="baa-stat"><span class="errors">✗</span> <span id="baa-errors">0</span></div>
        </div>
      </div>
      <div class="baa-footer">
        <button class="baa-btn-skip" id="baa-btn-skip">Skip</button>
        <button class="baa-btn-pause" id="baa-btn-pause">Pause</button>
        <button class="baa-btn-stop" id="baa-btn-stop">Stop</button>
      </div>
    `;
    document.body.appendChild(panel);

    // Drag support
    makeDraggable(panel, panel.querySelector('.baa-header'));

    // Buttons
    panel.querySelector('#baa-btn-minimize').addEventListener('click', () => {
      minimized = !minimized;
      panel.classList.toggle('minimized', minimized);
      panel.querySelector('#baa-btn-minimize').textContent = minimized ? '□' : '—';
    });
    panel.querySelector('#baa-btn-close').addEventListener('click', () => {
      panel.style.display = 'none';
    });
    panel.querySelector('#baa-btn-skip').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SKIP_CURRENT' }).catch(() => {});
    });
    panel.querySelector('#baa-btn-pause').addEventListener('click', () => {
      const btn = panel.querySelector('#baa-btn-pause');
      if (btn.textContent === 'Pause') {
        chrome.runtime.sendMessage({ type: 'PAUSE_SESSION' }).catch(() => {});
        btn.textContent = 'Resume';
      } else {
        chrome.runtime.sendMessage({ type: 'RESUME_SESSION' }).catch(() => {});
        btn.textContent = 'Pause';
      }
    });
    panel.querySelector('#baa-btn-stop').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'STOP_SESSION' }).catch(() => {});
    });
  }

  function update({ jobTitle, jobCompany, stepText, stats, progress, isPaused, isDone }) {
    if (!panel) create();
    if (panel.style.display === 'none') panel.style.display = '';

    const $ = (id) => panel.querySelector('#' + id);

    if (jobTitle !== undefined) $('baa-job-title').textContent = jobTitle || 'Processing...';
    if (jobCompany !== undefined) $('baa-job-company').textContent = jobCompany || '';
    if (stepText !== undefined) $('baa-step-text').textContent = stepText;

    if (stats) {
      $('baa-applied').textContent = stats.applied || 0;
      $('baa-skipped').textContent = stats.skipped || 0;
      $('baa-errors').textContent = stats.errors || 0;
    }

    if (progress) {
      const done = (progress.applied || 0) + (progress.skipped || 0) + (progress.errors || 0);
      const total = progress.total || 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      $('baa-progress-fill').style.width = pct + '%';
      $('baa-progress-text').textContent = `${done} / ${total}`;
    }

    const pulse = $('baa-pulse');
    const spinner = $('baa-spinner');
    if (isDone) {
      pulse.className = 'baa-pulse done';
      spinner.style.display = 'none';
    } else if (isPaused) {
      pulse.className = 'baa-pulse paused';
      spinner.style.display = 'none';
      $('baa-btn-pause').textContent = 'Resume';
    } else {
      pulse.className = 'baa-pulse';
      spinner.style.display = '';
      $('baa-btn-pause').textContent = 'Pause';
    }
  }

  function destroy() {
    if (panel) {
      panel.remove();
      panel = null;
    }
  }

  // ── Drag helper ──────────────────────────────────────────────────────────────

  function makeDraggable(element, handle) {
    let offsetX, offsetY, isDragging = false;

    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      offsetX = e.clientX - element.getBoundingClientRect().left;
      offsetY = e.clientY - element.getBoundingClientRect().top;
      element.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      element.style.left = (e.clientX - offsetX) + 'px';
      element.style.top = (e.clientY - offsetY) + 'px';
      element.style.right = 'auto';
      element.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      element.style.transition = '';
    });
  }

  return { create, update, destroy };
})();
