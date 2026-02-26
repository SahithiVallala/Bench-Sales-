'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface Vendor {
  id: string
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  tier: string
  specializations: string[]
  total_submissions: number
  total_placements: number
  is_active: boolean
  notes: string | null
  created_at: string
}

const TIER_COLORS: Record<string, string> = {
  preferred: 'bg-amber-900/50 text-amber-300 border border-amber-800',
  standard:  'bg-blue-900/50 text-blue-300 border border-blue-800',
  new:       'bg-gray-700 text-gray-300 border border-gray-600',
}

const EMPTY_FORM = {
  company_name: '', contact_name: '', email: '',
  phone: '', tier: 'standard', specializations: '', notes: '',
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = () => {
    setLoading(true)
    apiFetch('/api/vendors')
      .then(setVendors)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.company_name.trim()) { setError('Company name is required.'); return }
    setSaving(true)
    setError(null)
    try {
      await apiFetch('/api/vendors', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          specializations: form.specializations
            ? form.specializations.split(',').map(s => s.trim()).filter(Boolean)
            : [],
        }),
      })
      setForm({ ...EMPTY_FORM })
      setShowForm(false)
      load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await apiFetch(`/api/vendors/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !current }),
      })
      load()
    } catch (err: any) {
      alert('Update failed: ' + err.message)
    }
  }

  const filtered = vendors.filter(v =>
    !search ||
    v.company_name.toLowerCase().includes(search.toLowerCase()) ||
    (v.contact_name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Vendors</h1>
          <p className="text-sm text-gray-400 mt-0.5">{vendors.length} vendor{vendors.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
          {showForm ? '✕ Cancel' : '+ Add Vendor'}
        </button>
      </div>

      {/* Add Form */}
      {showForm && (
        <form onSubmit={handleAdd} className="card space-y-4">
          <h2 className="text-sm font-semibold text-white">Add New Vendor</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Company Name *</label>
              <input required value={form.company_name} onChange={e => set('company_name', e.target.value)}
                placeholder="e.g. TechStaff Solutions" className="input" />
            </div>
            <div>
              <label className="label">Contact Name</label>
              <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)}
                placeholder="e.g. John Smith" className="input" />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="vendor@company.com" className="input" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                placeholder="+1 (555) 000-0000" className="input" />
            </div>
            <div>
              <label className="label">Tier</label>
              <select value={form.tier} onChange={e => set('tier', e.target.value)} className="input">
                <option value="preferred">Preferred</option>
                <option value="standard">Standard</option>
                <option value="new">New</option>
              </select>
            </div>
            <div>
              <label className="label">Specializations (comma-separated)</label>
              <input value={form.specializations} onChange={e => set('specializations', e.target.value)}
                placeholder="e.g. Java, AWS, DevOps" className="input" />
            </div>
            <div className="col-span-2">
              <label className="label">Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                placeholder="Any notes about this vendor..." rows={2}
                className="input resize-none" />
            </div>
          </div>
          {error && <p className="text-sm text-red-400">⚠ {error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-gray-400 border border-gray-700 rounded-lg hover:border-gray-500 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {saving ? 'Saving...' : 'Add Vendor'}
            </button>
          </div>
        </form>
      )}

      {/* Search */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        <input type="text" placeholder="Search vendors..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500" />
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="card animate-pulse h-32" />)}
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="card text-center py-16">
          <div className="text-4xl mb-3">🏢</div>
          <p className="text-gray-400 text-sm">{search ? 'No vendors match your search.' : 'No vendors yet. Add your first vendor contact.'}</p>
        </div>
      )}

      {/* Vendor grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(v => (
            <div key={v.id} className={`card ${!v.is_active ? 'opacity-50' : ''} hover:border-gray-600 transition-colors`}>
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-white">{v.company_name}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full ${TIER_COLORS[v.tier] || TIER_COLORS.standard}`}>
                  {v.tier}
                </span>
              </div>
              {v.contact_name && <p className="text-sm text-gray-400">👤 {v.contact_name}</p>}
              {v.email && (
                <a href={`mailto:${v.email}`} className="text-sm text-blue-400 hover:text-blue-300 block mt-0.5">
                  ✉ {v.email}
                </a>
              )}
              {v.phone && <p className="text-sm text-gray-400 mt-0.5">📞 {v.phone}</p>}

              {v.specializations?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {v.specializations.map(s => (
                    <span key={s} className="text-xs px-2 py-0.5 bg-gray-700 text-gray-400 rounded">{s}</span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-800">
                <div className="flex gap-4 text-xs text-gray-400">
                  <span>📬 {v.total_submissions} submitted</span>
                  <span className="text-emerald-400">✓ {v.total_placements} placed</span>
                </div>
                <button onClick={() => handleToggleActive(v.id, v.is_active)}
                  className={`text-xs px-2 py-0.5 rounded transition-colors ${
                    v.is_active
                      ? 'text-gray-500 hover:text-red-400'
                      : 'text-green-400 hover:text-green-300'
                  }`}>
                  {v.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
