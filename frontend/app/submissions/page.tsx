'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

interface Submission {
  id: string
  candidate_name: string | null
  candidate_role: string | null
  job_title: string
  company_name: string | null
  platform: string | null
  job_url: string | null
  status: string
  vendor_company: string | null
  bill_rate: number | null
  created_at: string
  submitted_at: string | null
  interview_at: string | null
  placed_at: string | null
}

const STATUS_OPTIONS = [
  { value: 'all',              label: 'All' },
  { value: 'shortlisted',      label: 'Shortlisted' },
  { value: 'resume_ready',     label: 'Resume Ready' },
  { value: 'submitted',        label: 'Submitted' },
  { value: 'vendor_submitted', label: 'Vendor Submitted' },
  { value: 'client_submitted', label: 'Client Submitted' },
  { value: 'interview',        label: 'Interview' },
  { value: 'offer',            label: 'Offer' },
  { value: 'placed',           label: 'Placed' },
  { value: 'rejected',         label: 'Rejected' },
  { value: 'on_hold',          label: 'On Hold' },
]

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
  on_hold:          'bg-gray-700 text-gray-300 border border-gray-600',
}

const PLATFORM_ICONS: Record<string, string> = {
  linkedin: '💼', indeed: '🔵', naukri: '🟠', dice: '🎲',
  glassdoor: '🪟', ziprecruiter: '🟡', remotive: '🌍',
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function SubmissionsInner() {
  const searchParams = useSearchParams()
  const preResumeId = searchParams.get('resume_id') || ''

  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  const load = (status?: string) => {
    setLoading(true)
    const params = new URLSearchParams({ limit: '100' })
    if (status && status !== 'all') params.set('status', status)
    if (preResumeId) params.set('resume_id', preResumeId)
    apiFetch(`/api/submissions?${params}`)
      .then(setSubmissions)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(statusFilter) }, [statusFilter])

  const filtered = submissions.filter(s =>
    !search ||
    (s.candidate_name || '').toLowerCase().includes(search.toLowerCase()) ||
    s.job_title.toLowerCase().includes(search.toLowerCase()) ||
    (s.company_name || '').toLowerCase().includes(search.toLowerCase())
  )

  // Counts per status
  const counts: Record<string, number> = {}
  submissions.forEach(s => { counts[s.status] = (counts[s.status] || 0) + 1 })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Submissions</h1>
          <p className="text-sm text-gray-400 mt-0.5">Track every resume submission through the pipeline</p>
        </div>
        <Link href="/search"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
          + New Submission
        </Link>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {STATUS_OPTIONS.map(opt => {
          const count = opt.value === 'all' ? submissions.length : (counts[opt.value] || 0)
          return (
            <button key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === opt.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}>
              {opt.label} {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        <input type="text" placeholder="Search candidate, job, or company..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500" />
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="card animate-pulse flex gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-700 rounded w-1/3" />
                <div className="h-3 bg-gray-700 rounded w-1/2" />
              </div>
              <div className="h-6 bg-gray-700 rounded w-20" />
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="card text-center py-16">
          <div className="text-4xl mb-3">📬</div>
          <p className="text-gray-400 text-sm">
            {search ? 'No submissions match your search.' : 'No submissions yet. Search for jobs and click "Apply & Track".'}
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && filtered.length > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/50">
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">Candidate</th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">Job</th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">Platform</th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">Vendor</th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-4 py-3">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filtered.map(sub => (
                  <tr key={sub.id} className="hover:bg-gray-800/40 transition-colors group">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-200">{sub.candidate_name || '—'}</p>
                      {sub.candidate_role && <p className="text-xs text-gray-500">{sub.candidate_role}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-200 font-medium">{sub.job_title}</p>
                      {sub.company_name && <p className="text-xs text-gray-500">{sub.company_name}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm">
                        {PLATFORM_ICONS[sub.platform || ''] || '💼'} {sub.platform || 'manual'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">{sub.vendor_company || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[sub.status] || 'bg-gray-700 text-gray-300'}`}>
                        {sub.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{fmt(sub.created_at)}</td>
                    <td className="px-4 py-3">
                      <Link href={`/submissions/${sub.id}`}
                        className="text-xs text-blue-400 hover:text-blue-300 opacity-0 group-hover:opacity-100 transition-opacity">
                        Details →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SubmissionsPage() {
  return (
    <Suspense fallback={<div className="text-gray-400">Loading...</div>}>
      <SubmissionsInner />
    </Suspense>
  )
}
