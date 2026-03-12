/**
 * Lever ATS Adapter
 * Lever hosts job applications on jobs.lever.co/company/job-id/apply
 */

window.LeverAdapter = (() => {

  function findApplyButton() {
    return (
      document.querySelector('a[href*="/apply"], .lever-apply-button') ||
      findButtonByText(['apply for this job', 'apply now', 'apply'])
    );
  }

  function isLoginRequired() {
    return false; // Lever is public-facing
  }

  function isAlreadyApplied() {
    return document.body.innerText?.includes('already submitted an application');
  }

  function redirectsToNewPage() {
    // Lever's apply page is a separate /apply URL
    return !window.location.pathname.includes('/apply');
  }

  function getFormContainer() {
    return document.querySelector('#application-form, .application-form, main') || document.body;
  }

  function findNextButton(container) {
    return findButtonByText(['next', 'continue'], container || document);
  }

  function findSubmitButton(container) {
    const c = container || document;
    return (
      c.querySelector('button[type="submit"], input[type="submit"]') ||
      findButtonByText(['submit application', 'submit', 'apply'], c)
    );
  }

  function isConfirmationPage() {
    return (
      document.body.innerText?.includes('Your application has been submitted') ||
      document.body.innerText?.includes('successfully applied') ||
      !!document.querySelector('.confirmation-message, .success-message')
    );
  }

  function getErrorMessage() {
    return document.querySelector('.error-message, .field-error')?.textContent?.trim() || null;
  }

  function isFormPage() {
    return !!(
      window.location.pathname.includes('/apply') ||
      document.querySelector('#application-form, .application-form')
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
