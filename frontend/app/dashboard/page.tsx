'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

interface Stats {
  total_resumes: number
  active_submissions: number
  submitted_today: number
  interviews_this_week: number
  placements_this_month: number
  pipeline: Record<string, number>
}

const PIPELINE_STAGES = [
  { key: 'shortlisted',       label: 'Shortlisted',       color: 'bg-blue-500' },
  { key: 'resume_ready',      label: 'Resume Ready',      color: 'bg-purple-500' },
  { key: 'submitted',         label: 'Submitted',         color: 'bg-yellow-500' },
  { key: 'vendor_submitted',  label: 'Vendor Submitted',  color: 'bg-orange-500' },
  { key: 'client_submitted',  label: 'Client Submitted',  color: 'bg-amber-500' },
  { key: 'interview',         label: 'Interview',         color: 'bg-cyan-500' },
  { key: 'offer',             label: 'Offer',             color: 'bg-green-500' },
  { key: 'placed',            label: 'Placed',            color: 'bg-emerald-500' },
]

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    apiFetch('/api/analytics/dashboard')
      .then(setStats)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="space-y-6">
      <div className="h-8 bg-gray-800 rounded w-48 animate-pulse" />
      <div className="grid grid-cols-5 gap-4">
        {[1,2,3,4,5].map(i => <div key={i} className="card h-28 animate-pulse" />)}
      </div>
    </div>
  )

  if (error || !stats) return (
    <div className="card text-center py-16">
      <div className="text-4xl mb-3">⚠️</div>
      <p className="text-gray-400 mb-2">Could not connect to backend.</p>
      <p className="text-sm text-gray-500 mb-4">
        Make sure FastAPI is running on <span className="text-blue-400">http://localhost:8000</span>
      </p>
      <div className="bg-gray-800 rounded-lg p-4 text-left max-w-sm mx-auto font-mono text-xs space-y-1">
        <p className="text-gray-400">cd bench-sales-platform/backend</p>
        <p className="text-gray-400">pip install -r requirements.txt</p>
        <p className="text-emerald-400">uvicorn main:app --reload</p>
      </div>
    </div>
  )

  const maxStageCount = Math.max(...PIPELINE_STAGES.map(s => stats.pipeline[s.key] || 0), 1)
  const totalActive   = PIPELINE_STAGES.reduce((sum, s) => sum + (stats.pipeline[s.key] || 0), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Bench sales pipeline overview</p>
        </div>
        <div className="flex gap-2">
          <Link href="/resumes/new"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
            + Add Candidate
          </Link>
          <Link href="/search"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-medium rounded-lg border border-gray-700 transition-colors">
            🔍 Find Jobs
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Bench Candidates', value: stats.total_resumes,         color: 'text-blue-400',    icon: '👤', href: '/resumes' },
          { label: 'Active Pipeline',  value: stats.active_submissions,    color: 'text-purple-400',  icon: '📊', href: '/submissions' },
          { label: 'Submitted Today',  value: stats.submitted_today,       color: 'text-yellow-400',  icon: '📬', href: '/submissions' },
          { label: 'Interviews/Week',  value: stats.interviews_this_week,  color: 'text-cyan-400',    icon: '🎯', href: '/submissions' },
          { label: 'Placed/Month',     value: stats.placements_this_month, color: 'text-emerald-400', icon: '✅', href: '/submissions' },
        ].map(kpi => (
          <Link key={kpi.label} href={kpi.href}
            className="card hover:border-gray-600 transition-colors group text-center">
            <div className="text-2xl mb-2">{kpi.icon}</div>
            <div className={`text-3xl font-bold ${kpi.color} mb-1`}>{kpi.value}</div>
            <div className="text-xs text-gray-400">{kpi.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Pipeline Funnel */}
        <div className="col-span-2 card">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-gray-300">Submission Pipeline</h2>
            <span className="text-xs text-gray-500">{totalActive} active</span>
          </div>
          <div className="space-y-3">
            {PIPELINE_STAGES.map(stage => {
              const count = stats.pipeline[stage.key] || 0
              const pct   = Math.round((count / maxStageCount) * 100)
              return (
                <div key={stage.key} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${stage.color}`} />
                  <span className="text-xs text-gray-400 w-32 shrink-0">{stage.label}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2">
                    <div className={`${stage.color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm font-medium text-gray-300 w-5 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right side */}
        <div className="space-y-4">
          {/* Quick actions */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Quick Actions</h2>
            <div className="space-y-1.5">
              {[
                { href: '/resumes/new', icon: '📤', label: 'Upload Resume' },
                { href: '/search',      icon: '🔍', label: 'Search Jobs' },
                { href: '/submissions', icon: '📬', label: 'View Submissions' },
                { href: '/vendors',     icon: '🏢', label: 'Manage Vendors' },
              ].map(a => (
                <Link key={a.href} href={a.href}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-800 text-sm text-gray-400 hover:text-gray-100 transition-colors">
                  <span>{a.icon}</span> {a.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Outcomes */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Outcomes</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Placed',   key: 'placed',   color: 'text-emerald-400' },
                { label: 'Offer',    key: 'offer',    color: 'text-green-400' },
                { label: 'Rejected', key: 'rejected', color: 'text-red-400' },
                { label: 'On Hold',  key: 'on_hold',  color: 'text-gray-400' },
              ].map(item => (
                <div key={item.key} className="text-center p-3 bg-gray-800 rounded-lg">
                  <div className={`text-2xl font-bold ${item.color}`}>{stats.pipeline[item.key] || 0}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
