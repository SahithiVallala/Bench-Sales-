'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '@/lib/api'

interface Resume {
  id: string; candidate_name: string; primary_role: string | null
  email: string | null; phone: string | null
  visa_status: string | null; work_auth: string | null
  current_location: string | null; city: string | null; state: string | null; zip_code: string | null
  relocation: boolean | null; work_mode_pref: string | null
  primary_skills: string[]; secondary_skills: string[]; experience_years: number | null
  linkedin_url: string | null; portfolio_url: string | null
  current_company: string | null; notice_period: string | null
  cover_letter_template: string | null; ai_summary: string | null; rate_expectation: string | null
  education: string | null; certifications: string[]
  file_url: string | null; file_name: string | null
}
interface JobResult {
  id: string | null; title: string; company: string | null
  platform: string; job_url: string; location: string | null
  work_mode: string | null; job_type: string | null
  salary_range: string | null; posted_date: string | null
  description: string | null; skills_required: string[]
  match_score: number | null
  match_reasons: { matched_skills: string[]; missing_skills: string[]; summary: string } | null
}

const STORAGE_RESULTS = 'jobSearch_results'
const STORAGE_FORM    = 'jobSearch_form'
const STORAGE_APPLIED = 'jobSearch_applied'
const STORAGE_RESUME  = 'jobSearch_selectedResume'

const PLATFORMS = [
  { id: 'linkedin',     label: 'LinkedIn' },
  { id: 'indeed',       label: 'Indeed' },
  { id: 'naukri',       label: 'Naukri' },
  { id: 'dice',         label: 'Dice' },
  { id: 'glassdoor',    label: 'Glassdoor' },
  { id: 'ziprecruiter', label: 'ZipRecruiter' },
  { id: 'remotive',     label: 'Remotive' },
]

const PLATFORM_ICONS: Record<string, string> = {
  linkedin: '💼', indeed: '🔵', naukri: '🟠', dice: '🎲',
  glassdoor: '🪟', ziprecruiter: '🟡', remotive: '🌍',
}

const SCORE_COLOR = (s: number) =>
  s >= 80 ? 'text-emerald-400' : s >= 65 ? 'text-yellow-400' : s >= 50 ? 'text-orange-400' : 'text-red-400'

