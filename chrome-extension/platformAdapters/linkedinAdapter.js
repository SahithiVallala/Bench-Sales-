/**
 * LinkedIn Easy Apply Adapter
 * Handles LinkedIn's proprietary Easy Apply modal flow.
 */

window.LinkedInAdapter = (() => {

  function findApplyButton() {
    // 1. Easy Apply button (modal flow — best case, can fill completely)
    const easyApply = (
      document.querySelector('button[aria-label*="Easy Apply"]') ||
      document.querySelector('.artdeco-button--primary[aria-label*="Easy Apply"]') ||
      document.querySelector('[data-control-name="jobdetails_topcard_inapply"]') ||
      findButtonByText(['easy apply'])
    );
    if (easyApply) return easyApply;

    // 2. External Apply link (<a> — we'll redirect the current tab to the ATS)
    const externalLink = (
      document.querySelector('.jobs-apply-button--top-card a[href]') ||
      document.querySelector('.jobs-s-apply a[href]') ||
      document.querySelector('a.jobs-apply-button[href]')
    );
    if (externalLink) return externalLink;

    // 3. External Apply button (<button> — clicking opens ATS in new tab, SW handles it)
    return (
      document.querySelector('.jobs-apply-button--top-card button') ||
      document.querySelector('button.jobs-apply-button') ||
      findButtonByText(['apply now', 'apply on company website', 'apply'])
    );
  }

  function isLoginRequired() {
    return (
      !!document.querySelector('#username, .login__form, .authwall-join-form, .join-form') ||
      window.location.pathname.startsWith('/login') ||
      window.location.pathname.startsWith('/authwall') ||
      window.location.pathname.startsWith('/checkpoint')
    );
  }

  function isAlreadyApplied() {
    const btn = document.querySelector('.jobs-apply-button');
    return btn?.textContent?.toLowerCase().includes('applied') ||
           !!document.querySelector('[data-job-apply-status="ALREADY_APPLIED"]');
  }

  function redirectsToNewPage() {
    // LinkedIn Easy Apply uses a modal, not a redirect
    return false;
  }

  function getFormContainer() {
    // 1. LinkedIn's Apply dialog has aria-label="Apply to [Company Name]"
    //    NOTE: Do NOT use [aria-label*="Easy Apply"] — that matches the BUTTON, not the dialog.
    //    The dialog starts with "Apply to" (e.g. "Apply to Raas Infotek").
    const applyDialog = document.querySelector('[aria-label^="Apply to "]');
    if (applyDialog && applyDialog.tagName !== 'BUTTON' && applyDialog.tagName !== 'A') return applyDialog;

    // 2. Stable aria/data attribute selectors
    const byAttr = [
      document.querySelector('[aria-modal="true"]'),
      document.querySelector('[data-test-modal]'),
      document.querySelector('[data-test-modal-id]'),
    ];
    for (const el of byAttr) {
      if (el && el.querySelector('input, textarea, select')) return el;
    }

    // 3. Class-based selectors (LinkedIn occasionally changes these)
    const byClass = [
      '.jobs-easy-apply-modal',
      '.jobs-easy-apply-content',
      '[class*="easy-apply"]',
      '[class*="job-apply"]',
      '.artdeco-modal__content',
      '.artdeco-modal',
      '[role="dialog"]',
    ];
    for (const sel of byClass) {
      try {
        const el = document.querySelector(sel);
        if (el && el.querySelector('input, textarea, select')) return el;
      } catch (_) {}
    }

    // 4. Smart button-walk fallback: find a visible Next/Submit button inside the form
    //    and walk up the DOM until we find an ancestor that has inputs but is NOT too
    //    large (i.e. does NOT contain the LinkedIn navigation search bar).
    const navSearch = document.querySelector(
      'input[class*="search"], [data-global-nav-search-query], .search-global-typeahead__input, header input'
    );
    const buttons = document.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      if (btn.offsetParent === null) continue; // skip hidden buttons
      const text = (btn.textContent?.trim() || '') + ' ' + (btn.getAttribute('aria-label') || '');
      if (!/\b(next|continue|review|submit)\b/i.test(text) || btn.disabled) continue;
      let el = btn.parentElement;
      while (el && el !== document.body) {
        if (el.querySelector('input, textarea, select')) {
          // Reject if this container also contains the navigation search bar
          if (navSearch && el.contains(navSearch)) { el = el.parentElement; continue; }
          return el;
        }
        el = el.parentElement;
      }
    }

    return document.body;
  }

  function findNextButton(container) {
    const c = container || document;
    // LinkedIn buttons: "Next", "Continue", "Review", also aria-label variants
    const buttons = c.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      const text = (btn.textContent?.trim().toLowerCase() || '') + ' ' +
                   (btn.getAttribute('aria-label')?.toLowerCase() || '');
      if (/\b(next|continue|review)\b/.test(text) && !btn.disabled) {
        return btn;
      }
    }
    return null;
  }

  function findSubmitButton(container) {
    const c = container || document;
    const buttons = c.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      const text = (btn.textContent?.trim().toLowerCase() || '') + ' ' +
                   (btn.getAttribute('aria-label')?.toLowerCase() || '');
      if (/\b(submit application|submit|done)\b/.test(text) && !btn.disabled) {
        return btn;
      }
    }
    return null;
  }

  function isConfirmationPage() {
    // LinkedIn shows "Your application was sent" or confetti animation
    return !!(
      document.querySelector('.artdeco-inline-feedback--success') ||
      document.body.innerText?.includes('Your application was sent') ||
      document.body.innerText?.includes('application has been submitted')
    );
  }

  function getErrorMessage() {
    const el = document.querySelector('.artdeco-inline-feedback--error, .jobs-easy-apply-form-element__error');
    return el?.textContent?.trim() || null;
  }

  function isFormPage() {
    // LinkedIn's Apply DIALOG has aria-label="Apply to [Company]".
    // The Easy Apply BUTTON has aria-label="Easy Apply" — do NOT match that.
    // We check: element starts with "Apply to " AND is not a button/link.
    const applyDialog = document.querySelector('[aria-label^="Apply to "]');
    if (applyDialog && applyDialog.tagName !== 'BUTTON' && applyDialog.tagName !== 'A') return true;

    // Attribute-based (stable)
    if (document.querySelector('[aria-modal="true"], [data-test-modal]')) {
      const el = document.querySelector('[aria-modal="true"]') || document.querySelector('[data-test-modal]');
      if (el?.querySelector('input, textarea, select')) return true;
    }

    // Class-based
    const classDialog = document.querySelector('.jobs-easy-apply-modal, [class*="easy-apply"]');
    if (classDialog && classDialog.querySelector('input, textarea, select')) return true;
    if (document.querySelector('.artdeco-modal')?.querySelector('input, textarea, select')) return true;

    // Any role=dialog with input fields
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog && dialog.querySelector('input, textarea, select')) return true;

    return false;
  }

  function findButtonByText(keywords, container = document) {
    const buttons = container.querySelectorAll('button, [role="button"], a');
    for (const btn of buttons) {
      const text = btn.textContent?.toLowerCase().trim() || btn.getAttribute('aria-label')?.toLowerCase() || '';
      for (const kw of keywords) {
        if (text.includes(kw)) return btn;
      }
    }
    return null;
  }

  return {
    findApplyButton,
    isLoginRequired,
    isAlreadyApplied,
    redirectsToNewPage,
    getFormContainer,
    findNextButton,
    findSubmitButton,
    isConfirmationPage,
    getErrorMessage,
    isFormPage,
  };
})();
