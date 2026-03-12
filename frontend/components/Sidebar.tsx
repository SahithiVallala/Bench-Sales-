'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/dashboard',    label: 'Dashboard',    icon: '📊' },
  { href: '/resumes',      label: 'Resumes',       icon: '📄' },
  { href: '/search',       label: 'Job Search',    icon: '🔍' },
  { href: '/submissions',  label: 'Submissions',   icon: '📬' },
  { href: '/jd-inbox',     label: 'JD Inbox',      icon: '📧' },
  { href: '/vendors',      label: 'Vendors',       icon: '🏢' },
]

export default function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="fixed top-0 left-0 h-screen w-64 bg-gray-900 border-r border-gray-800 flex flex-col z-50">
      <div className="p-5 border-b border-gray-800">
        <h1 className="text-lg font-bold text-white">Bench Sales</h1>
        <p className="text-xs text-gray-500 mt-0.5">Automation Platform</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
              }`}>
              <span>{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="p-4 border-t border-gray-800 text-xs text-gray-600">
        v1.0 · No login (dev mode)
      </div>
    </aside>
  )
}
