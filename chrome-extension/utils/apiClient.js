/**
 * API Client Utility
 * Handles all communication with the bench sales platform backend.
 */

window.ApiClient = (() => {
  const BASE_URL = 'http://localhost:8000';

  async function post(endpoint, body) {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${endpoint} failed: ${res.status} ${text}`);
    }
    return res.json();
  }

  async function get(endpoint) {
    const res = await fetch(`${BASE_URL}${endpoint}`);
    if (!res.ok) throw new Error(`API ${endpoint} failed: ${res.status}`);
    return res.json();
  }

  /**
   * Ask the backend AI to answer a screening question.
   */
  async function getScreeningAnswer({ question, jobTitle, company, profile, context }) {
    try {
      const data = await post('/api/ai/screening-answer', {
        question,
        job_title: jobTitle,
        company,
        profile,
        context,
      });
      return data.answer || '';
    } catch (err) {
      console.warn('[ApiClient] Screening answer failed:', err.message);
      return null;
    }
  }

  /**
   * Log a completed application to the backend.
   */
  async function logApplication({ jobUrl, jobTitle, company, platform, status, candidateId, note }) {
    try {
      await post('/api/applications/log', {
        job_url: jobUrl,
        job_title: jobTitle,
        company,
        platform,
        status,
        candidate_id: candidateId,
        note,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[ApiClient] Log application failed:', err.message);
    }
  }

  /**
   * Fetch candidate profile from backend.
   */
  async function getCandidateProfile(candidateId) {
    return get(`/api/resumes/${candidateId}`);
  }

  return {
    getScreeningAnswer,
    logApplication,
    getCandidateProfile,
  };
})();
