/**
 * Greenhouse ATS Adapter
 * Greenhouse is usually a single-page form on boards.greenhouse.io
 */

window.GreenhouseAdapter = (() => {

  function findApplyButton() {
    // Greenhouse typically loads directly as a form — no apply button needed
    return document.querySelector('form#application button[type="submit"]') ||
           findButtonByText(['submit application', 'apply', 'submit']);
  }

  function isLoginRequired() {
    return false; // Greenhouse forms are public-facing, no login
  }

  function isAlreadyApplied() {
    return document.body.innerText?.includes('already applied');
  }

  function redirectsToNewPage() {
    return false;
  }

  function getFormContainer() {
    return document.querySelector('#application, #greenhouse-application, main') || document.body;
  }

  function findNextButton(container) {
    // Greenhouse usually has a single-page form
    return findButtonByText(['next', 'continue'], container || document);
  }

  function findSubmitButton(container) {
    const c = container || document;
    return (
      c.querySelector('#submit_app, button[type="submit"]') ||
      findButtonByText(['submit application', 'submit', 'apply'], c)
    );
  }

  function isConfirmationPage() {
    return (
      document.body.innerText?.includes('Thank you for your application') ||
      document.body.innerText?.includes('successfully submitted') ||
      !!document.querySelector('.application--success, .confirmation')
    );
  }

  function getErrorMessage() {
    return document.querySelector('.error, .invalid-feedback, [class*="error"]')?.textContent?.trim() || null;
  }

  function isFormPage() {
    return !!(
      document.querySelector('#application, #greenhouse-application') ||
      window.location.hostname.includes('greenhouse.io')
    );
  }

  function findButtonByText(keywords, container = document) {
    const buttons = container.querySelectorAll('button, input[type="submit"], [role="button"]');
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || '')?.toLowerCase().trim();
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
