/**
 * Dice.com Adapter
 */

window.DiceAdapter = (() => {

  function findApplyButton() {
    return (
      document.querySelector('[data-cy="apply-button"], .btn-apply, #apply-now-button') ||
      findButtonByText(['apply now', 'easy apply', 'apply'])
    );
  }

  function isLoginRequired() {
    return !!document.querySelector('.login-modal, [data-cy="login-form"]');
  }

  function isAlreadyApplied() {
    return (
      !!document.querySelector('[data-cy="already-applied"]') ||
      document.body.innerText?.includes('Already Applied')
    );
  }

  function redirectsToNewPage() {
    return false;
  }

  function getFormContainer() {
    return (
      document.querySelector('[data-cy="apply-modal"], .apply-modal, [class*="ApplyModal"]') ||
      document.body
    );
  }

  function findNextButton(container) {
    return findButtonByText(['next', 'continue'], container || document);
  }

  function findSubmitButton(container) {
    return (
      (container || document).querySelector('[data-cy="submit-application"]') ||
      findButtonByText(['submit application', 'submit', 'apply now'], container || document)
    );
  }

  function isConfirmationPage() {
    return (
      !!document.querySelector('[data-cy="application-submitted"]') ||
      document.body.innerText?.includes('Application Submitted') ||
      document.body.innerText?.includes('successfully submitted')
    );
  }

  function getErrorMessage() {
    return document.querySelector('[data-cy="form-error"], .error-message')?.textContent?.trim() || null;
  }

  function isFormPage() {
    return !!document.querySelector('[data-cy="apply-modal"]');
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
