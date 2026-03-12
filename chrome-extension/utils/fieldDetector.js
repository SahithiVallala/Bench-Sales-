/**
 * Semantic Field Detector
 * Identifies form fields by their label text (not CSS selectors).
 * This approach works across different ATS systems and form implementations.
 */

window.FieldDetector = (() => {

  /**
   * Field type definitions with keywords that identify them.
   * Each entry maps to a candidate profile field.
   */
  const FIELD_DEFINITIONS = {
    first_name: {
      keywords: ['first name', 'firstname', 'given name', 'fname'],
      type: 'text',
    },
    last_name: {
      keywords: ['last name', 'lastname', 'surname', 'family name', 'lname'],
      type: 'text',
    },
    full_name: {
      keywords: ['full name', 'name', 'your name', 'candidate name'],
      type: 'text',
    },
    email: {
      keywords: ['email', 'e-mail', 'email address', 'work email'],
      type: 'email',
    },
    phone: {
      keywords: ['phone', 'mobile', 'cell', 'telephone', 'contact number', 'phone number'],
      type: 'tel',
    },
    linkedin: {
      keywords: ['linkedin', 'linkedin profile', 'linkedin url', 'linkedin.com'],
      type: 'url',
    },
    website: {
      keywords: ['website', 'portfolio', 'personal website', 'github', 'github url'],
      type: 'url',
    },
    location: {
      keywords: ['location', 'city', 'city, state', 'current location', 'where do you live'],
      type: 'text',
    },
    zip_code: {
      keywords: ['zip', 'zip code', 'postal code', 'postcode'],
      type: 'text',
    },
    experience_years: {
      keywords: ['years of experience', 'total experience', 'years experience', 'how many years'],
      type: 'number',
    },
    current_company: {
      keywords: ['current company', 'current employer', 'company name', 'employer'],
      type: 'text',
    },
    current_title: {
      keywords: ['current title', 'job title', 'current role', 'position title'],
      type: 'text',
    },
    resume: {
      keywords: ['resume', 'cv', 'upload resume', 'attach resume', 'resume/cv'],
      type: 'file',
    },
    cover_letter: {
      keywords: ['cover letter', 'cover letter text', 'message to hiring manager'],
      type: 'textarea',
    },
    salary: {
      keywords: ['salary', 'expected salary', 'desired salary', 'compensation', 'annual salary', 'pay'],
      type: 'text',
    },
    rate: {
      keywords: ['hourly rate', 'bill rate', 'rate expectation', 'hourly'],
      type: 'text',
    },
    work_auth: {
      keywords: ['work authorization', 'authorized to work', 'eligible to work', 'visa status', 'require sponsorship', 'sponsorship'],
      type: 'radio_or_select',
    },
    gender: {
      keywords: ['gender', 'sex'],
      type: 'radio_or_select',
    },
    ethnicity: {
      keywords: ['ethnicity', 'race', 'racial'],
      type: 'radio_or_select',
    },
    veteran: {
      keywords: ['veteran', 'military', 'protected veteran'],
      type: 'radio_or_select',
    },
    disability: {
      keywords: ['disability', 'disabled', 'accommodation'],
      type: 'radio_or_select',
    },
    start_date: {
      keywords: ['start date', 'available to start', 'when can you start', 'earliest start'],
      type: 'text',
    },
    education: {
      keywords: ['education', 'degree', 'highest education', 'highest degree'],
      type: 'radio_or_select',
    },
    school: {
      keywords: ['school', 'university', 'college', 'institution'],
      type: 'text',
    },
    gpa: {
      keywords: ['gpa', 'grade point', 'cgpa'],
      type: 'number',
    },
    skills: {
      keywords: ['skills', 'technical skills', 'key skills'],
      type: 'textarea',
    },
    summary: {
      keywords: ['summary', 'about yourself', 'professional summary', 'tell us about'],
      type: 'textarea',
    },
    referral: {
      keywords: ['how did you hear', 'referred by', 'referral source', 'where did you find'],
      type: 'text_or_select',
    },
    relocate: {
      keywords: ['willing to relocate', 'open to relocation', 'relocation'],
      type: 'radio_or_select',
    },
    remote: {
      keywords: ['remote', 'work from home', 'work remotely', 'open to remote'],
      type: 'radio_or_select',
    },
  };

  /**
   * Get all interactive form fields in a container and identify their semantic type.
   * @param {HTMLElement} container - The form or modal container
   * @returns {Array<{element, fieldType, label, inputType}>}
   */
  function detectFields(container = document) {
    const results = [];
    const inputs = container.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), ' +
      'textarea, ' +
      'select, ' +
      '[role="combobox"], ' +
      '[role="listbox"], ' +
      '[contenteditable="true"]'
    );

    for (const input of inputs) {
      if (!isVisible(input)) continue;
      const label = getLabel(input);
      const fieldType = identifyFieldType(label, input);
      results.push({
        element: input,
        fieldType,
        label,
        inputType: input.type || input.tagName.toLowerCase(),
      });
    }

    return results;
  }

  /**
   * Find a specific field by semantic type in a container.
   * @param {string} type - One of the keys in FIELD_DEFINITIONS
   * @param {HTMLElement} container
   * @returns {HTMLElement|null}
   */
  function findField(type, container = document) {
    const fields = detectFields(container);
    const found = fields.find(f => f.fieldType === type);
    return found?.element || null;
  }

  /**
   * Find all form groups (label+input pairs) in a container.
   * Used for screening question detection.
   * @param {HTMLElement} container
   * @returns {Array<{question: string, element: HTMLElement, type: string}>}
   */
  function detectFormGroups(container = document) {
    const groups = [];
    // Find all visible inputs with associated labels
    const inputs = container.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
    );

    for (const input of inputs) {
      if (!isVisible(input)) continue;
      const label = getLabel(input);
      if (label && label.length > 3) {
        const fieldType = identifyFieldType(label, input);
        groups.push({
          question: label,
          element: input,
          type: fieldType || 'unknown',
          inputType: input.type || input.tagName.toLowerCase(),
        });
      }
    }

    return groups;
  }

  /**
   * Identify the semantic field type based on label text and input attributes.
   */
  function identifyFieldType(label, input) {
    const text = (label || '').toLowerCase();
    const placeholder = (input?.placeholder || '').toLowerCase();
    const name = (input?.name || input?.id || '').toLowerCase();
    const combined = `${text} ${placeholder} ${name}`;

    // Check HTML input type hints first
    if (input?.type === 'email') return 'email';
    if (input?.type === 'tel') return 'phone';
    if (input?.type === 'file') return 'resume';

    // Match against FIELD_DEFINITIONS
    for (const [fieldType, def] of Object.entries(FIELD_DEFINITIONS)) {
      for (const keyword of def.keywords) {
        if (combined.includes(keyword)) {
          return fieldType;
        }
      }
    }

    return null; // Unknown field
  }

  /**
   * Get the human-readable label for a form element.
   * Tries multiple strategies: for= attribute, aria-label, placeholder, parent text.
   */
  function getLabel(element) {
    // 1. Explicit label with for= attribute
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) return label.textContent?.trim();
    }

    // 2. aria-label attribute
    if (element.getAttribute('aria-label')) {
      return element.getAttribute('aria-label').trim();
    }

    // 3. aria-labelledby
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.textContent?.trim();
    }

    // 4. Wrapping label element
    const wrapLabel = element.closest('label');
    if (wrapLabel) {
      return wrapLabel.textContent?.replace(element.value || '', '').trim();
    }

    // 5. Preceding sibling or parent label text
    const formGroup = element.closest('[class*="form"], [class*="field"], [class*="input"], [class*="group"], div, li');
    if (formGroup) {
      const labelEl = formGroup.querySelector('label, [class*="label"], [class*="title"]');
      if (labelEl && !labelEl.contains(element)) {
        return labelEl.textContent?.trim();
      }
    }

    // 6. Placeholder as last resort
    if (element.placeholder) return element.placeholder.trim();

    // 7. name attribute
    if (element.name) return element.name.replace(/[_-]/g, ' ').trim();

    return '';
  }

  /**
   * Check if an element is visible in the DOM.
   */
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Find a button by its visible text in a container.
   */
  function findButton(textOrKeywords, container = document) {
    const keywords = Array.isArray(textOrKeywords) ? textOrKeywords : [textOrKeywords];
    const buttons = container.querySelectorAll(
      'button, [role="button"], input[type="submit"], a[class*="btn"], a[class*="button"]'
    );
    for (const btn of buttons) {
      const text = btn.textContent?.toLowerCase().trim() || btn.value?.toLowerCase();
      for (const kw of keywords) {
        if (text?.includes(kw.toLowerCase())) return btn;
      }
    }
    return null;
  }

  /**
   * Wait for an element matching a selector to appear in the DOM.
   * Used after clicking "Apply" when a modal animates in.
   */
  function waitForElement(selector, container = document, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = container.querySelector(selector);
      if (el && isVisible(el)) return resolve(el);

      const observer = new MutationObserver(() => {
        const found = container.querySelector(selector);
        if (found && isVisible(found)) {
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(container, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`waitForElement timeout: ${selector}`));
      }, timeout);
    });
  }

  return {
    detectFields,
    findField,
    detectFormGroups,
    identifyFieldType,
    getLabel,
    isVisible,
    findButton,
    waitForElement,
    FIELD_DEFINITIONS,
  };
})();
