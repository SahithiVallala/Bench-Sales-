'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

const VISA_OPTIONS = ['H1B', 'OPT', 'GC', 'USC', 'TN', 'EAD', 'CPT', 'Other']
const WORK_AUTH_OPTIONS = ['W2', 'C2C', '1099', 'Any']
const WORK_MODE_OPTIONS = ['any', 'remote', 'hybrid', 'onsite']
const NOTICE_PERIOD_OPTIONS = ['Immediate', '1 week', '2 weeks', '1 month', '2 months', '3 months']

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function NewResumePage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [parsing, setParsing]       = useState(false)   // extracting contact info
  const [error, setError]           = useState<string | null>(null)
  const [dragOver, setDragOver]     = useState(false)
  // Which fields were auto-filled (show subtle highlight so user knows)
  const [autoFilled, setAutoFilled] = useState<Set<string>>(new Set())

  const [form, setForm] = useState({
    candidate_name: '',
    email: '',
    phone: '',
    visa_status: '',
    work_auth: '',
    current_location: '',
    relocation: false,
    work_mode_pref: 'any',
    // Job-application fields
    linkedin_url: '',
    portfolio_url: '',
    city: '',
    state: '',
    zip_code: '',
    current_company: '',
    notice_period: '',
    cover_letter_template: '',
  })

  const set = (field: string, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }))
    // If user manually edits an auto-filled field, remove the highlight
    setAutoFilled(prev => { const n = new Set(prev); n.delete(field); return n })
  }

  const isValidFile = (f: File) =>
    f.type === 'application/pdf' ||
    f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    f.name.toLowerCase().endsWith('.doc') ||
    f.name.toLowerCase().endsWith('.docx')

  /** Called whenever a valid file is selected — extracts contact info automatically */
  const handleFileSelected = async (f: File) => {
    setFile(f)
    setError(null)
    setParsing(true)

    try {
      const fd = new FormData()
      fd.append('file', f)
      const res = await fetch(`${API_BASE}/api/resumes/extract-contact`, {
        method: 'POST',
        body: fd,
      })

      if (!res.ok) throw new Error('Contact extraction failed')

      const contact = await res.json()
      const filled = new Set<string>()

      setForm(prev => {
        const next = { ...prev }
        // Only auto-fill fields that are currently empty
        if (!prev.candidate_name.trim() && contact.full_name) {
          next.candidate_name = contact.full_name
          filled.add('candidate_name')
        }
        if (!prev.email.trim() && contact.email) {
          next.email = contact.email
          filled.add('email')
        }
        if (!prev.phone.trim() && contact.phone) {
          next.phone = contact.phone
          filled.add('phone')
        }
        if (!prev.current_location.trim() && contact.location) {
          next.current_location = contact.location
          filled.add('current_location')
        }
        return next
      })
      setAutoFilled(filled)
    } catch (err) {
      // Non-critical — user can still fill manually
      console.warn('Contact extraction failed, user can fill manually:', err)
    } finally {
      setParsing(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped && isValidFile(dropped)) handleFileSelected(dropped)
    else setError('Only PDF and Word (.docx) files are accepted.')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file)                    { setError('Please upload a resume file.'); return }
    if (!form.candidate_name.trim()) { setError('Candidate name is required.'); return }

    setSubmitting(true)
    setError(null)

    const body = new FormData()
    body.append('file', file)
    Object.entries(form).forEach(([k, v]) => body.append(k, String(v)))

    try {
      const res = await fetch(`${API_BASE}/api/resumes`, { method: 'POST', body })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || 'Upload failed')
      }
      const data = await res.json()
      router.push(`/resumes/${data.id}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  /** Shared input class — highlights auto-filled fields with a subtle teal ring */
  const inputClass = (field: string) =>
    `input transition-all ${autoFilled.has(field) ? 'ring-1 ring-teal-500/60 bg-teal-950/10' : ''}`

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <button onClick={() => router.back()} className="text-xs text-gray-500 hover:text-gray-300 mb-3 flex items-center gap-1 transition-colors">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-white">Add Bench Candidate</h1>
        <p className="text-sm text-gray-400 mt-1">Upload resume — AI will automatically extract name, contact info, skills and experience. Fill extra fields so the extension can auto-apply to jobs.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* File Upload */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            dragOver ? 'border-blue-500 bg-blue-950/30' :
            file      ? 'border-green-600 bg-green-950/20' :
                        'border-gray-700 hover:border-gray-500'
          }`}
        >
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f && isValidFile(f)) handleFileSelected(f)
              else if (f) setError('Only PDF and Word (.docx) files are accepted.')
            }} />

          {file ? (
            <div>
              <div className="text-2xl mb-2">📄</div>
              <p className="text-sm text-green-400 font-medium">{file.name}</p>
              <p className="text-xs text-gray-500 mt-1">{(file.size / 1024).toFixed(0)} KB — click to change</p>
              {parsing && (
                <p className="text-xs text-teal-400 mt-2 animate-pulse">
                  ⟳ Extracting contact info from resume...
                </p>
              )}
            </div>
          ) : (
            <div>
              <div className="text-3xl mb-2">📤</div>
              <p className="text-sm text-gray-300 font-medium">Drop PDF or Word file here or click to browse</p>
              <p className="text-xs text-gray-500 mt-1">PDF or .docx, max 10MB — name & contact will be auto-detected</p>
            </div>
          )}
        </div>

        {/* Auto-fill notice */}
        {autoFilled.size > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 bg-teal-950/40 border border-teal-800/50 rounded-lg text-xs text-teal-400">
            ✓ Auto-filled {autoFilled.size} field{autoFilled.size > 1 ? 's' : ''} from resume — review and edit if needed.
          </div>
        )}

        {/* Candidate Info */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Candidate Info</h2>
            {parsing && (
              <span className="text-xs text-teal-400 animate-pulse">Parsing resume...</span>
            )}
          </div>

          <div>
            <label className="label">Full Name *</label>
            <input
              required
              value={form.candidate_name}
              onChange={e => set('candidate_name', e.target.value)}
              placeholder={parsing ? 'Extracting from resume...' : 'e.g. John Smith'}
              className={inputClass('candidate_name')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder={parsing ? 'Extracting...' : 'john@email.com'}
                className={inputClass('email')}
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                placeholder={parsing ? 'Extracting...' : '+1 (555) 000-0000'}
                className={inputClass('phone')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Current Company</label>
              <input value={form.current_company}
                onChange={e => set('current_company', e.target.value)}
                placeholder="e.g. TCS or Fresher"
                className="input" />
            </div>
            <div>
              <label className="label">Notice Period</label>
              <select value={form.notice_period}
                onChange={e => set('notice_period', e.target.value)}
                className="input">
                <option value="">Select...</option>
                {NOTICE_PERIOD_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Location</h2>
          <div>
            <label className="label">Current Location (display)</label>
            <input value={form.current_location}
              onChange={e => set('current_location', e.target.value)}
              placeholder={parsing ? 'Extracting...' : 'e.g. Austin, TX'}
              className={inputClass('current_location')} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">City</label>
              <input value={form.city}
                onChange={e => set('city', e.target.value)}
                placeholder="Austin"
                className="input" />
            </div>
            <div>
              <label className="label">State</label>
              <input value={form.state}
                onChange={e => set('state', e.target.value)}
                placeholder="TX"
                className="input" />
            </div>
            <div>
              <label className="label">ZIP Code</label>
              <input value={form.zip_code}
                onChange={e => set('zip_code', e.target.value)}
                placeholder="78701"
                className="input" />
            </div>
          </div>
        </div>

        {/* Work Authorization */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Work Authorization</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Visa Status</label>
              <select value={form.visa_status}
                onChange={e => set('visa_status', e.target.value)}
                className="input">
                <option value="">Select...</option>
                {VISA_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Work Auth Type</label>
              <select value={form.work_auth}
                onChange={e => set('work_auth', e.target.value)}
                className="input">
                <option value="">Select...</option>
                {WORK_AUTH_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Work Mode Preference</label>
              <select value={form.work_mode_pref}
                onChange={e => set('work_mode_pref', e.target.value)}
                className="input">
                {WORK_MODE_OPTIONS.map(v => (
                  <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.relocation}
                  onChange={e => set('relocation', e.target.checked)}
                  className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500" />
                <span className="text-sm text-gray-300">Open to relocation</span>
              </label>
            </div>
          </div>
        </div>

        {/* Online Profiles */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Online Profiles</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">LinkedIn URL</label>
              <input value={form.linkedin_url}
                onChange={e => set('linkedin_url', e.target.value)}
                placeholder="linkedin.com/in/username"
                className="input" />
            </div>
            <div>
              <label className="label">Portfolio / GitHub URL</label>
              <input value={form.portfolio_url}
                onChange={e => set('portfolio_url', e.target.value)}
                placeholder="github.com/username"
                className="input" />
            </div>
          </div>
        </div>

        {/* Cover Letter Template */}
        <div className="card space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Cover Letter Template</h2>
            <p className="text-xs text-gray-500 mt-1">
              Use <span className="text-blue-400 font-mono">[COMPANY]</span> and <span className="text-blue-400 font-mono">[JOB]</span> — the extension will auto-replace them when applying.
            </p>
          </div>
          <textarea
            value={form.cover_letter_template}
            onChange={e => set('cover_letter_template', e.target.value)}
            rows={5}
            placeholder="Dear Hiring Manager at [COMPANY],&#10;&#10;I am excited to apply for the [JOB] position. With my background in..."
            className="input resize-none"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-950/50 border border-red-800 rounded-lg text-sm text-red-400">
            <span>⚠</span> {error}
          </div>
        )}

        {/* Submit */}
        <div className="flex gap-3">
          <button type="button" onClick={() => router.back()}
            className="px-4 py-2.5 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 rounded-lg transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={submitting || parsing}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors">
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⟳</span> Uploading & Parsing Resume...
              </span>
            ) : parsing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⟳</span> Extracting contact info...
              </span>
            ) : 'Upload & Parse Resume'}
          </button>
        </div>
      </form>
    </div>
  )
}
