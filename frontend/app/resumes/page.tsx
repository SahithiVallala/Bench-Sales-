'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

interface Resume {
  id: string
  candidate_name: string
  email: string | null
  phone: string | null
  primary_role: string | null
  primary_skills: string[]
  experience_years: number | null
  visa_status: string | null
  work_auth: string | null
  current_location: string | null
  work_mode_pref: string | null
  ai_summary: string | null
  created_at: string
}

const VISA_COLORS: Record<string, string> = {
  H1B: 'bg-blue-900 text-blue-300',
  OPT:  'bg-purple-900 text-purple-300',
  GC:   'bg-green-900 text-green-300',
  USC:  'bg-emerald-900 text-emerald-300',
  TN:   'bg-cyan-900 text-cyan-300',
  EAD:  'bg-yellow-900 text-yellow-300',
  CPT:  'bg-orange-900 text-orange-300',
}

export default function ResumesPage() {
  const [resumes, setResumes] = useState<Resume[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    apiFetch('/api/resumes')
      .then(setResumes)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete resume for ${name}? This will also delete all their submissions.`)) return
    setDeleting(id)
    try {
      await apiFetch(`/api/resumes/${id}`, { method: 'DELETE' })
      setResumes(prev => prev.filter(r => r.id !== id))
    } catch (e: any) {
      alert('Delete failed: ' + e.message)
    } finally {
      setDeleting(null)
    }
  }

  const filtered = resumes.filter(r =>
    r.candidate_name.toLowerCase().includes(search.toLowerCase()) ||
    (r.primary_role || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.current_location || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Bench Candidates</h1>
          <p className="text-sm text-gray-400 mt-0.5">{resumes.length} candidate{resumes.length !== 1 ? 's' : ''} on bench</p>
        </div>
        <Link
          href="/resumes/new"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <span>+</span> Add Candidate
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        <input
          type="text"
          placeholder="Search by name, role, or location..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="card animate-pulse">
              <div className="h-4 bg-gray-700 rounded w-2/3 mb-3" />
              <div className="h-3 bg-gray-700 rounded w-1/2 mb-4" />
              <div className="flex gap-2">
                <div className="h-6 bg-gray-700 rounded w-16" />
                <div className="h-6 bg-gray-700 rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="card text-center py-16">
          <div className="text-4xl mb-3">📄</div>
          <p className="text-gray-400 text-sm">
            {search ? 'No candidates match your search.' : 'No candidates yet. Add your first bench candidate.'}
          </p>
          {!search && (
            <Link href="/resumes/new" className="inline-block mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
              Add First Candidate
            </Link>
          )}
        </div>
      )}

      {/* Cards Grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(resume => (
            <div key={resume.id} className="card group hover:border-gray-600 transition-colors">
              {/* Top: name + visa */}
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-white text-base leading-tight">{resume.candidate_name}</h3>
                  {resume.primary_role && (
                    <p className="text-sm text-blue-400 mt-0.5">{resume.primary_role}</p>
                  )}
                </div>
                {resume.visa_status && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${VISA_COLORS[resume.visa_status] || 'bg-gray-700 text-gray-300'}`}>
                    {resume.visa_status}
                  </span>
                )}
              </div>

              {/* Meta info */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 mb-3">
                {resume.experience_years && <span>⏱ {resume.experience_years}y exp</span>}
                {resume.current_location && <span>📍 {resume.current_location}</span>}
                {resume.work_auth && <span>💼 {resume.work_auth}</span>}
                {resume.work_mode_pref && resume.work_mode_pref !== 'any' && (
                  <span>🏠 {resume.work_mode_pref}</span>
                )}
              </div>

              {/* Skills */}
              {resume.primary_skills?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-4">
                  {resume.primary_skills.slice(0, 5).map(skill => (
                    <span key={skill} className="text-xs px-2 py-0.5 bg-gray-700 text-gray-300 rounded">
                      {skill}
                    </span>
                  ))}
                  {resume.primary_skills.length > 5 && (
                    <span className="text-xs px-2 py-0.5 text-gray-500">
                      +{resume.primary_skills.length - 5} more
                    </span>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-3 border-t border-gray-800">
                <Link
                  href={`/resumes/${resume.id}`}
                  className="flex-1 text-center py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 rounded transition-colors"
                >
                  View Profile
                </Link>
                <Link
                  href={`/search?resume_id=${resume.id}&name=${encodeURIComponent(resume.candidate_name)}`}
                  className="flex-1 text-center py-1.5 text-xs font-medium text-green-400 hover:text-green-300 hover:bg-green-900/20 rounded transition-colors"
                >
                  Find Jobs
                </Link>
                <button
                  onClick={() => handleDelete(resume.id, resume.candidate_name)}
                  disabled={deleting === resume.id}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
                >
                  {deleting === resume.id ? '...' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