function SearchPageInner() {
  const searchParams = useSearchParams()
  const preselectedResumeId = searchParams.get('resume_id') || ''

  const [resumes, setResumes]               = useState<Resume[]>([])
  const [selectedResume, setSelectedResume] = useState<Resume | null>(null)
  const [results, setResults]               = useState<JobResult[]>([])
  const [searching, setSearching]           = useState(false)
  const [searched, setSearched]             = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [expandedJob, setExpandedJob]       = useState<string | null>(null)
  const [submitting, setSubmitting]         = useState<string | null>(null)
  const [appliedUrls, setAppliedUrls]       = useState<Set<string>>(new Set())
  const [successMsg, setSuccessMsg]         = useState<string | null>(null)
  const [minScore, setMinScore]             = useState(0)

  // Auto-apply selection
  const [selectedJobs, setSelectedJobs]   = useState<Set<string>>(new Set())
  const [autoApplyMsg, setAutoApplyMsg]   = useState<string | null>(null)
  const [autoApplyOk, setAutoApplyOk]     = useState(false)

  // Extension / LinkedIn harvest
  const [extensionAvailable, setExtensionAvailable]   = useState(false)
  const [harvestingLinkedIn, setHarvestingLinkedIn]   = useState(false)
  const [harvestProgress, setHarvestProgress]         = useState<{ found: number; cycle: number; total_cycles: number } | null>(null)

  // Form state
  const [resumeId, setResumeId]       = useState(preselectedResumeId)
  const [jobTitles, setJobTitles]     = useState<string[]>([])
  const [titleInput, setTitleInput]   = useState('')
  const [platforms, setPlatforms]     = useState<string[]>(['linkedin', 'indeed', 'dice', 'naukri'])
  const [location, setLocation]       = useState('')
  const [jobType, setJobType]         = useState('any')
  const [workMode, setWorkMode]       = useState('any')
  const [expLevel, setExpLevel]       = useState('any')
  const [datePosted, setDatePosted]   = useState('week')
  const [numResults, setNumResults]   = useState(20)

  // When resumes load from API, update selectedResume with fresh data
  useEffect(() => {
    if (resumeId && resumes.length > 0) {
      const found = resumes.find(r => r.id === resumeId)
      if (found) setSelectedResume(found)
    }
  }, [resumes, resumeId])

  // Persist selectedResume to localStorage so it survives reload
  useEffect(() => {
    try {
      if (selectedResume) {
        localStorage.setItem(STORAGE_RESUME, JSON.stringify(selectedResume))
      }
    } catch { /* ignore */ }
  }, [selectedResume])

  useEffect(() => {
    // Restore selected resume immediately from localStorage (before API loads)
    try {
      const savedResume = localStorage.getItem(STORAGE_RESUME)
      if (savedResume && !preselectedResumeId) {
        const r = JSON.parse(savedResume) as Resume
        setSelectedResume(r)
        setResumeId(r.id)
      }
    } catch { /* ignore */ }

    apiFetch('/api/resumes?limit=100').then((data: Resume[]) => {
      setResumes(data)
      if (preselectedResumeId) {
        const found = data.find((r: Resume) => r.id === preselectedResumeId)
        if (found) setSelectedResume(found)
      }
    }).catch(console.error)

    try {
      const savedResults = sessionStorage.getItem(STORAGE_RESULTS)
      const savedForm    = sessionStorage.getItem(STORAGE_FORM)
      const savedApplied = sessionStorage.getItem(STORAGE_APPLIED)
      if (savedResults) { setResults(JSON.parse(savedResults)); setSearched(true) }
      if (savedApplied) setAppliedUrls(new Set(JSON.parse(savedApplied)))
      if (savedForm) {
        const f = JSON.parse(savedForm)
        if (f.resumeId)   setResumeId(f.resumeId)
        if (f.jobTitles)  setJobTitles(f.jobTitles)
        if (f.platforms)  setPlatforms(f.platforms)
        if (f.location)   setLocation(f.location)
        if (f.jobType)    setJobType(f.jobType)
        if (f.workMode)   setWorkMode(f.workMode)
        if (f.expLevel)   setExpLevel(f.expLevel)
        if (f.datePosted) setDatePosted(f.datePosted)
        if (f.numResults) setNumResults(f.numResults)
      }
    } catch { /* ignore stale sessionStorage */ }
  }, [])

  // Clear job selections when results change
  useEffect(() => { setSelectedJobs(new Set()) }, [results])

  // Listen for Chrome extension messages (harvest progress + results)
  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      if (event.source !== window) return
      const { source, type, payload } = event.data || {}
      if (source !== 'BENCH_SALES_EXTENSION') return

      if (type === 'EXTENSION_READY' || type === 'PONG') {
        setExtensionAvailable(true)
      }
      if (type === 'LINKEDIN_HARVEST_PROGRESS') {
        setHarvestProgress(payload)
      }
      if (type === 'LINKEDIN_HARVEST_COMPLETE') {
        const harvestedJobs: JobResult[] = (payload?.jobs || []).map((j: any) => ({
          id: null,
          title: j.title,
          company: j.company || null,
          platform: 'linkedin',
          job_url: j.url,
          location: j.location || null,
          work_mode: null,
          job_type: null,
          salary_range: null,
          posted_date: null,
          description: null,
          skills_required: [],
          match_score: null,
          match_reasons: null,
        }))
        setResults(prev => {
          const existing = new Set(prev.map(j => j.job_url))
          const merged = [...prev, ...harvestedJobs.filter(j => !existing.has(j.job_url))]
          try { sessionStorage.setItem(STORAGE_RESULTS, JSON.stringify(merged)) } catch { /* ignore */ }
          return merged
        })
        setHarvestProgress(null)
        setHarvestingLinkedIn(false)
        setSearched(true)
      }
      if (type === 'EXTENSION_ERROR') {
        setHarvestingLinkedIn(false)
        setHarvestProgress(null)
      }
    }
    window.addEventListener('message', onMsg)

    // Actively ping the extension — pageBridge may have already sent EXTENSION_READY
    // before this listener was registered (timing race on React hydration).
    // Send pings at 200ms, 800ms, and 2000ms to catch slow loads.
    const pingDelays = [200, 800, 2000]
    const timers = pingDelays.map(delay =>
      setTimeout(() => {
        window.postMessage({ source: 'BENCH_SALES_PLATFORM', type: 'PING' }, '*')
      }, delay)
    )

    return () => {
      window.removeEventListener('message', onMsg)
      timers.forEach(clearTimeout)
    }
  }, [])

  const handleResumeChange = (id: string) => {
    setResumeId(id)
    const found = resumes.find(r => r.id === id) || null
    setSelectedResume(found)
    try {
      if (found) localStorage.setItem(STORAGE_RESUME, JSON.stringify(found))
      else localStorage.removeItem(STORAGE_RESUME)
    } catch { /* ignore */ }
  }

  const saveToSession = (jobs: JobResult[]) => {
    sessionStorage.setItem(STORAGE_RESULTS, JSON.stringify(jobs))
    sessionStorage.setItem(STORAGE_FORM, JSON.stringify({
      resumeId, jobTitles, platforms, location,
      jobType, workMode, expLevel, datePosted, numResults,
    }))
  }
  const clearSession = () => {
    sessionStorage.removeItem(STORAGE_RESULTS)
    sessionStorage.removeItem(STORAGE_FORM)
    sessionStorage.removeItem(STORAGE_APPLIED)
  }

  const addTitle = () => {
    const t = titleInput.trim()
    if (t && !jobTitles.includes(t)) setJobTitles(prev => [...prev, t])
    setTitleInput('')
  }
  const togglePlatform = (p: string) =>
    setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resumeId)              { setError('Please select a candidate first.'); return }
    if (jobTitles.length === 0) { setError('Please add at least one job title.'); return }
    if (platforms.length === 0) { setError('Please select at least one platform.'); return }

    setSearching(true); setError(null); setResults([])
    setAppliedUrls(new Set()); setSuccessMsg(null); setAutoApplyMsg(null)
    setHarvestProgress(null)
    clearSession()

    // If LinkedIn is selected and the extension is installed, harvest directly from LinkedIn
    const useHarvestForLinkedIn = platforms.includes('linkedin') && extensionAvailable
    const apiPlatforms = useHarvestForLinkedIn ? platforms.filter(p => p !== 'linkedin') : platforms

    if (useHarvestForLinkedIn) {
      setHarvestingLinkedIn(true)
      window.postMessage({
        source: 'BENCH_SALES_PLATFORM',
        type: 'START_LINKEDIN_HARVEST',
        payload: {
          keywords: jobTitles.join(' OR '),
          location: location || '',
          easy_apply_only: false,
          recent_only: datePosted !== 'any',
        },
      }, '*')
    }

    // Run API call for non-LinkedIn platforms (skip if only LinkedIn was selected)
    if (apiPlatforms.length > 0) {
      try {
        const body = {
          resume_id: resumeId, job_titles: jobTitles, platforms: apiPlatforms,
          locations: location ? [location] : null,
          job_type: jobType, work_mode: workMode,
          experience_level: expLevel, date_posted: datePosted, num_results: numResults,
        }
        const data = await apiFetch('/api/jobs/search', { method: 'POST', body: JSON.stringify(body) })
        const jobs = data.jobs || []
        setResults(jobs); setSearched(true); saveToSession(jobs)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setSearching(false)
      }
    } else {
      // Only LinkedIn selected — API not needed, just wait for harvest
      setSearching(false)
      setSearched(true)
    }
  }

  const handleRefresh = async () => {
    if (!resumeId || jobTitles.length === 0 || platforms.length === 0) return
    clearSession(); setResults([]); setAppliedUrls(new Set())
    setSuccessMsg(null); setSearching(true); setError(null); setAutoApplyMsg(null)
    setHarvestProgress(null)

    const useHarvestForLinkedIn = platforms.includes('linkedin') && extensionAvailable
    const apiPlatforms = useHarvestForLinkedIn ? platforms.filter(p => p !== 'linkedin') : platforms

    if (useHarvestForLinkedIn) {
      setHarvestingLinkedIn(true)
      window.postMessage({
        source: 'BENCH_SALES_PLATFORM',
        type: 'START_LINKEDIN_HARVEST',
        payload: {
          keywords: jobTitles.join(' OR '),
          location: location || '',
          easy_apply_only: false,
          recent_only: datePosted !== 'any',
        },
      }, '*')
    }

    if (apiPlatforms.length > 0) {
      try {
        const body = {
          resume_id: resumeId, job_titles: jobTitles, platforms: apiPlatforms,
          locations: location ? [location] : null,
          job_type: jobType, work_mode: workMode,
          experience_level: expLevel, date_posted: datePosted, num_results: numResults,
        }
        const data = await apiFetch('/api/jobs/search', { method: 'POST', body: JSON.stringify(body) })
        const jobs = data.jobs || []
        setResults(jobs); setSearched(true); saveToSession(jobs)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setSearching(false)
      }
    } else {
      setSearching(false)
      setSearched(true)
    }
  }

  const handleTrack = async (job: JobResult) => {
    if (!resumeId) return
    setSubmitting(job.job_url); setSuccessMsg(null)
    try {
      await apiFetch('/api/submissions', {
        method: 'POST',
        body: JSON.stringify({
          resume_id: resumeId, job_id: job.id,
          job_title: job.title, company_name: job.company,
          platform: job.platform, job_url: job.job_url,
        }),
      })
      setAppliedUrls(prev => {
        const next = new Set(prev).add(job.job_url)
        sessionStorage.setItem(STORAGE_APPLIED, JSON.stringify([...next]))
        return next
      })
      setSuccessMsg(`Tracked! "${job.title}" added to submissions.`)
      window.open(job.job_url, '_blank')
    } catch (err: any) {
      alert('Failed to log submission: ' + err.message)
    } finally {
      setSubmitting(null)
    }
  }

  // ── Job selection for Auto Apply ──────────────────────────────────────────

  const toggleJobSelect = (url: string) => {
    setSelectedJobs(prev => {
      const next = new Set(prev)
      next.has(url) ? next.delete(url) : next.add(url)
      return next
    })
  }

  const toggleSelectAll = () => {
    const allUrls = filtered.map(j => j.job_url)
    const allSelected = allUrls.every(u => selectedJobs.has(u))
    if (allSelected) {
      setSelectedJobs(new Set())
    } else {
      setSelectedJobs(new Set(allUrls))
    }
  }

  const handleAutoApply = () => {
    if (!selectedResume) {
      setAutoApplyMsg('Please select a candidate first.')
      setAutoApplyOk(false)
      return
    }
    if (selectedJobs.size === 0) {
      setAutoApplyMsg('Select at least one job to apply to.')
      setAutoApplyOk(false)
      return
    }

    const jobList = filtered
      .filter(j => selectedJobs.has(j.job_url))
      .map(j => ({ url: j.job_url, title: j.title, company: j.company || '' }))

    // Send the full candidate object — list endpoint now returns all fields
    const profile = { ...selectedResume }

    // Send to extension via postMessage (bridge content script picks it up)
    window.postMessage({
      source: 'BENCH_SALES_PLATFORM',
      type: 'START_AUTO_APPLY',
      payload: { jobList, candidateProfile: profile },
    }, '*')

    setAutoApplyMsg(`Sent ${jobList.length} jobs to extension! Open the extension popup to monitor progress.`)
    setAutoApplyOk(true)
  }

  const filtered = results.filter(j => (j.match_score ?? 0) >= minScore)
  const allFilteredSelected = filtered.length > 0 && filtered.every(j => selectedJobs.has(j.job_url))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Job Search</h1>
        <p className="text-sm text-gray-400 mt-0.5">Find matching jobs across platforms for a bench candidate.</p>
      </div>

      <div className="grid grid-cols-5 gap-6">
        {/* Search Form */}
        <form onSubmit={handleSearch} className="col-span-2 space-y-4">

          {/* Candidate */}
          <div className="card space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Candidate</h2>
            <select value={resumeId} onChange={e => handleResumeChange(e.target.value)} className="input">
              <option value="">Select candidate...</option>
              {resumes.map(r => (
                <option key={r.id} value={r.id}>{r.candidate_name}{r.primary_role ? ` — ${r.primary_role}` : ''}</option>
              ))}
            </select>
            {selectedResume && (
              <div className="text-xs text-gray-400 space-y-0.5 px-1">
                {selectedResume.primary_skills?.length > 0 && (
                  <p className="text-gray-500 truncate">Skills: <span className="text-gray-300">{selectedResume.primary_skills.slice(0,4).join(', ')}</span></p>
                )}
                {selectedResume.experience_years && (
                  <p className="text-gray-500">Exp: <span className="text-gray-300">{selectedResume.experience_years} yrs</span></p>
                )}
              </div>
            )}
          </div>

          {/* Job Titles */}
          <div className="card space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Job Titles</h2>
            <div className="flex gap-2">
              <input value={titleInput}
                onChange={e => setTitleInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTitle() }}}
                placeholder="e.g. Java Developer"
                className="input flex-1" />
              <button type="button" onClick={addTitle}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">+</button>
            </div>
            {jobTitles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {jobTitles.map(t => (
                  <span key={t} className="flex items-center gap-1 px-2.5 py-1 bg-blue-900/40 text-blue-300 text-xs rounded-full border border-blue-800/50">
                    {t}
                    <button type="button" onClick={() => setJobTitles(prev => prev.filter(x => x !== t))} className="hover:text-white">×</button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500">Press Enter or + to add.</p>
          </div>

          {/* Platforms */}
          <div className="card space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Platforms</h2>
            <div className="grid grid-cols-2 gap-1.5">
              {PLATFORMS.map(p => (
                <label key={p.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors text-sm ${
                  platforms.includes(p.id)
                    ? 'bg-blue-900/40 text-blue-300 border border-blue-800/50'
                    : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600'
                }`}>
                  <input type="checkbox" checked={platforms.includes(p.id)} onChange={() => togglePlatform(p.id)} className="hidden" />
                  <span>{PLATFORM_ICONS[p.id]}</span> {p.label}
                </label>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div className="card space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Filters</h2>
            <div>
              <label className="label">Location</label>
              <input value={location} onChange={e => setLocation(e.target.value)}
                placeholder="e.g. USA, Remote, New York" className="input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Job Type</label>
                <select value={jobType} onChange={e => setJobType(e.target.value)} className="input">
                  <option value="any">Any</option><option value="full_time">Full-time</option>
                  <option value="part_time">Part-time</option><option value="contract">Contract</option>
                  <option value="internship">Internship</option>
                </select>
              </div>
              <div>
                <label className="label">Work Mode</label>
                <select value={workMode} onChange={e => setWorkMode(e.target.value)} className="input">
                  <option value="any">Any</option><option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option><option value="onsite">On-site</option>
                </select>
              </div>
              <div>
                <label className="label">Experience</label>
                <select value={expLevel} onChange={e => setExpLevel(e.target.value)} className="input">
                  <option value="any">Any</option><option value="entry">Entry (0-2y)</option>
                  <option value="mid">Mid (2-5y)</option><option value="senior">Senior (5y+)</option>
                </select>
              </div>
              <div>
                <label className="label">Date Posted</label>
                <select value={datePosted} onChange={e => setDatePosted(e.target.value)} className="input">
                  <option value="today">Today</option><option value="3days">Last 3 days</option>
                  <option value="week">Last week</option><option value="month">Last month</option>
                  <option value="any">Any time</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">Results: {numResults}</label>
              <input type="range" min={5} max={50} step={5} value={numResults}
                onChange={e => setNumResults(Number(e.target.value))} className="w-full accent-blue-500" />
              <div className="flex justify-between text-xs text-gray-500 mt-0.5"><span>5</span><span>50</span></div>
            </div>
          </div>

          {error && (
            <div className="px-4 py-3 bg-red-950/50 border border-red-800 rounded-lg text-sm text-red-400">⚠ {error}</div>
          )}

          <button type="submit" disabled={searching || harvestingLinkedIn}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors">
            {searching || harvestingLinkedIn
              ? <span className="flex items-center justify-center gap-2"><span className="animate-spin">⟳</span>
                  {harvestingLinkedIn ? 'Harvesting LinkedIn…' : 'Searching & Scoring…'}
                </span>
              : platforms.includes('linkedin') && extensionAvailable
                ? '🔍 Search Jobs (LinkedIn via Extension)'
                : '🔍 Search Jobs'}
          </button>
        </form>

        {/* Results */}
        <div className="col-span-3 space-y-4 pb-28">

          {/* Results header */}
          {searched && results.length > 0 && (
            <div className="card flex items-center gap-4">
              <span className="text-sm text-gray-400 shrink-0">Min match: <span className="text-white font-medium">{minScore}%</span></span>
              <input type="range" min={0} max={100} step={5} value={minScore}
                onChange={e => setMinScore(Number(e.target.value))} className="flex-1 accent-blue-500" />
              <span className="text-sm text-gray-400 shrink-0">{filtered.length}/{results.length} jobs</span>
              <button onClick={handleRefresh} disabled={searching}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg transition-colors disabled:opacity-50">
                <span className={searching ? 'animate-spin' : ''}>⟳</span> Refresh
              </button>
            </div>
          )}

          {/* Success toast */}
          {successMsg && (
            <div className="flex items-center justify-between px-4 py-3 bg-emerald-950/60 border border-emerald-800 rounded-lg text-sm text-emerald-300">
              <span>✓ {successMsg}</span>
              <div className="flex items-center gap-3 ml-4">
                <a href="/submissions" className="text-emerald-400 hover:text-emerald-200 underline text-xs">View Submissions →</a>
                <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-300 text-lg">×</button>
              </div>
            </div>
          )}

          {/* LinkedIn harvest progress banner */}
          {harvestingLinkedIn && (
            <div className="flex items-center gap-3 px-4 py-3 bg-blue-950/60 border border-blue-800 rounded-lg text-sm text-blue-300">
              <span className="animate-spin text-base shrink-0">⟳</span>
              <span className="flex-1">
                {harvestProgress
                  ? `Harvesting LinkedIn jobs… found ${harvestProgress.found} so far (scroll ${harvestProgress.cycle}/${harvestProgress.total_cycles})`
                  : 'Opening LinkedIn and starting harvest — please keep the tab open…'}
              </span>
              <span className="text-xs text-blue-500 shrink-0">via Extension</span>
            </div>
          )}

          {/* Extension not installed notice (when LinkedIn selected but no extension) */}
          {!extensionAvailable && platforms.includes('linkedin') && !searched && !searching && (
            <div className="px-4 py-3 bg-yellow-950/40 border border-yellow-800/60 rounded-lg text-xs text-yellow-400">
              💡 <strong>Extension not detected</strong> — LinkedIn jobs will be fetched via API. Install the Bench Sales extension to harvest directly from LinkedIn.
            </div>
          )}

          {/* Loading skeleton */}
          {searching && (
            <div className="space-y-3">
              {[1,2,3,4].map(i => (
                <div key={i} className="card animate-pulse">
                  <div className="h-4 bg-gray-700 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-gray-700 rounded w-1/2 mb-3" />
                  <div className="h-3 bg-gray-700 rounded w-full" />
                </div>
              ))}
              <p className="text-center text-xs text-gray-500 animate-pulse">Searching platforms and scoring with AI...</p>
            </div>
          )}

          {/* No results */}
          {searched && !searching && filtered.length === 0 && (
            <div className="card text-center py-12">
              <div className="text-3xl mb-3">🔍</div>
              <p className="text-gray-400 text-sm">No jobs found. Try different titles, platforms, or lower the match score filter.</p>
            </div>
          )}

          {/* Job cards */}
          {!searching && filtered.map(job => {
            const isApplied   = appliedUrls.has(job.job_url)
            const isSelected  = selectedJobs.has(job.job_url)
            return (
              <div key={job.job_url}
                className={`card hover:border-gray-600 transition-all cursor-pointer ${
                  isSelected  ? 'border-indigo-600/70 bg-indigo-950/20' :
                  isApplied   ? 'border-emerald-900/60' : ''
                }`}
                onClick={e => {
                  // Don't select when clicking interactive elements
                  if ((e.target as HTMLElement).closest('a, button, select')) return
                  toggleJobSelect(job.job_url)
                }}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <div className="pt-0.5 shrink-0">
                    <div
                      onClick={e => { e.stopPropagation(); toggleJobSelect(job.job_url) }}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-600 border-indigo-600'
                          : 'border-gray-600 hover:border-indigo-500'
                      }`}
                    >
                      {isSelected && <span className="text-white text-xs font-bold">✓</span>}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-base">{PLATFORM_ICONS[job.platform] || '💼'}</span>
                          <span className="text-xs text-gray-500 capitalize">{job.platform}</span>
                          {job.posted_date && <span className="text-xs text-gray-600">· {job.posted_date}</span>}
                          {isApplied && (
                            <span className="px-1.5 py-0.5 bg-emerald-900/40 text-emerald-400 text-xs rounded-full border border-emerald-800/50">Tracked ✓</span>
                          )}
                        </div>
                        <h3 className="font-semibold text-white text-base leading-tight truncate">{job.title}</h3>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400 mt-1">
                          {job.company && <span>🏢 {job.company}</span>}
                          {job.location && <span>📍 {job.location}</span>}
                          {job.work_mode && job.work_mode !== 'null' && <span>🏠 {job.work_mode}</span>}
                          {job.job_type && job.job_type !== 'null' && <span>⏰ {job.job_type.replace('_','-')}</span>}
                          {job.salary_range && <span>💰 {job.salary_range}</span>}
                        </div>
                      </div>

                      {/* Match score */}
                      <div className="text-center shrink-0">
                        <div className={`text-2xl font-bold ${SCORE_COLOR(job.match_score ?? 0)}`}>
                          {job.match_score ?? '—'}
                        </div>
                        <div className="text-xs text-gray-500">match%</div>
                      </div>
                    </div>

                    {/* Match details */}
                    {job.match_reasons?.summary && (
                      <div className="mt-3 pt-3 border-t border-gray-800">
                        <p className="text-xs text-gray-400 leading-relaxed">{job.match_reasons.summary}</p>
                        {expandedJob === job.job_url && (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {job.match_reasons.matched_skills?.length > 0 && (
                              <div>
                                <p className="text-xs text-emerald-400 font-medium mb-1">✓ Matched</p>
                                <div className="flex flex-wrap gap-1">
                                  {job.match_reasons.matched_skills.map(s => (
                                    <span key={s} className="text-xs px-1.5 py-0.5 bg-emerald-900/30 text-emerald-400 rounded">{s}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {job.match_reasons.missing_skills?.length > 0 && (
                              <div>
                                <p className="text-xs text-red-400 font-medium mb-1">✗ Missing</p>
                                <div className="flex flex-wrap gap-1">
                                  {job.match_reasons.missing_skills.map(s => (
                                    <span key={s} className="text-xs px-1.5 py-0.5 bg-red-900/30 text-red-400 rounded">{s}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <button onClick={e => { e.stopPropagation(); setExpandedJob(expandedJob === job.job_url ? null : job.job_url) }}
                          className="text-xs text-blue-400 hover:text-blue-300 mt-1.5 transition-colors">
                          {expandedJob === job.job_url ? 'Show less ↑' : 'Show more ↓'}
                        </button>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 mt-3 pt-3 border-t border-gray-800">
                      <a href={job.job_url} target="_blank" rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex-1 text-center py-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 rounded-lg transition-colors">
                        View Job ↗
                      </a>
                      <button onClick={e => { e.stopPropagation(); handleTrack(job) }}
                        disabled={submitting === job.job_url || isApplied}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                          isApplied
                            ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800/50 cursor-default'
                            : 'bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200'
                        }`}>
                        {submitting === job.job_url ? '...' : isApplied ? 'Tracked ✓' : 'Track & Open'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Sticky Auto Apply Bar ─────────────────────────────────────────── */}
      {searched && !searching && filtered.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-800 bg-gray-950/95 backdrop-blur-sm px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center gap-4">

            {/* Select all */}
            <label className="flex items-center gap-2 cursor-pointer shrink-0">
              <div
                onClick={toggleSelectAll}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                  allFilteredSelected ? 'bg-indigo-600 border-indigo-600' : 'border-gray-500 hover:border-indigo-500'
                }`}
              >
                {allFilteredSelected && <span className="text-white text-xs font-bold">✓</span>}
              </div>
              <span className="text-sm text-gray-400 select-none">
                {selectedJobs.size > 0 ? `${selectedJobs.size} selected` : 'Select all'}
              </span>
            </label>

            <div className="flex-1" />

            {/* Status message */}
            {autoApplyMsg && (
              <span className={`text-sm ${autoApplyOk ? 'text-emerald-400' : 'text-red-400'}`}>
                {autoApplyOk ? '✓' : '⚠'} {autoApplyMsg}
              </span>
            )}

            {/* Auto Apply button */}
            <button
              onClick={handleAutoApply}
              disabled={selectedJobs.size === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg transition-colors"
            >
              <span>⚡</span>
              Auto Apply {selectedJobs.size > 0 ? `(${selectedJobs.size})` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="text-gray-400">Loading...</div>}>
      <SearchPageInner />
    </Suspense>
  )
}
