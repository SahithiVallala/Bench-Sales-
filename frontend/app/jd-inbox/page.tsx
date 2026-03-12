'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface JDEmail {
  id: string
  email_id: string
  subject: string | null
  sender: string | null
  received_at: string | null
  ai_title: string | null
  ai_company: string | null
  ai_skills: string[]
  created_at: string
}

interface JDDetail extends JDEmail {
  body_text: string | null
  jd_text: string | null
  attachment_name: string | null
}

interface CandidateMatch {
  resume_id: string
  candidate_name: string
  primary_role: string | null
  match_score: number
  matched_skills: string[]
  missing_skills: string[]
  summary: string
}

interface MatchResult {
  jd_id: string
  jd_title: string | null
  jd_company: string | null
  total_candidates: number
  matches: CandidateMatch[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SCORE_COLOR = (s: number) =>
  s >= 80 ? 'text-emerald-400' : s >= 65 ? 'text-yellow-400' : s >= 50 ? 'text-orange-400' : 'text-red-400'

const SCORE_BG = (s: number) =>
  s >= 80 ? 'bg-emerald-900/30 border-emerald-800/50' :
  s >= 65 ? 'bg-yellow-900/20 border-yellow-800/40' :
  s >= 50 ? 'bg-orange-900/20 border-orange-800/40' :
            'bg-red-900/20 border-red-800/40'

function formatDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch {
    return iso
  }
}

// ── Main Page Component ───────────────────────────────────────────────────────

function JDInboxInner() {
  const searchParams = useSearchParams()

  // Connection state
  const [connected, setConnected]   = useState<boolean | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing]       = useState(false)
  const [syncMsg, setSyncMsg]       = useState<string | null>(null)
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null)

  // JD list state
  const [jds, setJds]               = useState<JDEmail[]>([])
  const [loadingJds, setLoadingJds] = useState(false)
  const [selectedJd, setSelectedJd] = useState<JDDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Matching state
  const [matching, setMatching]     = useState(false)
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const [matchError, setMatchError] = useState<string | null>(null)

  // ── On mount: check status + handle OAuth return ─────────────────────────

  useEffect(() => {
    // Check if we just returned from OAuth
    const connectedParam = searchParams.get('connected')
    const errorParam     = searchParams.get('error')

    if (connectedParam === 'true') {
      showToast('Outlook connected successfully!', true)
      // Clean URL
      window.history.replaceState({}, '', '/jd-inbox')
    }
    if (errorParam) {
      showToast(`OAuth error: ${errorParam}`, false)
      window.history.replaceState({}, '', '/jd-inbox')
    }

    checkStatus()
  }, [])

  // Load JDs when connected
  useEffect(() => {
    if (connected === true) {
      loadJds()
    }
  }, [connected])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const checkStatus = async () => {
    try {
      const data = await apiFetch('/api/email/status')
      setConnected(data.connected)
    } catch {
      setConnected(false)
    }
  }

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const data = await apiFetch('/api/email/auth-url')
      window.location.href = data.url
    } catch (err: any) {
      showToast(err.message || 'Failed to get auth URL', false)
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      await apiFetch('/api/email/disconnect', { method: 'POST' })
      setConnected(false)
      setJds([])
      setSelectedJd(null)
      setMatchResult(null)
      showToast('Outlook disconnected.', true)
    } catch (err: any) {
      showToast(err.message || 'Disconnect failed', false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const data = await apiFetch('/api/email/sync', { method: 'POST' })
      setSyncMsg(`Synced ${data.synced} of ${data.total} emails.`)
      await loadJds()
    } catch (err: any) {
      showToast(err.message || 'Sync failed', false)
    } finally {
      setSyncing(false)
    }
  }

  const loadJds = async () => {
    setLoadingJds(true)
    try {
      const data = await apiFetch('/api/email/jds')
      setJds(data)
    } catch (err: any) {
      showToast(err.message || 'Failed to load JDs', false)
    } finally {
      setLoadingJds(false)
    }
  }

  const selectJd = async (jd: JDEmail) => {
    setMatchResult(null)
    setMatchError(null)
    if (selectedJd?.id === jd.id) return // already selected

    setLoadingDetail(true)
    try {
      const detail = await apiFetch(`/api/email/jds/${jd.id}`)
      setSelectedJd(detail)
    } catch (err: any) {
      showToast(err.message || 'Failed to load JD detail', false)
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleMatch = async () => {
    if (!selectedJd) return
    setMatching(true)
    setMatchResult(null)
    setMatchError(null)
    try {
      const data = await apiFetch(`/api/email/jds/${selectedJd.id}/match`, { method: 'POST' })
      setMatchResult(data)
    } catch (err: any) {
      setMatchError(err.message || 'Matching failed')
    } finally {
      setMatching(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">JD Inbox</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Pull job descriptions from Outlook emails and match them against bench candidates.
          </p>
        </div>

        {/* Connection controls */}
        <div className="flex items-center gap-3">
          {connected === null && (
            <span className="text-xs text-gray-500 animate-pulse">Checking connection...</span>
          )}
          {connected === false && (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {connecting ? (
                <span className="animate-spin">⟳</span>
              ) : (
                <span>📧</span>
              )}
              {connecting ? 'Redirecting...' : 'Connect Outlook'}
            </button>
          )}
          {connected === true && (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/30 text-emerald-400 text-xs font-medium rounded-full border border-emerald-800/50">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                Connected
              </span>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <span className={syncing ? 'animate-spin' : ''}>⟳</span>
                {syncing ? 'Syncing...' : 'Sync Emails'}
              </button>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-2 px-3 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 text-sm font-medium rounded-lg border border-red-800/40 transition-colors"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sync status */}
      {syncMsg && (
        <div className="px-4 py-2 bg-emerald-950/50 border border-emerald-800/60 rounded-lg text-sm text-emerald-400">
          ✓ {syncMsg}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`px-4 py-2.5 rounded-lg text-sm border ${
          toast.ok
            ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-400'
            : 'bg-red-950/50 border-red-800/60 text-red-400'
        }`}>
          {toast.ok ? '✓' : '⚠'} {toast.msg}
        </div>
      )}

      {/* Not connected state */}
      {connected === false && (
        <div className="card py-16 text-center">
          <div className="text-5xl mb-4">📧</div>
          <h2 className="text-lg font-semibold text-white mb-2">Connect Your Outlook Account</h2>
          <p className="text-gray-400 text-sm max-w-md mx-auto mb-6">
            Link your Microsoft Outlook account to automatically pull job descriptions from your inbox.
            The platform will extract job details and let you match them against your bench candidates.
          </p>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors"
          >
            {connecting ? 'Redirecting to Microsoft...' : 'Connect Outlook'}
          </button>
          <p className="text-xs text-gray-600 mt-4">
            Requires MS_CLIENT_ID and MS_CLIENT_SECRET to be configured in the backend .env file.
          </p>
        </div>
      )}

      {/* Split panel (shown when connected) */}
      {connected === true && (
        <div className="grid grid-cols-3 gap-4" style={{ minHeight: '70vh' }}>

          {/* ── Left panel: JD list ─────────────────────────────────────────── */}
          <div className="col-span-1 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {loadingJds ? 'Loading...' : `${jds.length} Job Descriptions`}
              </span>
            </div>

            {/* Loading skeletons */}
            {loadingJds && (
              <div className="space-y-2">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="card animate-pulse">
                    <div className="h-3 bg-gray-700 rounded w-3/4 mb-2" />
                    <div className="h-2.5 bg-gray-700 rounded w-1/2 mb-2" />
                    <div className="h-2 bg-gray-700 rounded w-full" />
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {!loadingJds && jds.length === 0 && (
              <div className="card text-center py-10">
                <div className="text-3xl mb-3">📭</div>
                <p className="text-gray-400 text-sm">No JDs synced yet.</p>
                <p className="text-gray-500 text-xs mt-1">Click "Sync Emails" to fetch job descriptions from your inbox.</p>
              </div>
            )}

            {/* JD cards */}
            {!loadingJds && jds.map(jd => {
              const isSelected = selectedJd?.id === jd.id
              return (
                <div
                  key={jd.id}
                  onClick={() => selectJd(jd)}
                  className={`card cursor-pointer hover:border-gray-600 transition-all ${
                    isSelected ? 'border-blue-600/70 bg-blue-950/20' : ''
                  }`}
                >
                  {/* AI title or subject */}
                  <p className="text-sm font-semibold text-white leading-snug truncate">
                    {jd.ai_title || jd.subject || 'Untitled JD'}
                  </p>
                  {/* Company */}
                  {jd.ai_company && (
                    <p className="text-xs text-blue-400 mt-0.5 truncate">{jd.ai_company}</p>
                  )}
                  {/* Sender + date */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs text-gray-500 truncate flex-1">{jd.sender || 'Unknown sender'}</span>
                    {jd.received_at && (
                      <span className="text-xs text-gray-600 shrink-0">{formatDate(jd.received_at)}</span>
                    )}
                  </div>
                  {/* Skills pills */}
                  {jd.ai_skills?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {jd.ai_skills.slice(0, 5).map(s => (
                        <span key={s} className="text-xs px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded border border-gray-700">
                          {s}
                        </span>
                      ))}
                      {jd.ai_skills.length > 5 && (
                        <span className="text-xs text-gray-500">+{jd.ai_skills.length - 5} more</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Right panel: JD detail + matching ──────────────────────────── */}
          <div className="col-span-2">

            {/* Empty state */}
            {!selectedJd && !loadingDetail && (
              <div className="card flex flex-col items-center justify-center py-24 h-full">
                <div className="text-5xl mb-4">✉️</div>
                <p className="text-gray-400 text-sm">Select a job description from the left to view details.</p>
              </div>
            )}

            {/* Loading detail */}
            {loadingDetail && (
              <div className="card animate-pulse space-y-4 p-6">
                <div className="h-6 bg-gray-700 rounded w-1/2" />
                <div className="h-4 bg-gray-700 rounded w-1/3" />
                <div className="h-3 bg-gray-700 rounded w-full" />
                <div className="h-3 bg-gray-700 rounded w-5/6" />
                <div className="h-3 bg-gray-700 rounded w-4/6" />
              </div>
            )}

            {/* JD detail */}
            {selectedJd && !loadingDetail && (
              <div className="space-y-4">

                {/* Header card */}
                <div className="card space-y-3">
                  <div>
                    <h2 className="text-xl font-bold text-white leading-tight">
                      {selectedJd.ai_title || selectedJd.subject || 'Untitled Job Description'}
                    </h2>
                    {selectedJd.ai_company && (
                      <p className="text-blue-400 font-medium mt-0.5">{selectedJd.ai_company}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                    {selectedJd.subject && selectedJd.subject !== selectedJd.ai_title && (
                      <span>Subject: <span className="text-gray-300">{selectedJd.subject}</span></span>
                    )}
                    {selectedJd.sender && (
                      <span>From: <span className="text-gray-300">{selectedJd.sender}</span></span>
                    )}
                    {selectedJd.received_at && (
                      <span>Received: <span className="text-gray-300">{formatDate(selectedJd.received_at)}</span></span>
                    )}
                    {selectedJd.attachment_name && (
                      <span>Attachment: <span className="text-gray-300">{selectedJd.attachment_name}</span></span>
                    )}
                  </div>

                  {/* Skills */}
                  {selectedJd.ai_skills?.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">Required Skills</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedJd.ai_skills.map(s => (
                          <span key={s} className="text-xs px-2 py-0.5 bg-blue-900/30 text-blue-300 rounded-full border border-blue-800/40">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* JD text */}
                <div className="card">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Job Description</h3>
                  <div className="bg-gray-900 rounded-lg p-4 max-h-64 overflow-y-auto">
                    <pre className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed font-sans">
                      {selectedJd.jd_text || selectedJd.body_text || 'No content extracted.'}
                    </pre>
                  </div>
                </div>

                {/* Match button */}
                <button
                  onClick={handleMatch}
                  disabled={matching}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {matching ? (
                    <>
                      <span className="animate-spin">⟳</span>
                      Finding Matching Candidates...
                    </>
                  ) : (
                    <>
                      <span>🎯</span>
                      Find Matching Candidates
                    </>
                  )}
                </button>

                {/* Match error */}
                {matchError && (
                  <div className="px-4 py-3 bg-red-950/50 border border-red-800 rounded-lg text-sm text-red-400">
                    ⚠ {matchError}
                  </div>
                )}

                {/* Match results */}
                {matchResult && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-semibold text-white">
                        Candidate Matches
                      </h3>
                      <span className="text-xs text-gray-500">
                        {matchResult.matches.length} of {matchResult.total_candidates} candidates scored
                      </span>
                    </div>

                    {matchResult.matches.length === 0 && (
                      <div className="card text-center py-8">
                        <p className="text-gray-400 text-sm">No candidates found in the system.</p>
                        <a href="/resumes/new" className="text-blue-400 hover:text-blue-300 text-xs mt-1 inline-block">
                          Upload a resume to get started →
                        </a>
                      </div>
                    )}

                    {matchResult.matches.map((m, i) => (
                      <div
                        key={m.resume_id}
                        className={`card border ${SCORE_BG(m.match_score)}`}
                      >
                        <div className="flex items-start gap-4">
                          {/* Rank + score */}
                          <div className="shrink-0 text-center">
                            <div className="text-xs text-gray-600 mb-0.5">#{i + 1}</div>
                            <div className={`text-2xl font-bold ${SCORE_COLOR(m.match_score)}`}>
                              {m.match_score}
                            </div>
                            <div className="text-xs text-gray-500">match%</div>
                          </div>

                          {/* Candidate info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <a
                                href={`/resumes/${m.resume_id}`}
                                className="text-base font-semibold text-white hover:text-blue-300 transition-colors"
                              >
                                {m.candidate_name}
                              </a>
                              {m.primary_role && (
                                <span className="text-xs text-gray-500">{m.primary_role}</span>
                              )}
                            </div>

                            {/* AI summary */}
                            <p className="text-xs text-gray-400 mt-1 leading-relaxed">{m.summary}</p>

                            {/* Skills grid */}
                            <div className="grid grid-cols-2 gap-3 mt-2.5">
                              {m.matched_skills?.length > 0 && (
                                <div>
                                  <p className="text-xs text-emerald-400 font-medium mb-1">✓ Matched</p>
                                  <div className="flex flex-wrap gap-1">
                                    {m.matched_skills.slice(0, 8).map(s => (
                                      <span key={s} className="text-xs px-1.5 py-0.5 bg-emerald-900/30 text-emerald-400 rounded border border-emerald-800/40">
                                        {s}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {m.missing_skills?.length > 0 && (
                                <div>
                                  <p className="text-xs text-red-400 font-medium mb-1">✗ Missing</p>
                                  <div className="flex flex-wrap gap-1">
                                    {m.missing_skills.slice(0, 6).map(s => (
                                      <span key={s} className="text-xs px-1.5 py-0.5 bg-red-900/30 text-red-400 rounded border border-red-800/40">
                                        {s}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Action links */}
                            <div className="flex gap-3 mt-3 pt-2.5 border-t border-gray-800/60">
                              <a
                                href={`/resumes/${m.resume_id}`}
                                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                              >
                                View Profile →
                              </a>
                              <a
                                href={`/search?resume_id=${m.resume_id}`}
                                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                              >
                                Search Jobs →
                              </a>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Export with Suspense (required for useSearchParams) ───────────────────────

export default function JDInboxPage() {
  return (
    <Suspense fallback={<div className="text-gray-400 p-6">Loading JD Inbox...</div>}>
      <JDInboxInner />
    </Suspense>
  )
}
