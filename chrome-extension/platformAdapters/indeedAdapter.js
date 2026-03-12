/**
 * Indeed Adapter
 * Handles Indeed's Smart Apply flow (iframe-based modal).
 */

window.IndeedAdapter = (() => {

  function findApplyButton() {
    return (
      document.querySelector('#indeedApplyButton, .indeed-apply-button, [data-indeed-apply-jobmeta]') ||
      document.querySelector('button[href*="apply"], a[href*="apply"]') ||
      findButtonByText(['apply now', 'apply on indeed', 'easy apply', 'apply'])
    );
  }

  function isLoginRequired() {
    return !!document.querySelector('#login-form, .auth-page');
  }

  function isAlreadyApplied() {
    return document.body.innerText?.includes('You applied') ||
           document.body.innerText?.includes('Application submitted');
  }

  function redirectsToNewPage() {
    // Indeed sometimes redirects to employer ATS
    const applyBtn = document.querySelector('#indeedApplyButton');
    if (!applyBtn) return false;
    // If it's a direct link (not Indeed's own apply), it redirects
    return applyBtn.tagName === 'A' && !applyBtn.href?.includes('indeed.com/apply');
  }

  function getFormContainer() {
    // Indeed Smart Apply uses an iframe
    const iframe = document.querySelector('#indeed-apply-widget iframe, .ia-BasePage');
    if (iframe) {
      return iframe.contentDocument?.body || iframe;
    }
    return document.querySelector('.ia-BasePage, [data-testid="ia-smart-apply"]') || document.body;
  }

  function findNextButton(container) {
    const c = container || document;
    return (
      c.querySelector('[data-testid="ia-next-btn"], [data-qa="ia-next-btn"]') ||
      findButtonByText(['next', 'continue', 'proceed'], c)
    );
  }

  function findSubmitButton(container) {
    const c = container || document;
    return (
      c.querySelector('[data-testid="ia-submit-btn"]') ||
      findButtonByText(['submit your resume', 'submit application', 'submit', 'apply now'], c)
    );
  }

  function isConfirmationPage() {
    return (
      document.body.innerText?.includes('application has been submitted') ||
      document.body.innerText?.includes('Your application was successfully') ||
      !!document.querySelector('[data-testid="ia-confirmation"]')
    );
  }

  function getErrorMessage() {
    return document.querySelector('[data-testid="ia-error"], .ia-errorMessage')?.textContent?.trim() || null;
  }

  function isFormPage() {
    return !!document.querySelector('#indeed-apply-widget, .ia-BasePage');
  }

  function findButtonByText(keywords, container = document) {
    const buttons = container.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      const text = btn.textContent?.toLowerCase().trim();
      for (const kw of keywords) {
        if (text?.includes(kw)) return btn;
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
