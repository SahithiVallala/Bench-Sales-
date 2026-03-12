/**
 * Modal Detector
 * Uses MutationObserver to detect dynamically rendered application modals and dialogs.
 * Notifies the main automation engine when a modal appears or disappears.
 */

window.ModalDetector = (() => {

  const MODAL_SELECTORS = [
    // Generic
    '[role="dialog"]',
    '[role="alertdialog"]',
    '.modal',
    '.dialog',
    '[class*="modal"]',
    '[class*="dialog"]',
    '[class*="overlay"]',
    '[class*="drawer"]',
    // LinkedIn Easy Apply
    '.jobs-easy-apply-modal',
    '.artdeco-modal',
    // Indeed
    '#indeed-apply-widget',
    '.ia-BasePage',
    '[data-testid="ia-smart-apply"]',
    // ZipRecruiter
    '.apply-modal',
    '[class*="ApplyModal"]',
    // Greenhouse / Lever
    '#application',
    '.application-form',
    '#app-main',
    // Workday
    '[data-automation-id="applicationFlow"]',
    '.gwt-DialogBox',
  ];

  let observer = null;
  let callbacks = {
    onOpen: null,
    onClose: null,
    onStep: null,
  };
  let activeModal = null;

  /**
   * Start watching for modals.
   * @param {object} opts
   * @param {Function} opts.onOpen - Called with the modal element when it opens
   * @param {Function} opts.onClose - Called when the modal closes
   * @param {Function} opts.onStep - Called when content within the modal changes (next step)
   */
  function startWatching({ onOpen, onClose, onStep } = {}) {
    callbacks = { onOpen, onClose, onStep };

    // Check if a modal is already present
    const existing = findModal();
    if (existing) {
      activeModal = existing;
      onOpen?.(existing);
      watchModalContents(existing);
    }

    observer = new MutationObserver(handleMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'aria-hidden', 'hidden'],
    });
  }

  function stopWatching() {
    observer?.disconnect();
    observer = null;
    activeModal = null;
  }

  function handleMutations(mutations) {
    for (const mutation of mutations) {
      // Check for newly added nodes that are modals
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const modal = isModal(node) ? node : node.querySelector?.(MODAL_SELECTORS.join(','));
          if (modal && isVisible(modal) && modal !== activeModal) {
            activeModal = modal;
            callbacks.onOpen?.(modal);
            watchModalContents(modal);
            return;
          }
        }

        // Check if active modal was removed
        if (activeModal && !document.body.contains(activeModal)) {
          activeModal = null;
          callbacks.onClose?.();
          return;
        }
      }

      // Check for visibility changes on existing modals
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (activeModal && (target === activeModal || activeModal.contains(target))) {
          // Modal content might have changed (new step)
          if (mutation.type === 'attributes') {
            callbacks.onStep?.(activeModal);
          }
          return;
        }

        // A previously hidden modal became visible
        if (isModal(target) && isVisible(target) && target !== activeModal) {
          activeModal = target;
          callbacks.onOpen?.(target);
          watchModalContents(target);
          return;
        }

        // Active modal became hidden
        if (target === activeModal && !isVisible(target)) {
          activeModal = null;
          callbacks.onClose?.();
        }
      }
    }
  }

  /**
   * Watch the modal's internal content for step changes (next page of form).
   */
  let contentObserver = null;
  function watchModalContents(modal) {
    contentObserver?.disconnect();

    contentObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // New form fields were added — likely a new step
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const hasInputs = node.querySelector?.('input, textarea, select, button');
              if (hasInputs) {
                callbacks.onStep?.(modal);
                return;
              }
            }
          }
        }
      }
    });

    contentObserver.observe(modal, { childList: true, subtree: true });
  }

  function findModal() {
    for (const selector of MODAL_SELECTORS) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function isModal(node) {
    if (!node?.querySelector) return false;
    for (const selector of MODAL_SELECTORS) {
      if (node.matches?.(selector)) return true;
    }
    return false;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hidden) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Wait for a modal to open, up to `timeout` ms.
   */
  function waitForModal(timeout = 8000) {
    return new Promise((resolve, reject) => {
      const existing = findModal();
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const modal = findModal();
        if (modal) {
          observer.disconnect();
          resolve(modal);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error('waitForModal timeout'));
      }, timeout);
    });
  }

  /**
   * Wait for the current modal to close.
   */
  function waitForModalClose(modal, timeout = 15000) {
    return new Promise((resolve) => {
      if (!modal || !document.body.contains(modal) || !isVisible(modal)) {
        return resolve();
      }

      const checkInterval = setInterval(() => {
        if (!document.body.contains(modal) || !isVisible(modal)) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);

      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(); // Resolve anyway to avoid hanging
      }, timeout);
    });
  }

  return {
    startWatching,
    stopWatching,
    findModal,
    waitForModal,
    waitForModalClose,
    isVisible,
  };
})();
