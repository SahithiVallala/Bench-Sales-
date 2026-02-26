'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

interface Resume {
  id: string
  candidate_name: string
  email: string | null
  phone: string | null
  primary_role: string | null
  primary_skills: string[]
  secondary_skills: string[]
  experience_years: number | null
  education: string | null
  certifications: string[]
  visa_status: string | null
  work_auth: string | null
  current_location: string | null
  relocation: boolean
  work_mode_pref: string | null
  rate_expectation: string | null
  ai_summary: string | null
  file_url: string | null
  file_name: string | null
  created_at: string
}

interface Submission {
  id: string
  job_title: string
  company_name: string | null
  platform: string | null
  status: string
  created_at: string
  match_score?: number
}

const STATUS_COLORS: Record<string, string> = {
  shortlisted:      'bg-blue-900/50 text-blue-300 border border-blue-800',
  resume_ready:     'bg-purple-900/50 text-purple-300 border border-purple-800',
  submitted:        'bg-yellow-900/50 text-yellow-300 border border-yellow-800',
  vendor_submitted: 'bg-orange-900/50 text-orange-300 border border-orange-800',
  client_submitted: 'bg-amber-900/50 text-amber-300 border border-amber-800',
  interview:        'bg-cyan-900/50 text-cyan-300 border border-cyan-800',
  offer:            'bg-green-900/50 text-green-300 border border-green-800',
  placed:           'bg-emerald-900/50 text-emerald-300 border border-emerald-800',
  rejected:         'bg-red-900/50 text-red-300 border border-red-800',
  on_hold:          'bg-gray-700/50 text-gray-300 border border-gray-600',
}

