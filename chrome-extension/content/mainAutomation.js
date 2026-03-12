/**
 * Main Automation Engine — State Machine
 *
 * NEW DESIGN (MV3-safe):
 * - Does NOT use CONTENT_READY pull pattern (unreliable with SW restarts).
 * - Waits for a BEGIN_AUTOMATION push message from the background service worker.
 * - Background opens the tab → onUpdated fires → background sends BEGIN_AUTOMATION.
 *
 * States:
 *   IDLE → APPLY_CLICKED → FORM_OPENED → FILLING_FORM →
 *   NEXT_STEP → SUBMITTING → APPLICATION_COMPLETE → ERROR → SKIPPED
 */

(() => {
  'use strict';

  const States = {
    IDLE:                 'IDLE',
    APPLY_CLICKED:        'APPLY_CLICKED',
    FORM_OPENED:          'FORM_OPENED',
    FILLING_FORM:         'FILLING_FORM',
    NEXT_STEP:            'NEXT_STEP',
    SUBMITTING:           'SUBMITTING',
    APPLICATION_COMPLETE: 'APPLICATION_COMPLETE',
    ERROR:                'ERROR',
    SKIPPED:              'SKIPPED',
  };

  let currentState        = States.IDLE;
  let profile             = null;
  let jobContext          = {};
  let stepCount           = 0;
  let isPaused            = false;
  let isRunning           = false;
  let detectedContainer   = null; // Set by pollForForm when it locates the form

  const { sleep, randomDelay, humanClick, scrollDown } = window.HumanTyping;
  const { findButton }                                  = window.FieldDetector;
  const { fillForm, fillScreeningQuestions, uploadResume } = window.FormFiller;

  // Safe overlay wrapper — overlay is optional, never crash automation if it fails
  const overlay = {
    create: () => { try { window.StatusOverlay?.create(); } catch(e) { console.warn('[Overlay]', e); } },
    update: (o) => { try { window.StatusOverlay?.update(o); } catch(e) { console.warn('[Overlay]', e); } },
    destroy: () => { try { window.StatusOverlay?.destroy(); } catch(e) { console.warn('[Overlay]', e); } },
  };

  // ── Platform Adapter ─────────────────────────────────────────────────────────

  function getAdapter() {
    const host = window.location.hostname;
    if (host.includes('linkedin.com'))      return window.LinkedInAdapter;
    if (host.includes('indeed.com'))        return window.IndeedAdapter;
    if (host.includes('ziprecruiter.com'))  return window.ZipRecruiterAdapter;
    if (host.includes('naukri.com'))        return window.NaukriAdapter;
    if (host.includes('dice.com'))          return window.DiceAdapter;
    if (host.includes('myworkdayjobs.com')) return window.WorkdayAdapter;
    if (host.includes('greenhouse.io'))     return window.GreenhouseAdapter;
    if (host.includes('lever.co'))          return window.LeverAdapter;
    return null;
  }

  // ── Message Listener (entry point) ───────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'BEGIN_AUTOMATION') {
      if (isRunning) { sendResponse({ ok: true }); return; }
      profile    = message.profile;
      jobContext = {
        title:    message.job?.title    || document.title || '',
        company:  message.job?.company  || '',
        url:      message.job?.url      || window.location.href,
        platform: message.job?.platform || detectPlatform(),
      };
      isPaused  = message.isPaused || false;
      isRunning = true;

      // Init floating overlay
      overlay.create();
      overlay.update({
        jobTitle: jobContext.title,
        jobCompany: jobContext.company,
        stepText: 'Starting automation...',
        stats: message.stats || { applied: 0, skipped: 0, errors: 0 },
        progress: message.stats || { applied: 0, skipped: 0, errors: 0, total: 0 },
      });

      sendResponse({ ok: true });
      startAutomation();
      return true;
    }

    if (message.type === 'PAUSE')  {
      isPaused = true;
      overlay.update({ stepText: 'Paused', isPaused: true });
      sendResponse({ ok: true }); return;
    }
    if (message.type === 'RESUME') {
      isPaused = false;
      overlay.update({ stepText: 'Resuming...', isPaused: false });
      sendResponse({ ok: true }); return;
    }
    if (message.type === 'STOP')   {
      currentState = States.SKIPPED;
      isRunning = false;
      overlay.update({ stepText: 'Stopped by user', isDone: true });
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'STATE_UPDATE' && message.state) {
      // Update overlay with global progress from background
      overlay.update({
        stats: message.state.stats,
        progress: { ...message.state.stats, total: message.state.stats?.total || 0 },
      });
      return;
    }
  });

  // ── State Machine Entry ───────────────────────────────────────────────────────

  async function startAutomation() {
    if (isPaused) await waitForResume();

    const adapter = getAdapter();
    if (!adapter) {
      return skip('Unsupported platform: ' + window.location.hostname);
    }

    // Give page extra time to settle (React/Vue hydration)
    await sleep(randomDelay(1500, 2500));

    try {
      await runStateMachine(adapter);
    } catch (err) {
      console.error('[AutoApply] Uncaught error:', err);
      reportError(err.message);
    }
  }

  async function runStateMachine(adapter) {
    // ── Check blockers ──────────────────────────────────────────────────────
    if (adapter.isLoginRequired?.()) {
      return skip('Login required — please log in to ' + window.location.hostname);
    }
    if (adapter.isAlreadyApplied?.()) {
      return skip('Already applied to this job');
    }

    // ── Page IS the form (Greenhouse, Lever, Workday) ───────────────────────
    if (adapter.isFormPage?.()) {
      setState(States.FORM_OPENED);
      await fillAndSubmit(adapter);
      return;
    }

    // ── Find and click Apply button ─────────────────────────────────────────
    setState(States.APPLY_CLICKED);
    await scrollDown(null, 300);
    await sleep(randomDelay(500, 1000));

    const applyBtn = adapter.findApplyButton?.();
    if (!applyBtn) {
      return skip('Apply button not found on ' + window.location.hostname);
    }

    // If it's an external <a> link (e.g. LinkedIn external Apply), redirect
    // THIS tab to the ATS URL instead of letting it open a new tab untracked.
    // The background's onUpdated listener will handle the new page.
    if (applyBtn.tagName === 'A' && applyBtn.href && applyBtn.target === '_blank') {
      console.log('[AutoApply] External apply link — redirecting this tab to:', applyBtn.href);
      window.location.href = applyBtn.href;
      return; // Do NOT call skip()/reportApplied() — let onUpdated restart on ATS page
    }

    // Snapshot all inputs on the page BEFORE clicking Apply.
    // pollForForm will use this to detect new inputs that appear after the modal opens.
    const inputsBefore = new Set(document.querySelectorAll('input, select, textarea'));

    await humanClick(applyBtn);
    await sleep(randomDelay(800, 1500));

    // ── Wait for form to appear (modal, new page, or inline) ─────────────
    setState(States.FORM_OPENED);
    detectedContainer = null;

    if (!adapter.redirectsToNewPage?.()) {
      const formFound = await pollForForm(adapter, 20000, inputsBefore);
      if (!formFound) {
        // Last resort: skip rather than typing into wrong fields
        return skip('Application form did not appear after clicking Apply');
      }
    } else {
      await sleep(3000);
    }

    await fillAndSubmit(adapter);
  }

  // ── Multi-step form loop ──────────────────────────────────────────────────────

  async function fillAndSubmit(adapter) {
    stepCount = 0;
    const MAX_STEPS = 12;

    while (stepCount < MAX_STEPS) {
      if (!isRunning || currentState === States.SKIPPED) return;
      if (isPaused) await waitForResume();

      stepCount++;
      setState(States.FILLING_FORM);
      overlay.update({ stepText: `Filling form (step ${stepCount})...` });

      // Find the best form container.
      // Priority: 1) container detected by pollForForm's new-input scan
      //           2) adapter's own detection logic
      //           3) fallback selectors
      let container = detectedContainer || adapter.getFormContainer?.();

      if (!container || container === document.body) {
        container = document.querySelector('[aria-label^="Apply to "]') ||
                    document.querySelector('[aria-modal="true"]') ||
                    document.querySelector('[data-test-modal]') ||
                    document.querySelector('[role="dialog"]') ||
                    document.querySelector('.artdeco-modal') ||
                    document.querySelector('[class*="modal"]') ||
                    document.querySelector('[class*="easy-apply"]') ||
                    document.querySelector('form');
      }

      // Hard stop: never fill when we still don't have a real container
      if (!container || container === document.body) {
        return skip('Could not identify application form container on step ' + stepCount);
      }

      console.log(`[AutoApply] Step ${stepCount}: container=${container.tagName} class="${(container.className || '').substring(0, 60)}"`);
      await sleep(randomDelay(400, 800));

      // Upload resume on first step
      if (stepCount === 1 && profile?.file_url) {
        await uploadResume(container, profile);
        await sleep(randomDelay(500, 1000));
      }

      // Fill all detectable fields
      const { filled, skipped } = await fillForm(container, profile, jobContext);
      console.log(`[AutoApply] Step ${stepCount}: filled=${filled} skipped=${skipped}`);

      // Fill screening questions
      await fillScreeningQuestions(container, profile, jobContext);
      await sleep(randomDelay(400, 800));

      // Find buttons — search in container first, then fall back to entire document
      const submitBtn = adapter.findSubmitButton?.(container) ||
                        findButton(['submit application', 'submit', 'apply now', 'send application'], container) ||
                        adapter.findSubmitButton?.(document) ||
                        findButton(['submit application', 'submit', 'apply now'], document);
      const nextBtn   = adapter.findNextButton?.(container) ||
                        findButton(['next', 'continue', 'proceed', 'review'], container) ||
                        adapter.findNextButton?.(document) ||
                        findButton(['next', 'continue', 'proceed', 'review'], document);

      console.log(`[AutoApply] Step ${stepCount}: submitBtn=${!!submitBtn} nextBtn=${!!nextBtn}`);

      if (submitBtn && isMoreProminent(submitBtn, nextBtn)) {
        // Submit
        setState(States.SUBMITTING);
        await humanClick(submitBtn);
        await sleep(randomDelay(2000, 4000));

        if (adapter.isConfirmationPage?.() || isGenericConfirmation()) {
          setState(States.APPLICATION_COMPLETE);
          reportApplied();
          return;
        }

        const errMsg = adapter.getErrorMessage?.();
        if (errMsg) { reportError('Submit error: ' + errMsg); return; }

        // No confirmation and no error — assume success
        setState(States.APPLICATION_COMPLETE);
        reportApplied();
        return;

      } else if (nextBtn) {
        setState(States.NEXT_STEP);
        await humanClick(nextBtn);
        await sleep(randomDelay(1200, 2500));

        if (adapter.isConfirmationPage?.() || isGenericConfirmation()) {
          setState(States.APPLICATION_COMPLETE);
          reportApplied();
          return;
        }

      } else {
        if (adapter.isConfirmationPage?.() || isGenericConfirmation()) {
          setState(States.APPLICATION_COMPLETE);
          reportApplied();
          return;
        }
        return skip('No Next or Submit button found on step ' + stepCount);
      }
    }

    reportError('Exceeded maximum form steps (' + MAX_STEPS + ')');
  }

  // ── Outcome reporters ─────────────────────────────────────────────────────────

  function reportApplied() {
    console.log('[AutoApply] SUCCESS');
    isRunning = false;
    overlay.update({ stepText: 'Applied successfully!', isDone: true });
    chrome.runtime.sendMessage({ type: 'JOB_APPLIED', payload: { note: 'Auto-applied successfully' } });
  }

  function skip(reason) {
    console.log('[AutoApply] SKIP —', reason);
    isRunning = false;
    overlay.update({ stepText: 'Skipped: ' + reason, isDone: true });
    chrome.runtime.sendMessage({ type: 'JOB_SKIPPED', payload: { reason } });
  }

  function reportError(reason) {
    console.error('[AutoApply] ERROR —', reason);
    isRunning = false;
    overlay.update({ stepText: 'Error: ' + reason, isDone: true });
    chrome.runtime.sendMessage({ type: 'JOB_ERROR', payload: { reason } });
  }

  const STATE_LABELS = {
    IDLE:                 'Idle',
    APPLY_CLICKED:        'Clicking Apply button...',
    FORM_OPENED:          'Waiting for form...',
    FILLING_FORM:         'Filling form fields...',
    NEXT_STEP:            'Clicking Next...',
    SUBMITTING:           'Submitting application...',
    APPLICATION_COMPLETE: 'Application submitted!',
    ERROR:                'Error occurred',
    SKIPPED:              'Skipped',
  };

  function setState(newState) {
    console.log('[AutoApply]', currentState, '→', newState);
    currentState = newState;
    overlay.update({ stepText: STATE_LABELS[newState] || newState });
  }

  // ── Pause/resume ──────────────────────────────────────────────────────────────

  async function waitForResume() {
    return new Promise(resolve => {
      const check = setInterval(() => {
        if (!isPaused || !isRunning) { clearInterval(check); resolve(); }
      }, 500);
    });
  }

  // ── Poll for form appearance ─────────────────────────────────────────────────

  /**
   * Polls the DOM every 500ms for up to `timeout` ms looking for a form.
   * Much more reliable than MutationObserver for detecting dynamically rendered
   * modals (LinkedIn, Indeed, etc.).
   */
  /**
   * @param {Set} inputsBefore - snapshot of all inputs BEFORE clicking Apply
   */
  async function pollForForm(adapter, timeout = 10000, inputsBefore = null) {
    const start = Date.now();
    let attempt = 0;
    while (Date.now() - start < timeout) {
      attempt++;

      // 0. NEW-INPUT SCAN: look for inputs that appeared AFTER clicking Apply.
      //    This is the most reliable method — works regardless of HTML structure.
      if (inputsBefore) {
        const allInputs = document.querySelectorAll('input, select, textarea');
        const newInputs = Array.from(allInputs).filter(el => {
          if (inputsBefore.has(el)) return false;
          if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return false;
          if (el.closest('nav, header, [role="navigation"], [role="search"]')) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0; // must be visible
        });
        if (newInputs.length > 0) {
          console.log('[AutoApply] pollForForm: found', newInputs.length, 'new inputs after click');
          // Walk up from the first new input to find the smallest container
          // that holds all of them (the form panel).
          detectedContainer = findFormContainer(newInputs);
          console.log('[AutoApply] pollForForm: detectedContainer =', detectedContainer?.tagName, detectedContainer?.className?.substring?.(0, 80));
          return true;
        }
      }

      // 1. LinkedIn Apply DIALOG aria-label (stable — dialog says "Apply to [Company]")
      //    Do NOT use aria-label*="Easy Apply" — that matches the BUTTON, not the dialog.
      const applyDialogEl = document.querySelector('[aria-label^="Apply to "]');
      if (applyDialogEl && applyDialogEl.tagName !== 'BUTTON' && applyDialogEl.tagName !== 'A') {
        console.log('[AutoApply] pollForForm: found via aria-label Apply dialog');
        detectedContainer = applyDialogEl;
        return true;
      }

      // 1. Adapter says it's a form page
      try {
        if (adapter.isFormPage?.()) {
          console.log('[AutoApply] pollForForm: adapter.isFormPage() = true');
          return true;
        }
      } catch (e) { console.warn('[AutoApply] isFormPage error:', e); }

      // 2. Adapter's form container is NOT document.body
      try {
        const container = adapter.getFormContainer?.();
        if (container && container !== document.body) {
          const hasInputs = container.querySelector('input, textarea, select');
          if (hasInputs) {
            console.log('[AutoApply] pollForForm: form container with inputs found', container.tagName, container.className);
            return true;
          }
        }
      } catch (e) { console.warn('[AutoApply] getFormContainer error:', e); }

      // 3. Selector-based detection (sets detectedContainer when found)
      const selectors = [
        '[aria-modal="true"]',
        '[data-test-modal]',
        '[data-test-modal-id]',
        '[role="dialog"]', '[role="alertdialog"]',
        '.artdeco-modal', '.artdeco-modal__content',
        '[class*="modal"]', '[class*="dialog"]',
        '[class*="easy-apply"]', '[class*="job-apply"]',
        '.jobs-easy-apply-content', '.jobs-easy-apply-modal',
        'form',
      ];
      for (const sel of selectors) {
        try {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            if (el.querySelector('input, textarea, select')) {
              console.log(`[AutoApply] pollForForm: found via "${sel}" — tag=${el.tagName} class="${el.className?.substring?.(0,80)}"`);
              detectedContainer = el;
              return true;
            }
          }
        } catch (_) {}
      }

      // 4. Button-walk: find visible Next/Submit button and walk up to its form panel.
      try {
        const navSearch = document.querySelector('header input, [role="search"] input');
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          if (btn.offsetParent === null) continue;
          const text = (btn.textContent?.trim() || '') + ' ' + (btn.getAttribute('aria-label') || '');
          if (!/\b(next|continue|review|submit)\b/i.test(text) || btn.disabled) continue;
          let el = btn.parentElement;
          while (el && el !== document.body) {
            if (el.querySelector('input, textarea, select')) {
              if (navSearch && el.contains(navSearch)) { el = el.parentElement; continue; }
              console.log('[AutoApply] pollForForm: found via button-walk', el.tagName, el.className?.substring?.(0,80));
              detectedContainer = el;
              return true;
            }
            el = el.parentElement;
          }
        }
      } catch (_) {}

      // Log debug info every 2 seconds
      if (attempt % 4 === 0) {
        const allDialogs = document.querySelectorAll('[role="dialog"]');
        const allModals = document.querySelectorAll('[class*="modal"]');
        const allForms = document.querySelectorAll('form');
        const allBtns = Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim().substring(0,20)).filter(Boolean).join(', ');
        console.log(`[AutoApply] pollForForm attempt ${attempt}: dialogs=${allDialogs.length} modals=${allModals.length} forms=${allForms.length} inputs=${document.querySelectorAll('input, select, textarea').length} buttons="${allBtns}"`);
      }

      await sleep(500);
    }
    // Final debug dump
    console.warn('[AutoApply] pollForForm TIMEOUT. DOM summary:');
    console.warn('  dialogs:', document.querySelectorAll('[role="dialog"]').length);
    console.warn('  modals:', document.querySelectorAll('[class*="modal"]').length);
    console.warn('  forms:', document.querySelectorAll('form').length);
    console.warn('  inputs:', document.querySelectorAll('input').length);
    console.warn('  body children:', document.body.children.length);
    return false;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Given a list of new input elements that appeared after clicking Apply,
   * walk up the DOM to find the smallest container that holds all of them.
   * This gives us the modal/panel element regardless of its class names.
   */
  function findFormContainer(newInputs) {
    if (!newInputs || newInputs.length === 0) return null;
    const navSearch = document.querySelector('header input, [role="search"] input');
    // Start from the first input and walk up
    let el = newInputs[0].parentElement;
    while (el && el !== document.body) {
      // Check this ancestor contains ALL new inputs
      const containsAll = newInputs.every(inp => el.contains(inp));
      if (containsAll) {
        // Reject if it's too large (contains the nav search bar)
        if (navSearch && el.contains(navSearch)) { el = el.parentElement; continue; }
        return el;
      }
      el = el.parentElement;
    }
    // Fallback: return direct parent of first input
    return newInputs[0].closest('div, section, aside') || newInputs[0].parentElement;
  }

  function isMoreProminent(submitBtn, nextBtn) {
    if (!nextBtn) return true;
    const nextStyle = window.getComputedStyle(nextBtn);
    if (nextStyle.display === 'none' || nextStyle.visibility === 'hidden') return true;
    if (nextBtn.disabled) return true;
    return false;
  }

  function isGenericConfirmation() {
    const text = (document.body.innerText || '').toLowerCase();
    return (
      text.includes('application submitted') ||
      text.includes('successfully applied') ||
      text.includes('thank you for applying') ||
      text.includes('your application has been') ||
      text.includes('application has been submitted') ||
      text.includes('we have received your application')
    );
  }

  function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('linkedin.com'))      return 'linkedin';
    if (host.includes('indeed.com'))        return 'indeed';
    if (host.includes('ziprecruiter.com'))  return 'ziprecruiter';
    if (host.includes('naukri.com'))        return 'naukri';
    if (host.includes('dice.com'))          return 'dice';
    if (host.includes('myworkdayjobs.com')) return 'workday';
    if (host.includes('greenhouse.io'))     return 'greenhouse';
    if (host.includes('lever.co'))          return 'lever';
    return 'unknown';
  }

})();
