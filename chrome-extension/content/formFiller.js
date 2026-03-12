/**
 * Form Filler
 * Maps candidate profile data to form fields using semantic detection.
 *
 * Profile field names (as stored in the DB and sent from the search page):
 *   candidate_name, email, phone, primary_role,
 *   primary_skills[], secondary_skills[], experience_years,
 *   visa_status, work_auth, current_location, city, state, zip_code,
 *   relocation (bool), work_mode_pref,
 *   linkedin_url, portfolio_url, current_company, notice_period,
 *   cover_letter_template, ai_summary, rate_expectation,
 *   file_url, file_name, education, certifications[]
 */

window.FormFiller = (() => {
  const { typeIntoField, humanClick, selectOption, setCheckbox, sleep, randomDelay } = window.HumanTyping;
  const { detectFields, detectFormGroups, findButton, isVisible } = window.FieldDetector;

  // ── Public: fill all fields in a container ───────────────────────────────────

  async function fillForm(container, profile, jobContext = {}) {
    const fields = detectFields(container);
    let filled = 0;
    let skipped = 0;

    for (const { element, fieldType, label, inputType } of fields) {
      if (!isVisible(element) || element.disabled || element.readOnly) continue;
      if (inputType === 'file') continue; // handled separately by uploadResume()

      // Safety guard: never fill inputs inside navigation, header, or search bars.
      // This prevents accidentally typing into the LinkedIn/Indeed nav search box
      // when container detection falls back to document.body.
      if (element.closest('nav, header, [role="navigation"], [role="search"]')) {
        console.log(`[FormFiller] Skipping nav/header input: "${label}"`);
        skipped++;
        continue;
      }
      // Also skip by common nav search class patterns
      const classList = (element.className || '') + ' ' + (element.closest('[class]')?.className || '');
      if (/search.*typeahead|global.?nav.?search|nav.?search/i.test(classList)) {
        console.log(`[FormFiller] Skipping nav search input: "${label}"`);
        skipped++;
        continue;
      }

      // Skip fields that already have a value (e.g. LinkedIn pre-fills email/phone)
      const existingValue = element.value || element.textContent?.trim() || '';
      if (existingValue.length > 2 && fieldType) {
        console.log(`[FormFiller] Skipping pre-filled field "${label}": "${existingValue.substring(0, 30)}"`);
        filled++;
        continue;
      }

      const value = resolveValue(fieldType, profile, jobContext);

      if (value === null || value === undefined) {
        const aiAnswer = await askAIForField(label, inputType, jobContext, profile);
        if (aiAnswer) {
          await fillSingleField(element, aiAnswer, inputType, label);
          filled++;
        } else {
          skipped++;
        }
        continue;
      }

      const success = await fillSingleField(element, value, inputType, label);
      success ? filled++ : skipped++;

      await sleep(randomDelay(120, 300));
    }

    return { filled, skipped };
  }

  // ── Public: fill screening questions (AI-assisted) ───────────────────────────

  async function fillScreeningQuestions(container, profile, jobContext) {
    const groups = detectFormGroups(container);
    let answered = 0;

    for (const { question, element, inputType } of groups) {
      if (!isVisible(element) || element.disabled || inputType === 'file') continue;

      const fieldType = window.FieldDetector.identifyFieldType(question, element);
      const profileValue = resolveValue(fieldType, profile, jobContext);

      if (profileValue !== null && profileValue !== undefined) {
        await fillSingleField(element, profileValue, inputType, question);
        answered++;
      } else {
        const aiAnswer = await askAIForField(question, inputType, jobContext, profile);
        if (aiAnswer) {
          await fillSingleField(element, aiAnswer, inputType, question);
          answered++;
        }
      }

      await sleep(randomDelay(150, 400));
    }

    return answered;
  }

  /**
   * Resume upload strategy.
   * Browser security prevents directly setting <input type="file"> via JS.
   * Strategy per platform:
   *   - LinkedIn: user's resume is already saved on their profile; extension selects it.
   *   - Indeed:   "Indeed Resume" is used if user is logged in.
   *   - Others (Greenhouse, Lever, Workday, Dice): we download the resume from Supabase
   *     and use the DataTransfer API trick (works in Chrome extensions with correct permissions).
   */
  async function uploadResume(container, profile) {
    const fileInput = container.querySelector('input[type="file"]');
    if (!fileInput) return false;

    if (!profile.file_url) {
      console.warn('[FormFiller] No file_url in profile — cannot upload resume.');
      return false;
    }

    try {
      // Fetch the resume file from Supabase public URL
      const response = await fetch(profile.file_url);
      if (!response.ok) throw new Error('Could not fetch resume file');

      const blob = await response.blob();
      const fileName = profile.file_name || 'resume.pdf';
      const file = new File([blob], fileName, { type: blob.type });

      // Use DataTransfer to programmatically set the file on the input
      // This works in Chrome extensions running as content scripts
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Fire change event so React/Vue state updates
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input',  { bubbles: true }));

      await sleep(randomDelay(500, 1000));
      console.log('[FormFiller] Resume uploaded:', fileName);
      return true;
    } catch (err) {
      console.warn('[FormFiller] Resume upload failed:', err.message);
      return false;
    }
  }

  // ── Single field filler ───────────────────────────────────────────────────────

  async function fillSingleField(element, value, inputType, label = '') {
    try {
      const tag  = element.tagName.toLowerCase();
      const type = (element.type || '').toLowerCase();

      if (tag === 'select') {
        return await selectOption(element, value);
      }

      if (type === 'checkbox') {
        await setCheckbox(element, isTruthy(value));
        return true;
      }

      if (type === 'radio') {
        const name = element.name;
        const group = name ? document.querySelectorAll(`input[name="${CSS.escape(name)}"]`) : [element];
        for (const radio of group) {
          const radioLabel = window.FieldDetector.getLabel(radio);
          if (
            radioLabel?.toLowerCase().includes(String(value).toLowerCase()) ||
            radio.value?.toLowerCase() === String(value).toLowerCase()
          ) {
            await humanClick(radio);
            return true;
          }
        }
        return false;
      }

      if (type === 'file') return false; // handled by uploadResume()

      // Text, textarea, email, tel, url, number, contenteditable, combobox
      if (
        tag === 'textarea' || tag === 'input' ||
        element.getAttribute('role') === 'combobox' ||
        element.getAttribute('contenteditable') === 'true'
      ) {
        await typeIntoField(element, String(value));
        return true;
      }

      return false;
    } catch (err) {
      console.warn('[FormFiller] fillSingleField error:', err.message, 'label:', label);
      return false;
    }
  }

  // ── Field value resolver ──────────────────────────────────────────────────────

  function resolveValue(fieldType, profile, jobContext) {
    if (!fieldType || !profile) return null;

    // candidate_name is the field name used in the DB
    const fullName = profile.full_name || profile.candidate_name || '';

    const map = {
      first_name:       () => splitName(fullName)[0],
      last_name:        () => splitName(fullName)[1],
      full_name:        () => fullName,
      email:            () => profile.email,
      phone:            () => profile.phone,
      linkedin:         () => normalizeUrl(profile.linkedin_url),
      website:          () => normalizeUrl(profile.portfolio_url),
      location:         () => profile.current_location || [profile.city, profile.state].filter(Boolean).join(', '),
      zip_code:         () => profile.zip_code,
      experience_years: () => profile.experience_years != null ? String(profile.experience_years) : null,
      current_company:  () => profile.current_company,
      current_title:    () => profile.primary_role,

      // Salary/rate — use rate_expectation from DB (AI-extracted or user-entered)
      salary:           () => profile.rate_expectation,
      rate:             () => profile.rate_expectation,

      // Work authorization — derived from visa_status
      work_auth:        () => needsSponsorship(profile.visa_status) ? 'No' : 'Yes',

      // EEO / voluntary self-id — safe defaults
      gender:           () => 'Prefer not to say',
      ethnicity:        () => 'Prefer not to disclose',
      veteran:          () => 'I am not a protected veteran',
      disability:       () => 'I do not have a disability',

      // Availability
      start_date:       () => mapNoticeToDate(profile.notice_period),

      // Education
      education:        () => extractDegreeLevel(profile.education),
      school:           () => extractSchool(profile.education),

      // Skills
      skills:           () => profile.primary_skills?.join(', ') || null,
      summary:          () => profile.ai_summary,

      // How did you hear
      referral:         () => 'Job Board',

      // Preferences
      relocate:         () => profile.relocation ? 'Yes' : 'No',
      remote:           () => (profile.work_mode_pref === 'remote' || profile.work_mode_pref === 'any') ? 'Yes' : 'No',

      // Cover letter — use template with [COMPANY] and [JOB] replaced, or auto-generate
      cover_letter:     () => buildCoverLetter(profile, jobContext),
    };

    const resolver = map[fieldType];
    if (!resolver) return null;
    const val = resolver();
    return (val !== undefined && val !== null && val !== '') ? val : null;
  }

  // ── AI fallback for unknown fields ───────────────────────────────────────────

  async function askAIForField(question, inputType, jobContext, profile) {
    if (!question || question.length < 4) return null;
    if (['file', 'submit', 'button', 'image', 'reset'].includes(inputType)) return null;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FORM_NEEDS_AI',
        payload: {
          question,
          context: `Form field on ${jobContext.platform || window.location.hostname}`,
          jobTitle: jobContext.title,
          company: jobContext.company,
        },
      });
      return response?.answer || null;
    } catch (_) {
      return null;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function splitName(fullName) {
    if (!fullName) return ['', ''];
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return [parts[0], ''];
    return [parts[0], parts.slice(1).join(' ')];
  }

  function normalizeUrl(url) {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    return 'https://' + url;
  }

  /**
   * Determines if the candidate needs employer sponsorship.
   * H1B / CPT / OPT → yes (employer must sponsor or transfer)
   * GC / USC / EAD / TN → no
   */
  function needsSponsorship(visaStatus) {
    if (!visaStatus) return false;
    const v = visaStatus.toLowerCase();
    // These statuses do NOT need sponsorship for most jobs
    const noSponsor = ['gc', 'green card', 'usc', 'citizen', 'ead', 'tn'];
    return !noSponsor.some(s => v.includes(s));
  }

  function mapNoticeToDate(noticePeriod) {
    if (!noticePeriod) return 'Immediately';
    const lower = noticePeriod.toLowerCase();
    if (lower.includes('immediate')) return 'Immediately';
    if (lower.includes('1 week'))   return '1 week';
    if (lower.includes('2 week'))   return '2 weeks';
    if (lower.includes('1 month'))  return '1 month';
    return noticePeriod;
  }

  function extractDegreeLevel(educationString) {
    if (!educationString) return null;
    const e = educationString.toLowerCase();
    if (e.includes('phd') || e.includes('doctorate'))   return "PhD / Doctorate";
    if (e.includes('master') || e.includes(' ms ') || e.includes(' m.s'))  return "Master's Degree";
    if (e.includes('bachelor') || e.includes(' bs ') || e.includes(' b.s') || e.includes(' b.e')) return "Bachelor's Degree";
    if (e.includes('associate'))  return "Associate's Degree";
    if (e.includes('diploma'))    return "Diploma";
    if (e.includes('high school') || e.includes('12th')) return "High School";
    return educationString; // fall back to raw string
  }

  function extractSchool(educationString) {
    if (!educationString) return null;
    // "B.S. Computer Science, University of Texas" → "University of Texas"
    const parts = educationString.split(',');
    if (parts.length > 1) return parts[parts.length - 1].trim();
    return educationString;
  }

  function buildCoverLetter(profile, jobContext) {
    const template = profile.cover_letter_template;
    const job     = jobContext.title   || 'this position';
    const company = jobContext.company || 'your company';

    if (template) {
      // Replace placeholders the user set when adding the candidate
      return template
        .replace(/\[COMPANY\]/gi, company)
        .replace(/\[JOB\]/gi, job)
        .replace(/\[ROLE\]/gi, job);
    }

    // Auto-generate if no template
    const name   = profile.full_name || profile.candidate_name || 'I';
    const role   = profile.primary_role || 'Software Professional';
    const years  = profile.experience_years || 'several';
    const skills = (profile.primary_skills || []).slice(0, 3).join(', ') || 'various technologies';

    return `Dear Hiring Manager,

I am excited to apply for the ${job} role at ${company}. With ${years} years of experience as a ${role} and expertise in ${skills}, I am confident in my ability to make an immediate contribution to your team.

${profile.ai_summary || ''}

Thank you for your consideration. I look forward to the opportunity to discuss how my background aligns with your needs.

Best regards,
${name}`.trim();
  }

  function isTruthy(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return ['yes', 'true', '1', 'on', 'agree'].includes(value.toLowerCase());
    return Boolean(value);
  }

  return {
    fillForm,
    fillSingleField,
    fillScreeningQuestions,
    uploadResume,
    resolveValue,
  };
})();
