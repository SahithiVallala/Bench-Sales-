/**
 * Human-Like Typing Utility
 * Types text into input fields character-by-character with realistic delays.
 * Fires native React/Vue-compatible events so framework state updates correctly.
 */

window.HumanTyping = (() => {

  /**
   * Type text into an input or textarea element, triggering all necessary events.
   * @param {HTMLElement} element - The input/textarea element
   * @param {string} text - Text to type
   * @param {object} options
   * @param {number} options.minDelay - Min ms between keystrokes (default 40)
   * @param {number} options.maxDelay - Max ms between keystrokes (default 120)
   * @param {boolean} options.clearFirst - Whether to clear existing value first (default true)
   */
  async function typeIntoField(element, text, options = {}) {
    const { minDelay = 40, maxDelay = 120, clearFirst = true } = options;

    if (!element || !text) return;

    // Focus the element first
    element.focus();
    await sleep(randomDelay(50, 150));

    // Clear existing value if requested
    if (clearFirst && element.value) {
      await clearField(element);
    }

    // Type character by character
    for (const char of String(text)) {
      // KeyDown
      element.dispatchEvent(new KeyboardEvent('keydown', {
        key: char,
        bubbles: true,
        cancelable: true,
      }));

      // Insert character into value via native input setter
      setNativeValue(element, element.value + char);

      // KeyPress (deprecated but some older forms need it)
      element.dispatchEvent(new KeyboardEvent('keypress', {
        key: char,
        bubbles: true,
        cancelable: true,
      }));

      // Input event (React/Vue listen to this)
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: char,
        inputType: 'insertText',
      }));

      // KeyUp
      element.dispatchEvent(new KeyboardEvent('keyup', {
        key: char,
        bubbles: true,
        cancelable: true,
      }));

      // Random delay between characters
      await sleep(randomDelay(minDelay, maxDelay));

      // Occasional longer pause to simulate natural rhythm
      if (Math.random() < 0.08) {
        await sleep(randomDelay(200, 500));
      }
    }

    // Blur to trigger validation
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    await sleep(randomDelay(100, 200));
  }

  /**
   * Clear a field using backspace simulation.
   */
  async function clearField(element) {
    element.focus();
    // Select all + delete
    element.select?.();
    setNativeValue(element, '');
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentBackward',
    }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(randomDelay(50, 100));
  }

  /**
   * Set value using React's internal state setter to bypass controlled component checks.
   * This is the key trick for React 16+ compatibility.
   */
  function setNativeValue(element, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      element.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else {
      element.value = value;
    }
  }

  /**
   * Click an element with a slight scroll-into-view and human pause.
   */
  async function humanClick(element) {
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(randomDelay(300, 700));
    element.click();
    await sleep(randomDelay(200, 400));
  }

  /**
   * Select an option in a <select> dropdown.
   */
  async function selectOption(selectElement, valueOrText) {
    if (!selectElement) return false;
    selectElement.focus();
    await sleep(randomDelay(100, 200));

    // Try matching by value first, then by text content
    const options = Array.from(selectElement.options);
    let matched = options.find(opt =>
      opt.value?.toLowerCase() === String(valueOrText).toLowerCase()
    ) || options.find(opt =>
      opt.text?.toLowerCase().includes(String(valueOrText).toLowerCase())
    );

    if (matched) {
      setNativeValue(selectElement, matched.value);
      selectElement.dispatchEvent(new Event('change', { bubbles: true }));
      selectElement.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(randomDelay(100, 200));
      return true;
    }
    return false;
  }

  /**
   * Check or uncheck a checkbox.
   */
  async function setCheckbox(element, shouldCheck) {
    if (!element) return;
    if (element.checked !== shouldCheck) {
      await humanClick(element);
    }
  }

  /**
   * Click a radio button by its value or label text.
   */
  async function clickRadio(container, valueOrLabel) {
    const radios = container.querySelectorAll('input[type="radio"]');
    for (const radio of radios) {
      const label = getLabelForInput(radio);
      if (
        radio.value?.toLowerCase() === String(valueOrLabel).toLowerCase() ||
        label?.toLowerCase().includes(String(valueOrLabel).toLowerCase())
      ) {
        await humanClick(radio);
        return true;
      }
    }
    return false;
  }

  /**
   * Simulate scrolling down a container to make elements visible.
   */
  async function scrollDown(element, pixels = 300) {
    const target = element || window;
    if (target === window) {
      window.scrollBy({ top: pixels, behavior: 'smooth' });
    } else {
      target.scrollTop += pixels;
    }
    await sleep(randomDelay(400, 800));
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function getLabelForInput(input) {
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) return label.textContent?.trim();
    }
    const parent = input.closest('label');
    if (parent) return parent.textContent?.trim();
    return null;
  }

  function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return {
    typeIntoField,
    clearField,
    humanClick,
    selectOption,
    setCheckbox,
    clickRadio,
    scrollDown,
    sleep,
    randomDelay,
  };
})();
