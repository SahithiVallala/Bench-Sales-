'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

const VISA_OPTIONS = ['H1B', 'OPT', 'GC', 'USC', 'TN', 'EAD', 'CPT', 'Other']
const WORK_AUTH_OPTIONS = ['W2', 'C2C', '1099', 'Any']
const WORK_MODE_OPTIONS = ['any', 'remote', 'hybrid', 'onsite']

export default function NewResumePage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const [form, setForm] = useState({
    candidate_name: '',
    email: '',
    phone: '',
    visa_status: '',
    work_auth: '',
    current_location: '',
    relocation: false,
    work_mode_pref: 'any',
  })

  const set = (field: string, value: any) =>
    setForm(prev => ({ ...prev, [field]: value }))

  const isValidFile = (f: File) =>
    f.type === 'application/pdf' ||
    f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    f.name.toLowerCase().endsWith('.doc') ||
    f.name.toLowerCase().endsWith('.docx')

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped && isValidFile(dropped)) setFile(dropped)
    else setError('Only PDF and Word (.docx) files are accepted.')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) { setError('Please upload a resume file.'); return }
    if (!form.candidate_name.trim()) { setError('Candidate name is required.'); return }

    setSubmitting(true)
    setError(null)

    const body = new FormData()
    body.append('file', file)
    Object.entries(form).forEach(([k, v]) => body.append(k, String(v)))

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/resumes`,
        { method: 'POST', body }
      )
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

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <button onClick={() => router.back()} className="text-xs text-gray-500 hover:text-gray-300 mb-3 flex items-center gap-1 transition-colors">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-white">Add Bench Candidate</h1>
        <p className="text-sm text-gray-400 mt-1">Upload resume — AI will automatically extract skills and experience.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* PDF Upload */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            dragOver ? 'border-blue-500 bg-blue-950/30' :
            file ? 'border-green-600 bg-green-950/20' :
            'border-gray-700 hover:border-gray-500'
          }`}
        >
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f && isValidFile(f)) { setFile(f); setError(null) }
              else if (f) setError('Only PDF and Word (.docx) files are accepted.')
            }} />
          {file ? (
            <div>
              <div className="text-2xl mb-2">📄</div>
              <p className="text-sm text-green-400 font-medium">{file.name}</p>
              <p className="text-xs text-gray-500 mt-1">{(file.size / 1024).toFixed(0)} KB — click to change</p>
            </div>
          ) : (
            <div>
              <div className="text-3xl mb-2">📤</div>
              <p className="text-sm text-gray-300 font-medium">Drop PDF or Word file here or click to browse</p>
              <p className="text-xs text-gray-500 mt-1">PDF or .docx, max 10MB</p>
            </div>
          )}
        </div>

        {/* Candidate Info */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Candidate Info</h2>

          <div>
            <label className="label">Full Name *</label>
            <input required value={form.candidate_name}
              onChange={e => set('candidate_name', e.target.value)}
              placeholder="e.g. John Smith"
              className="input" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Email</label>
              <input type="email" value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder="john@email.com"
                className="input" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input value={form.phone}
                onChange={e => set('phone', e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="input" />
            </div>
          </div>

          <div>
            <label className="label">Current Location</label>
            <input value={form.current_location}
              onChange={e => set('current_location', e.target.value)}
              placeholder="e.g. Austin, TX"
              className="input" />
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
          <button type="submit" disabled={submitting}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors">
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⟳</span> Uploading & Parsing Resume...
              </span>
            ) : 'Upload & Parse Resume'}
          </button>
        </div>
      </form>
    </div>
  )
}
