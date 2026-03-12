/**
 * LinkedIn Job Harvester — Content Script
 *
 * Activates on LinkedIn jobs/search pages when triggered by the service worker.
 * Scrolls the job list with human-like behaviour, extracts job cards,
 * and sends them to the backend.
 *
 * Anti-detection principles:
 *  • Only reads DOM that is already rendered — NO direct LinkedIn API calls
 *  • Random delays between every scroll (1.2 – 2.8 s)
 *  • Random scroll amounts (250 – 500 px)
 *  • Initial stabilisation delay after page load (2 – 3 s)
 *  • Hard cap of 30 jobs per session
 *  • Stops early if 3 consecutive scrolls yield no new jobs (end of list)
 */

(function () {
  'use strict';

  // Only run on LinkedIn jobs search pages
  if (!location.href.includes('linkedin.com/jobs')) return;

  const MAX_JOBS    = 30;
  const MAX_CYCLES  = 10;
  const API_BASE    = 'http://localhost:8000';

  // ── LinkedIn DOM Selectors (multiple fallbacks — LinkedIn changes these often) ─

  const SEL = {
    container: [
      '.jobs-search-results-list',
      'ul.scaffold-layout__list-container',
      '.scaffold-layout__list',
      '[class*="jobs-search-results-list"]',
    ],
    card: [
      'li.jobs-search-results__list-item',
      '.jobs-search-results__list-item',
      '.job-card-container',
      '[data-job-id]',
    ],
    title: [
      'a.job-card-list__title--link',
      '.job-card-list__title--link',
      '.job-card-list__title',
      'a[data-control-id]',
      '.artdeco-entity-lockup__title a',
    ],
    company: [
      '.job-card-container__company-name',
      '.artdeco-entity-lockup__subtitle span',
      '.job-card-container__primary-description',
      '.job-card-container__company-link',
    ],
    location: [
      '.job-card-container__metadata-item',
      '.artdeco-entity-lockup__caption li',
      '.job-card-container__metadata-wrapper li',
      '.job-card-container__metadata-item--workplace-type',
    ],
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const randDelay = (min, max) =>
    new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

  function findEl(parent, selectors) {
    for (const sel of selectors) {
      const el = parent.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function getContainer() {
    for (const sel of SEL.container) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > 200) return el;
    }
    return null;
  }

  // ── Job Card Extraction ───────────────────────────────────────────────────────

  function extractVisibleJobs() {
    const jobs = [];

    for (const cardSel of SEL.card) {
      const cards = document.querySelectorAll(cardSel);
      if (!cards.length) continue;

      cards.forEach(card => {
        const titleEl = findEl(card, SEL.title);
        if (!titleEl) return;

        const title = (titleEl.textContent || '').trim();
        if (!title) return;

        // Build a clean job URL
        const rawHref = titleEl.href || titleEl.closest('a')?.href || '';
        const urlMatch = rawHref.match(/(https?:\/\/[^?#]*)/);
        const url = urlMatch ? urlMatch[1] : rawHref;
        if (!url) return;

        // Extract job ID for deduplication
        const jobId = rawHref.match(/\/jobs\/view\/(\d+)/)?.[1]
          || card.dataset?.jobId
          || url;

        const company  = (findEl(card, SEL.company)?.textContent  || '').trim();
        const location = (findEl(card, SEL.location)?.textContent || '').trim();

        // Detect Easy Apply
        const easyApply =
          !!card.querySelector('[aria-label*="Easy Apply"]') ||
          !!card.querySelector('.job-card-container__easy-apply-label') ||
          (card.textContent || '').includes('Easy Apply');

        jobs.push({ _id: jobId, title, company, location, url, easy_apply: easyApply });
      });

      if (jobs.length > 0) break; // Found cards with this selector — stop trying others
    }

    return jobs;
  }

  // ── Status Overlay (subtle, non-intrusive) ────────────────────────────────────

  let overlay = null;

  function showStatus(msg) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:fixed', 'bottom:20px', 'right:20px', 'z-index:999999',
        'background:#1e1e2e', 'color:#cdd6f4', 'padding:10px 16px',
        'border-radius:10px', 'font-size:13px', 'font-family:sans-serif',
        'border:1px solid #45475a', 'box-shadow:0 4px 20px rgba(0,0,0,.5)',
        'max-width:260px', 'line-height:1.5',
      ].join(';');
      document.body.appendChild(overlay);
    }
    overlay.textContent = msg;
  }

  function removeStatus() {
    overlay?.remove();
    overlay = null;
  }

  // ── Main Harvest Loop ─────────────────────────────────────────────────────────

  async function harvest(params) {
    showStatus('🔍 Harvesting jobs… please wait');

    // Wait for page to fully stabilise
    await randDelay(2200, 3200);

    const container = getContainer();
    if (!container) {
      showStatus('❌ Job list not found. Make sure you are on a LinkedIn job search page.');
      await randDelay(3000, 3000);
      removeStatus();
      chrome.runtime.sendMessage({
        type: 'HARVEST_ERROR',
        error: 'Job list container not found on this page.',
      });
      return;
    }

    const seen    = new Map(); // jobId → job object
    let noNewCycles = 0;

    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      const beforeCount = seen.size;

      // Extract all currently visible job cards
      const jobs = extractVisibleJobs();
      jobs.forEach(j => {
        if (!seen.has(j._id)) seen.set(j._id, j);
      });

      const found = seen.size;
      showStatus(`🔍 Found ${found} jobs — scrolling (${cycle + 1}/${MAX_CYCLES})…`);

      // Report progress to popup
      chrome.runtime.sendMessage({
        type: 'HARVEST_PROGRESS',
        found,
        cycle: cycle + 1,
        total_cycles: MAX_CYCLES,
      });

      if (found >= MAX_JOBS) break;

      // Check if any new jobs appeared after last scroll
      if (found === beforeCount) {
        noNewCycles++;
        if (noNewCycles >= 3) break; // End of list
      } else {
        noNewCycles = 0;
      }

      // Human-like scroll with random amount
      const scrollPx = 250 + Math.floor(Math.random() * 250);
      container.scrollBy({ top: scrollPx, behavior: 'smooth' });

      // Random delay — anti-detection
      await randDelay(1300, 2700);
    }

    // Apply Easy Apply filter if requested
    let jobList = Array.from(seen.values()).slice(0, MAX_JOBS);
    if (params?.easy_apply_only) {
      jobList = jobList.filter(j => j.easy_apply);
    }

    // Clean up internal _id field before sending
    const cleanJobs = jobList.map(({ _id, ...j }) => ({ ...j, platform: 'linkedin' }));

    showStatus(`✅ Harvested ${cleanJobs.length} jobs — saving…`);

    // Always send jobs back immediately so the search page can display them
    chrome.runtime.sendMessage({
      type: 'HARVEST_COMPLETE',
      jobs: cleanJobs,
      total: cleanJobs.length,
    });

    // Also persist to backend (fire-and-forget)
    try {
      await fetch(`${API_BASE}/api/jobs/harvested`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs: cleanJobs }),
      });
    } catch (_) { /* backend save is optional */ }

    showStatus(`✅ Got ${cleanJobs.length} jobs from LinkedIn!`);
    await randDelay(2000, 2000);
    removeStatus();

  // ── Message Listener ──────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'BEGIN_HARVEST') {
      harvest(msg.params || {});
    }
  });

  // Signal ready to service worker
  chrome.runtime.sendMessage({ type: 'HARVESTER_READY' });

})();
