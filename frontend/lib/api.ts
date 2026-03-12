const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export async function apiFetch(path: string, options?: RequestInit, timeoutMs = 120_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      signal: controller.signal,
      ...options,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || `API error ${res.status}`)
    }
    return res.json()
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out — the server is taking too long. Try fewer platforms or results.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
