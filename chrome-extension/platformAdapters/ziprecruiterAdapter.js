/**
 * ZipRecruiter Adapter
 */

window.ZipRecruiterAdapter = (() => {

  function findApplyButton() {
    return (
      document.querySelector('.apply_button, #applyButtonContainer button, [data-testid="apply-button"]') ||
      findButtonByText(['apply now', 'quick apply', 'apply'])
    );
  }

  function isLoginRequired() {
    return !!document.querySelector('.login-modal, [data-testid="login-form"]');
  }

  function isAlreadyApplied() {
    return document.body.innerText?.includes('You applied to this job') ||
           !!document.querySelector('.applied-badge, [data-testid="applied-badge"]');
  }

  function redirectsToNewPage() {
    return false;
  }

  function getFormContainer() {
    return (
      document.querySelector('.apply-modal, [class*="ApplyModal"], [data-testid="apply-modal"]') ||
      document.body
    );
  }

  function findNextButton(container) {
    return findButtonByText(['next', 'continue'], container || document);
  }

  function findSubmitButton(container) {
    return findButtonByText(['submit application', 'apply now', 'submit'], container || document);
  }

  function isConfirmationPage() {
    return (
      document.body.innerText?.includes('Application Submitted') ||
      document.body.innerText?.includes('Thank you for applying') ||
      !!document.querySelector('.application-success, [data-testid="application-success"]')
    );
  }

  function getErrorMessage() {
    return document.querySelector('.form-error, [class*="error"]')?.textContent?.trim() || null;
  }

  function isFormPage() {
    return !!document.querySelector('.apply-modal, [data-testid="apply-modal"]');
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
