/**
 * Workday ATS Adapter
 * Workday is a full-page multi-step application (no modal).
 * Pages load step-by-step within the same SPA.
 */

window.WorkdayAdapter = (() => {

  function findApplyButton() {
    return (
      document.querySelector('[data-automation-id="applyButton"]') ||
      document.querySelector('button[title="Apply"]') ||
      findButtonByText(['apply', 'apply now', 'apply manually'])
    );
  }

  function isLoginRequired() {
    return !!document.querySelector('[data-automation-id="signInWithCredentials"]');
  }

  function isAlreadyApplied() {
    return document.body.innerText?.includes('Already Applied') ||
           !!document.querySelector('[data-automation-id="alreadyApplied"]');
  }

  function redirectsToNewPage() {
    // Workday opens a new tab or redirects to the careers portal
    return true;
  }

  function getFormContainer() {
    return (
      document.querySelector('[data-automation-id="applicationFlow"]') ||
      document.querySelector('.WKUX-base-template-content, main') ||
      document.body
    );
  }

  function findNextButton(container) {
    const c = container || document;
    return (
      c.querySelector('[data-automation-id="bottom-navigation-next-button"]') ||
      c.querySelector('button[data-automation-id*="next"]') ||
      findButtonByText(['next', 'save and continue', 'continue'], c)
    );
  }

  function findSubmitButton(container) {
    const c = container || document;
    return (
      c.querySelector('[data-automation-id="bottom-navigation-submit-button"]') ||
      findButtonByText(['submit', 'review and submit'], c)
    );
  }

  function isConfirmationPage() {
    return (
      !!document.querySelector('[data-automation-id="successMessage"]') ||
      document.body.innerText?.includes('Thank you for applying') ||
      document.body.innerText?.includes('Application Submitted')
    );
  }

  function getErrorMessage() {
    return (
      document.querySelector('[data-automation-id="errorMessage"], .WKUX-error')?.textContent?.trim() || null
    );
  }

  function isFormPage() {
    return !!(
      document.querySelector('[data-automation-id="applicationFlow"]') ||
      window.location.href.includes('myworkdayjobs.com/en-US/') ||
      window.location.href.includes('/apply/')
    );
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
