'use client'

import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { useEffect, useState, useMemo } from 'react'

interface Title {
  id: string
  isbn13: string
  title: string
  format: string | null
  pub_date: string | null
  price_usd: number | null
  publishing_status: string | null
  updated_at: string | null
  publishers: { name: string } | null
}

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

function formatDate(val: string | null) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatPrice(val: number | null) {
  if (val === null || val === undefined) return '—'
  return `$${Number(val).toFixed(2)}`
}

export default function TitlesPage() {
  const [titles, setTitles] = useState<Title[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const supabase = getClient()
    supabase
      .from('titles')
      .select('id, isbn13, title, format, pub_date, price_usd, publishing_status, updated_at, publishers(name)')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setTitles((data as unknown as Title[]) ?? [])
        setLoading(false)
      })
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return titles
    return titles.filter(
      (t) =>
        t.title?.toLowerCase().includes(q) ||
        t.isbn13?.toLowerCase().includes(q)
    )
  }, [titles, search])

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Titles</h1>
          {!loading && (
            <p className="text-sm text-gray-500 mt-0.5">
              {filtered.length} of {titles.length} title{titles.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <Link
          href="/admin/import"
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded"
        >
          Import
        </Link>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by title or ISBN13..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* States */}
      {loading && <p className="text-gray-500 text-sm">Loading...</p>}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-4 py-3 text-sm">
          Error: {error}
        </div>
      )}

      {!loading && !error && titles.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-medium">No titles yet.</p>
          <p className="text-sm mt-1">
            <Link href="/admin/import" className="text-blue-600 hover:underline">
              Import your first batch
            </Link>{' '}
            to get started.
          </p>
        </div>
      )}

      {!loading && !error && titles.length > 0 && (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 text-gray-700 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">ISBN13</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Publisher</th>
                <th className="px-4 py-2 font-medium">Format</th>
                <th className="px-4 py-2 font-medium">Pub Date</th>
                <th className="px-4 py-2 font-medium">Price (USD)</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => (
                <tr
                  key={t.id}
                  className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                >
                  <td className="px-4 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">
                    <Link
                      href={`/admin/titles/${t.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {t.isbn13}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-gray-900 max-w-xs truncate">
                    <Link
                      href={`/admin/titles/${t.id}`}
                      className="hover:underline"
                    >
                      {t.title || <span className="text-gray-400 italic">Untitled</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-gray-700">{t.publishers?.name ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{t.format ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{formatDate(t.pub_date)}</td>
                  <td className="px-4 py-2 text-gray-700">{formatPrice(t.price_usd)}</td>
                  <td className="px-4 py-2">
                    {t.publishing_status ? (
                      <span className="inline-block px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800">
                        {t.publishing_status}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap text-xs">
                    {formatDate(t.updated_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && search && (
            <p className="px-4 py-6 text-center text-gray-400 text-sm">
              No results for &ldquo;{search}&rdquo;
            </p>
          )}
        </div>
      )}
    </div>
  )
}
