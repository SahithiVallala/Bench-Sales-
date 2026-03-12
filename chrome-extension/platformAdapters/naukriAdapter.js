/**
 * Naukri.com Adapter
 */

window.NaukriAdapter = (() => {

  function findApplyButton() {
    return (
      document.querySelector('.apply-button, #apply-button, [data-qa="apply-button"]') ||
      document.querySelector('button.btn-primary[type="button"]') ||
      findButtonByText(['apply', 'apply now'])
    );
  }

  function isLoginRequired() {
    return !!document.querySelector('.login-layer, #login-layer, .login-popup');
  }

  function isAlreadyApplied() {
    return (
      document.body.innerText?.includes('Already Applied') ||
      !!document.querySelector('.applied-status, .already-applied')
    );
  }

  function redirectsToNewPage() {
    return false;
  }

  function getFormContainer() {
    return (
      document.querySelector('.naukri-modal, .apply-popup, [class*="applyModal"]') ||
      document.body
    );
  }

  function findNextButton(container) {
    return findButtonByText(['next', 'continue'], container || document);
  }

  function findSubmitButton(container) {
    return findButtonByText(['submit', 'apply', 'send application'], container || document);
  }

  function isConfirmationPage() {
    return (
      document.body.innerText?.includes('Application Submitted') ||
      document.body.innerText?.includes('applied successfully') ||
      !!document.querySelector('.success-msg, .applied-success')
    );
  }

  function getErrorMessage() {
    return document.querySelector('.error-msg, .validation-error')?.textContent?.trim() || null;
  }

  function isFormPage() {
    return !!document.querySelector('.apply-popup, [class*="applyModal"]');
  }

  function findButtonByText(keywords, container = document) {
    const buttons = container.querySelectorAll('button, [role="button"], a.btn');
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
