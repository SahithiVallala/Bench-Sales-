'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '@/lib/api'

interface Resume { id: string; candidate_name: string; primary_role: string | null }
interface JobResult {
  id: string | null
  title: string
  company: string | null
  platform: string
  job_url: string
  location: string | null
  work_mode: string | null
  job_type: string | null
  salary_range: string | null
  posted_date: string | null
  description: string | null
  skills_required: string[]
  match_score: number | null
  match_reasons: { matched_skills: string[]; missing_skills: string[]; summary: string } | null
}

const STORAGE_RESULTS  = 'jobSearch_results'
const STORAGE_FORM     = 'jobSearch_form'
const STORAGE_APPLIED  = 'jobSearch_applied'

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

  const [resumes, setResumes] = useState<Resume[]>([])
  const [results, setResults] = useState<JobResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedJob, setExpandedJob] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [appliedUrls, setAppliedUrls] = useState<Set<string>>(new Set())
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [minScore, setMinScore] = useState(0)

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

  // On mount: restore results + form from sessionStorage
  useEffect(() => {
    apiFetch('/api/resumes?limit=100').then(setResumes).catch(console.error)

    try {
      const savedResults = sessionStorage.getItem(STORAGE_RESULTS)
      const savedForm    = sessionStorage.getItem(STORAGE_FORM)

      if (savedResults) {
        setResults(JSON.parse(savedResults))
        setSearched(true)
      }
      const savedApplied = sessionStorage.getItem(STORAGE_APPLIED)
      if (savedApplied) {
        setAppliedUrls(new Set(JSON.parse(savedApplied)))
      }
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
    } catch {
      // ignore stale/corrupt sessionStorage
    }
  }, [])

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
    if (!resumeId)           { setError('Please select a candidate first.'); return }
    if (jobTitles.length === 0) { setError('Please add at least one job title.'); return }
    if (platforms.length === 0) { setError('Please select at least one platform.'); return }

    setSearching(true)
    setError(null)
    setResults([])
    setAppliedUrls(new Set())
    setSuccessMsg(null)
    clearSession()

    try {
      const body = {
        resume_id: resumeId,
        job_titles: jobTitles,
        platforms,
        locations: location ? [location] : null,
        job_type: jobType,
        work_mode: workMode,
        experience_level: expLevel,
        date_posted: datePosted,
        num_results: numResults,
      }
      const data = await apiFetch('/api/jobs/search', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const jobs = data.jobs || []
      setResults(jobs)
      setSearched(true)
      saveToSession(jobs)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSearching(false)
    }
  }

  // Refresh = clear cache and re-run with same params
  const handleRefresh = async () => {
    if (!resumeId || jobTitles.length === 0 || platforms.length === 0) return
    clearSession()
    setResults([])
    setAppliedUrls(new Set())
    setSuccessMsg(null)
    setSearching(true)
    setError(null)

    try {
      const body = {
        resume_id: resumeId,
        job_titles: jobTitles,
        platforms,
        locations: location ? [location] : null,
        job_type: jobType,
        work_mode: workMode,
        experience_level: expLevel,
        date_posted: datePosted,
        num_results: numResults,
      }
      const data = await apiFetch('/api/jobs/search', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const jobs = data.jobs || []
      setResults(jobs)
      setSearched(true)
      saveToSession(jobs)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSearching(false)
    }
  }

  const handleSubmit = async (job: JobResult) => {
    if (!resumeId) return
    setSubmitting(job.job_url)
    setSuccessMsg(null)

    try {
      await apiFetch('/api/submissions', {
        method: 'POST',
        body: JSON.stringify({
          resume_id: resumeId,
          job_id: job.id,
          job_title: job.title,
          company_name: job.company,
          platform: job.platform,
          job_url: job.job_url,
        }),
      })
      // Mark as applied, persist to sessionStorage, open job in new tab
      setAppliedUrls(prev => {
        const next = new Set(prev).add(job.job_url)
        sessionStorage.setItem(STORAGE_APPLIED, JSON.stringify([...next]))
        return next
      })
      setSuccessMsg(`Tracked! "${job.title}" added to your submissions.`)
      window.open(job.job_url, '_blank')
    } catch (err: any) {
      alert('Failed to log submission: ' + err.message)
    } finally {
      setSubmitting(null)
    }
  }

  const filtered = results.filter(j => (j.match_score ?? 0) >= minScore)

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
            <select value={resumeId} onChange={e => setResumeId(e.target.value)} className="input">
              <option value="">Select candidate...</option>
              {resumes.map(r => (
                <option key={r.id} value={r.id}>{r.candidate_name}{r.primary_role ? ` — ${r.primary_role}` : ''}</option>
              ))}
            </select>
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
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
                +
              </button>
            </div>
            {jobTitles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {jobTitles.map(t => (
                  <span key={t} className="flex items-center gap-1 px-2.5 py-1 bg-blue-900/40 text-blue-300 text-xs rounded-full border border-blue-800/50">
                    {t}
                    <button type="button" onClick={() => setJobTitles(prev => prev.filter(x => x !== t))}
                      className="hover:text-white">×</button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500">Press Enter or + to add. Can add multiple titles.</p>
          </div>

          {/* Platforms */}
          <div className="card space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Platforms</h2>
            <div className="grid grid-cols-2 gap-1.5">
              {PLATFORMS.map(p => (
                <label key={p.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors text-sm ${
                  platforms.includes(p.id) ? 'bg-blue-900/40 text-blue-300 border border-blue-800/50' : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600'
                }`}>
                  <input type="checkbox" checked={platforms.includes(p.id)}
                    onChange={() => togglePlatform(p.id)} className="hidden" />
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
                placeholder="e.g. USA, Remote, New York"
                className="input" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Job Type</label>
                <select value={jobType} onChange={e => setJobType(e.target.value)} className="input">
                  <option value="any">Any</option>
                  <option value="full_time">Full-time</option>
                  <option value="part_time">Part-time</option>
                  <option value="contract">Contract</option>
                  <option value="internship">Internship</option>
                </select>
              </div>
              <div>
                <label className="label">Work Mode</label>
                <select value={workMode} onChange={e => setWorkMode(e.target.value)} className="input">
                  <option value="any">Any</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">On-site</option>
                </select>
              </div>
              <div>
                <label className="label">Experience</label>
                <select value={expLevel} onChange={e => setExpLevel(e.target.value)} className="input">
                  <option value="any">Any</option>
                  <option value="entry">Entry (0-2y)</option>
                  <option value="mid">Mid (2-5y)</option>
                  <option value="senior">Senior (5y+)</option>
                </select>
              </div>
              <div>
                <label className="label">Date Posted</label>
                <select value={datePosted} onChange={e => setDatePosted(e.target.value)} className="input">
                  <option value="today">Today</option>
                  <option value="3days">Last 3 days</option>
                  <option value="week">Last week</option>
                  <option value="month">Last month</option>
                  <option value="any">Any time</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label">Results to fetch: {numResults}</label>
              <input type="range" min={5} max={50} step={5} value={numResults}
                onChange={e => setNumResults(Number(e.target.value))}
                className="w-full accent-blue-500" />
              <div className="flex justify-between text-xs text-gray-500 mt-0.5"><span>5</span><span>50</span></div>
            </div>
          </div>

          {error && (
            <div className="px-4 py-3 bg-red-950/50 border border-red-800 rounded-lg text-sm text-red-400">⚠ {error}</div>
          )}

          <button type="submit" disabled={searching}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors">
            {searching ? (
              <span className="flex items-center justify-center gap-2"><span className="animate-spin">⟳</span> Searching & Scoring...</span>
            ) : '🔍 Search Jobs'}
          </button>
        </form>

        {/* Results */}
        <div className="col-span-3 space-y-4">

          {/* Results header with score filter + refresh */}
          {searched && results.length > 0 && (
            <div className="card flex items-center gap-4">
              <span className="text-sm text-gray-400 shrink-0">Min match: <span className="text-white font-medium">{minScore}%</span></span>
              <input type="range" min={0} max={100} step={5} value={minScore}
                onChange={e => setMinScore(Number(e.target.value))}
                className="flex-1 accent-blue-500" />
              <span className="text-sm text-gray-400 shrink-0">{filtered.length} of {results.length} jobs</span>
              <button
                onClick={handleRefresh}
                disabled={searching}
                title="Fetch fresh results from all platforms"
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 rounded-lg transition-colors disabled:opacity-50">
                <span className={searching ? 'animate-spin' : ''}>⟳</span> Refresh
              </button>
            </div>
          )}

          {/* Success toast */}
          {successMsg && (
            <div className="flex items-center justify-between px-4 py-3 bg-emerald-950/60 border border-emerald-800 rounded-lg text-sm text-emerald-300">
              <span>✓ {successMsg}</span>
              <div className="flex items-center gap-3 ml-4">
                <a href="/submissions" className="text-emerald-400 hover:text-emerald-200 underline underline-offset-2 text-xs whitespace-nowrap">
                  View Submissions →
                </a>
                <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-300 text-lg leading-none">×</button>
              </div>
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
            const isApplied = appliedUrls.has(job.job_url)
            return (
              <div key={job.job_url} className={`card hover:border-gray-600 transition-colors ${isApplied ? 'border-emerald-900/60' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base">{PLATFORM_ICONS[job.platform] || '💼'}</span>
                      <span className="text-xs text-gray-500 capitalize">{job.platform}</span>
                      {job.posted_date && <span className="text-xs text-gray-600">· {job.posted_date}</span>}
                      {isApplied && (
                        <span className="px-1.5 py-0.5 bg-emerald-900/40 text-emerald-400 text-xs rounded-full border border-emerald-800/50">
                          Applied ✓
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-white text-base leading-tight truncate">{job.title}</h3>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400 mt-1">
                      {job.company && <span>🏢 {job.company}</span>}
                      {job.location && <span>📍 {job.location}</span>}
                      {job.work_mode && job.work_mode !== 'null' && <span>🏠 {job.work_mode}</span>}
                      {job.job_type && job.job_type !== 'null' && <span>⏰ {job.job_type.replace('_', '-')}</span>}
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

                {/* Match details (expandable) */}
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
                        {job.description && (
                          <div className="col-span-2 mt-2">
                            <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">{job.description}</p>
                          </div>
                        )}
                      </div>
                    )}
                    <button onClick={() => setExpandedJob(expandedJob === job.job_url ? null : job.job_url)}
                      className="text-xs text-blue-400 hover:text-blue-300 mt-1.5 transition-colors">
                      {expandedJob === job.job_url ? 'Show less ↑' : 'Show more ↓'}
                    </button>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 mt-3 pt-3 border-t border-gray-800">
                  <a href={job.job_url} target="_blank" rel="noreferrer"
                    className="flex-1 text-center py-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 rounded-lg transition-colors">
                    View Job ↗
                  </a>
                  <button onClick={() => handleSubmit(job)}
                    disabled={submitting === job.job_url || isApplied}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                      isApplied
                        ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800/50 cursor-default'
                        : 'bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white'
                    }`}>
                    {submitting === job.job_url ? '...' : isApplied ? 'Applied ✓' : 'Apply & Track →'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
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
