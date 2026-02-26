'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

interface StageEntry { stage: string; changed_at: string; notes: string }
interface Submission {
  id: string
  candidate_name: string | null
  candidate_role: string | null
  candidate_skills: string[] | null
  visa_status: string | null
  work_auth: string | null
  job_title: string
  company_name: string | null
  platform: string | null
  job_url: string | null
  status: string
  stage_history: StageEntry[]
  bill_rate: number | null
  pay_rate: number | null
  rate_type: string
  vendor_company: string | null
  vendor_contact: string | null
  vendor_email: string | null
  submitted_at: string | null
  vendor_submitted_at: string | null
  client_submitted_at: string | null
  interview_at: string | null
  offer_at: string | null
  placed_at: string | null
  submission_note: string | null
  candidate_pitch: string | null
  rejection_reason: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

const STATUS_PIPELINE = [
  'shortlisted', 'resume_ready', 'submitted',
  'vendor_submitted', 'client_submitted',
  'interview', 'offer', 'placed'
]

const STATUS_LABELS: Record<string, string> = {
  shortlisted: 'Shortlisted', resume_ready: 'Resume Ready',
  submitted: 'Submitted', vendor_submitted: 'Vendor Submitted',
  client_submitted: 'Client Submitted', interview: 'Interview',
  offer: 'Offer', placed: 'Placed', rejected: 'Rejected', on_hold: 'On Hold',
}

const STATUS_COLORS: Record<string, string> = {
  shortlisted: 'bg-blue-600', resume_ready: 'bg-purple-600',
  submitted: 'bg-yellow-600', vendor_submitted: 'bg-orange-600',
  client_submitted: 'bg-amber-600', interview: 'bg-cyan-600',
  offer: 'bg-green-600', placed: 'bg-emerald-600',
  rejected: 'bg-red-600', on_hold: 'bg-gray-600',
}

function fmt(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function SubmissionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [sub, setSub] = useState<Submission | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [newStatus, setNewStatus] = useState('')
  const [statusNote, setStatusNote] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = () => {
    apiFetch(`/api/submissions/${id}`)
      .then(data => { setSub(data); setNewStatus(data.status) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (id) load() }, [id])

  const handleStatusUpdate = async () => {
    if (!newStatus || newStatus === sub?.status) return
    setUpdating(true)
    try {
      await apiFetch(`/api/submissions/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus, notes: statusNote }),
      })
      setStatusNote('')
      load()
    } catch (err: any) {
      alert('Update failed: ' + err.message)
    } finally {
      setUpdating(false)
    }
  }

  const handleRegenerate = async () => {
    setRegenerating(true)
    try {
      const data = await apiFetch(`/api/submissions/${id}/regenerate-note`, { method: 'POST' })
      setSub(prev => prev ? { ...prev, submission_note: data.submission_note, candidate_pitch: data.candidate_pitch } : prev)
    } catch (err: any) {
      alert('Regenerate failed: ' + err.message)
    } finally {
      setRegenerating(false)
    }
  }

  const copyNote = () => {
    if (sub?.submission_note) {
      navigator.clipboard.writeText(sub.submission_note)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-gray-800 rounded w-1/2"/><div className="h-48 bg-gray-800 rounded"/></div>
  if (!sub) return <div className="card text-center py-16 text-gray-400">Submission not found. <Link href="/submissions" className="text-blue-400">← Back</Link></div>

  const stageIdx = STATUS_PIPELINE.indexOf(sub.status)
  const isTerminal = ['placed', 'rejected', 'on_hold'].includes(sub.status)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button onClick={() => router.back()} className="text-xs text-gray-500 hover:text-gray-300 mb-2 transition-colors">← Back</button>
          <h1 className="text-xl font-bold text-white">{sub.job_title}</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
            {sub.candidate_name && <span>👤 {sub.candidate_name}</span>}
            {sub.company_name && <span>🏢 {sub.company_name}</span>}
            {sub.platform && <span className="capitalize">{sub.platform}</span>}
          </div>
        </div>
        <span className={`px-3 py-1.5 rounded-full text-sm font-medium text-white ${STATUS_COLORS[sub.status] || 'bg-gray-600'}`}>
          {STATUS_LABELS[sub.status] || sub.status}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Left — Main */}
        <div className="col-span-2 space-y-5">

          {/* Pipeline Progress */}
          {!isTerminal && (
            <div className="card">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Pipeline Progress</h2>
              <div className="flex items-center">
                {STATUS_PIPELINE.map((stage, idx) => (
                  <div key={stage} className="flex-1 flex items-center">
                    <div className="flex flex-col items-center flex-1">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                        idx < stageIdx ? 'bg-blue-600 text-white' :
                        idx === stageIdx ? 'bg-blue-500 text-white ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900' :
                        'bg-gray-700 text-gray-500'
                      }`}>
                        {idx < stageIdx ? '✓' : idx + 1}
                      </div>
                      <span className="text-xs text-gray-500 mt-1 text-center leading-tight" style={{ fontSize: '10px' }}>
                        {STATUS_LABELS[stage]}
                      </span>
                    </div>
                    {idx < STATUS_PIPELINE.length - 1 && (
                      <div className={`h-0.5 flex-1 mx-1 ${idx < stageIdx ? 'bg-blue-600' : 'bg-gray-700'}`} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {sub.status === 'rejected' && (
            <div className="card border-l-4 border-red-600">
              <p className="text-sm text-red-400 font-medium">Rejected</p>
              {sub.rejection_reason && <p className="text-sm text-gray-300 mt-1">{sub.rejection_reason}</p>}
            </div>
          )}

          {/* Candidate Pitch */}
          {sub.candidate_pitch && (
            <div className="card border-l-4 border-cyan-600">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Candidate Pitch</h2>
              <p className="text-sm text-gray-300 leading-relaxed italic">"{sub.candidate_pitch}"</p>
            </div>
          )}

          {/* Submission Note */}
          {sub.submission_note && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Submission Email</h2>
                <div className="flex gap-2">
                  <button onClick={copyNote}
                    className="text-xs px-2.5 py-1 text-gray-400 hover:text-gray-200 border border-gray-700 rounded transition-colors">
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                  <button onClick={handleRegenerate} disabled={regenerating}
                    className="text-xs px-2.5 py-1 text-blue-400 hover:text-blue-300 border border-blue-800 rounded transition-colors disabled:opacity-50">
                    {regenerating ? '⟳ Generating...' : 'Regenerate'}
                  </button>
                </div>
              </div>
              <div className="bg-gray-900 rounded-lg p-4">
                <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{sub.submission_note}</pre>
              </div>
            </div>
          )}

          {/* Stage History */}
          <div className="card">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Stage History</h2>
            <div className="space-y-3">
              {[...(sub.stage_history || [])].reverse().map((entry, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${STATUS_COLORS[entry.stage] || 'bg-gray-500'}`} />
                    {i < (sub.stage_history?.length ?? 0) - 1 && <div className="w-0.5 flex-1 bg-gray-800 my-1" />}
                  </div>
                  <div className="pb-3">
                    <p className="text-sm font-medium text-gray-200">{STATUS_LABELS[entry.stage] || entry.stage}</p>
                    <p className="text-xs text-gray-500">{fmt(entry.changed_at)}</p>
                    {entry.notes && <p className="text-xs text-gray-400 mt-0.5">{entry.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right — Actions + Details */}
        <div className="space-y-5">
          {/* Update Status */}
          <div className="card space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Update Status</h2>
            <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className="input">
              {Object.entries(STATUS_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
            <input value={statusNote} onChange={e => setStatusNote(e.target.value)}
              placeholder="Notes (optional)..."
              className="input text-sm" />
            <button onClick={handleStatusUpdate} disabled={updating || newStatus === sub.status}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {updating ? 'Updating...' : 'Update Status'}
            </button>
          </div>

          {/* Details */}
          <div className="card space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Details</h2>
            {[
              { label: 'Bill Rate', value: sub.bill_rate ? `$${sub.bill_rate}/${sub.rate_type === 'hourly' ? 'hr' : 'yr'}` : null },
              { label: 'Pay Rate', value: sub.pay_rate ? `$${sub.pay_rate}/${sub.rate_type === 'hourly' ? 'hr' : 'yr'}` : null },
              { label: 'Work Auth', value: sub.work_auth },
              { label: 'Visa', value: sub.visa_status },
              { label: 'Submitted', value: fmt(sub.submitted_at) },
              { label: 'Interview', value: fmt(sub.interview_at) },
              { label: 'Offer', value: fmt(sub.offer_at) },
              { label: 'Placed', value: fmt(sub.placed_at) },
              { label: 'Created', value: fmt(sub.created_at) },
            ].map(item => item.value && (
              <div key={item.label}>
                <p className="text-xs text-gray-500">{item.label}</p>
                <p className="text-sm text-gray-200">{item.value}</p>
              </div>
            ))}
          </div>

          {/* Vendor */}
          {sub.vendor_company && (
            <div className="card space-y-2">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Vendor</h2>
              <p className="text-sm text-gray-200 font-medium">{sub.vendor_company}</p>
              {sub.vendor_contact && <p className="text-sm text-gray-400">{sub.vendor_contact}</p>}
              {sub.vendor_email && (
                <a href={`mailto:${sub.vendor_email}`} className="text-xs text-blue-400 hover:text-blue-300">
                  {sub.vendor_email}
                </a>
              )}
            </div>
          )}

          {/* Job Link */}
          {sub.job_url && (
            <a href={sub.job_url} target="_blank" rel="noreferrer"
              className="block w-full text-center py-2.5 border border-gray-700 hover:border-gray-500 text-sm text-gray-300 hover:text-gray-100 rounded-lg transition-colors">
              View Job Posting ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