export default function ResumeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [resume, setResume] = useState<Resume | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    Promise.all([
      apiFetch(`/api/resumes/${id}`),
      apiFetch(`/api/submissions?resume_id=${id}&limit=20`),
    ]).then(([r, s]) => {
      setResume(r)
      setSubmissions(s)
    }).catch(console.error).finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 bg-gray-800 rounded w-1/3" />
      <div className="h-32 bg-gray-800 rounded" />
    </div>
  )

  if (!resume) return (
    <div className="card text-center py-16">
      <p className="text-gray-400">Candidate not found.</p>
      <Link href="/resumes" className="text-blue-400 text-sm mt-2 inline-block">← Back to Candidates</Link>
    </div>
  )

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button onClick={() => router.back()} className="text-xs text-gray-500 hover:text-gray-300 mb-2 flex items-center gap-1 transition-colors">
            ← Back to Candidates
          </button>
          <h1 className="text-2xl font-bold text-white">{resume.candidate_name}</h1>
          {resume.primary_role && <p className="text-blue-400 mt-0.5">{resume.primary_role}</p>}
        </div>
        <div className="flex gap-2">
          {resume.file_url && (
            <a href={resume.file_url} target="_blank" rel="noreferrer"
              className="px-3 py-2 text-sm text-gray-300 border border-gray-700 hover:border-gray-500 rounded-lg transition-colors">
              📄 Resume
            </a>
          )}
          <Link href={`/search?resume_id=${resume.id}&name=${encodeURIComponent(resume.candidate_name)}`}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
            🔍 Find Jobs
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Left col — main info */}
        <div className="col-span-2 space-y-5">

          {/* AI Summary */}
          {resume.ai_summary && (
            <div className="card border-l-4 border-blue-600">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">AI Summary</h2>
              <p className="text-sm text-gray-300 leading-relaxed">{resume.ai_summary}</p>
            </div>
          )}

          {/* Skills */}
          <div className="card space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Primary Skills</h2>
            <div className="flex flex-wrap gap-1.5">
              {resume.primary_skills?.map(skill => (
                <span key={skill} className="px-2.5 py-1 bg-blue-900/40 text-blue-300 text-sm rounded-md border border-blue-800/50">
                  {skill}
                </span>
              ))}
              {(!resume.primary_skills || resume.primary_skills.length === 0) && (
                <span className="text-sm text-gray-500">Not extracted yet</span>
              )}
            </div>
            {resume.secondary_skills?.length > 0 && (
              <>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-1">Secondary Skills</h2>
                <div className="flex flex-wrap gap-1.5">
                  {resume.secondary_skills.map(skill => (
                    <span key={skill} className="px-2.5 py-1 bg-gray-700/50 text-gray-300 text-sm rounded-md">
                      {skill}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Education & Certs */}
          {(resume.education || resume.certifications?.length > 0) && (
            <div className="card space-y-3">
              {resume.education && (
                <div>
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Education</h2>
                  <p className="text-sm text-gray-300">{resume.education}</p>
                </div>
              )}
              {resume.certifications?.length > 0 && (
                <div>
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Certifications</h2>
                  <div className="flex flex-wrap gap-1.5">
                    {resume.certifications.map(c => (
                      <span key={c} className="px-2.5 py-1 bg-amber-900/30 text-amber-300 text-xs rounded border border-amber-800/40">{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Recent Submissions */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Recent Submissions</h2>
              <Link href={`/submissions?resume_id=${resume.id}`} className="text-xs text-blue-400 hover:text-blue-300">
                View all →
              </Link>
            </div>
            {submissions.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No submissions yet.</p>
            ) : (
              <div className="space-y-2">
                {submissions.slice(0, 5).map(sub => (
                  <Link key={sub.id} href={`/submissions/${sub.id}`}
                    className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-gray-200">{sub.job_title}</p>
                      <p className="text-xs text-gray-400">{sub.company_name || '—'} · {sub.platform || 'manual'}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[sub.status] || 'bg-gray-700 text-gray-300'}`}>
                      {sub.status.replace('_', ' ')}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right col — details */}
        <div className="space-y-5">
          <div className="card space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Details</h2>
            {[
              { icon: '⏱', label: 'Experience', value: resume.experience_years ? `${resume.experience_years} years` : null },
              { icon: '📍', label: 'Location', value: resume.current_location },
              { icon: '🛂', label: 'Visa', value: resume.visa_status },
              { icon: '💼', label: 'Work Auth', value: resume.work_auth },
              { icon: '🏠', label: 'Work Mode', value: resume.work_mode_pref },
              { icon: '✈️', label: 'Relocation', value: resume.relocation ? 'Yes' : 'No' },
              { icon: '💰', label: 'Rate', value: resume.rate_expectation },
              { icon: '📧', label: 'Email', value: resume.email },
              { icon: '📞', label: 'Phone', value: resume.phone },
            ].map(item => item.value && (
              <div key={item.label} className="flex items-start gap-2">
                <span className="text-sm shrink-0">{item.icon}</span>
                <div>
                  <p className="text-xs text-gray-500">{item.label}</p>
                  <p className="text-sm text-gray-200">{item.value}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="card space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pipeline</h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="text-center p-2 bg-gray-800 rounded-lg">
                <div className="text-lg font-bold text-white">{submissions.length}</div>
                <div className="text-xs text-gray-400">Total</div>
              </div>
              <div className="text-center p-2 bg-emerald-900/30 rounded-lg border border-emerald-800/30">
                <div className="text-lg font-bold text-emerald-400">
                  {submissions.filter(s => s.status === 'placed').length}
                </div>
                <div className="text-xs text-gray-400">Placed</div>
              </div>
              <div className="text-center p-2 bg-cyan-900/30 rounded-lg border border-cyan-800/30">
                <div className="text-lg font-bold text-cyan-400">
                  {submissions.filter(s => s.status === 'interview').length}
                </div>
                <div className="text-xs text-gray-400">Interview</div>
              </div>
              <div className="text-center p-2 bg-red-900/30 rounded-lg border border-red-800/30">
                <div className="text-lg font-bold text-red-400">
                  {submissions.filter(s => s.status === 'rejected').length}
                </div>
                <div className="text-xs text-gray-400">Rejected</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
