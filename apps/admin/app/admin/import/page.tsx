'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'

interface ParsedRecord {
  isbn13: string
  title: string
  publisher: string
  contributors?: unknown[]
  bisac_codes?: unknown[]
  errors?: string[]
}

interface ParseResult {
  records: ParsedRecord[]
  valid_count: number
  error_count: number
}

interface CommitResult {
  created: number
  updated: number
  failed: number
  failures: { isbn13: string; error: string }[]
}

export default function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setParseResult(null)
    setCommitResult(null)
    setParseError(null)
    setCommitError(null)
  }

  const handleParse = async () => {
    if (!file) return
    setParsing(true)
    setParseError(null)
    setParseResult(null)
    setCommitResult(null)

    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/import/parse', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) {
        setParseError(data.error ?? 'Parse failed')
      } else {
        setParseResult(data as ParseResult)
      }
    } catch (e: unknown) {
      setParseError(e instanceof Error ? e.message : 'Parse failed')
    } finally {
      setParsing(false)
    }
  }

  const handleCommit = async () => {
    if (!parseResult) return
    setCommitting(true)
    setCommitError(null)
    setCommitResult(null)

    try {
      const res = await fetch('/api/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parseResult),
      })
      const data = await res.json()
      if (!res.ok) {
        setCommitError(data.error ?? 'Import failed')
      } else {
        setCommitResult(data as CommitResult)
        setParseResult(null)
        setFile(null)
        if (fileRef.current) fileRef.current.value = ''
      }
    } catch (e: unknown) {
      setCommitError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setCommitting(false)
    }
  }

  const validRecords = parseResult?.records.filter((r) => !r.errors?.length) ?? []
  const canCommit = validRecords.length > 0 && !committing

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/titles" className="text-blue-600 hover:underline text-sm">
          &larr; Titles
        </Link>
      </div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Import Titles</h1>

      {/* File upload */}
      <div className="bg-white border border-gray-200 rounded p-4 mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Excel file (.xlsx)
        </label>
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            onChange={handleFileChange}
            className="text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:text-sm file:bg-gray-50 file:text-gray-700 hover:file:bg-gray-100"
          />
          <button
            onClick={handleParse}
            disabled={!file || parsing}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded"
          >
            {parsing ? 'Parsing...' : 'Parse & Preview'}
          </button>
        </div>
        {file && (
          <p className="text-xs text-gray-400 mt-2">
            Selected: <span className="font-medium text-gray-600">{file.name}</span> ({(file.size / 1024).toFixed(1)} KB)
          </p>
        )}
      </div>

      {/* Parse error */}
      {parseError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-4 py-3 text-sm mb-4">
          Parse error: {parseError}
        </div>
      )}

      {/* Preview table */}
      {parseResult && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-base font-semibold text-gray-800">Preview</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                <span className="text-green-700 font-medium">{parseResult.valid_count} valid</span>
                {parseResult.error_count > 0 && (
                  <>
                    {' '}
                    &bull;{' '}
                    <span className="text-red-600 font-medium">{parseResult.error_count} with errors</span>
                  </>
                )}{' '}
                &bull; {parseResult.records.length} total rows
              </p>
            </div>
            <button
              onClick={handleCommit}
              disabled={!canCommit}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded"
            >
              {committing
                ? 'Importing...'
                : `Import ${validRecords.length} title${validRecords.length !== 1 ? 's' : ''}`}
            </button>
          </div>

          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 text-gray-700 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">ISBN13</th>
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Publisher</th>
                  <th className="px-4 py-2 font-medium"># Contributors</th>
                  <th className="px-4 py-2 font-medium"># BISAC</th>
                  <th className="px-4 py-2 font-medium">Errors</th>
                </tr>
              </thead>
              <tbody>
                {parseResult.records.map((r, i) => {
                  const hasError = r.errors && r.errors.length > 0
                  const rowClass = hasError
                    ? 'bg-red-50'
                    : i % 2 === 0
                    ? 'bg-white'
                    : 'bg-gray-50'
                  return (
                    <tr key={r.isbn13 + i} className={rowClass}>
                      <td className="px-4 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">
                        {r.isbn13 || <span className="text-gray-400 italic">missing</span>}
                      </td>
                      <td className="px-4 py-2 text-gray-900 max-w-xs truncate">
                        {r.title || <span className="text-gray-400 italic">missing</span>}
                      </td>
                      <td className="px-4 py-2 text-gray-700">{r.publisher || '—'}</td>
                      <td className="px-4 py-2 text-gray-700 text-center">
                        {r.contributors?.length ?? 0}
                      </td>
                      <td className="px-4 py-2 text-gray-700 text-center">
                        {r.bisac_codes?.length ?? 0}
                      </td>
                      <td className="px-4 py-2">
                        {hasError ? (
                          <span className="text-red-600 text-xs">{r.errors!.join('; ')}</span>
                        ) : (
                          <span className="text-green-600 text-xs">OK</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Commit error */}
      {commitError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-4 py-3 text-sm mb-4">
          Import error: {commitError}
        </div>
      )}

      {/* Commit result */}
      {commitResult && (
        <div className="bg-green-50 border border-green-200 rounded px-4 py-4 mb-4">
          <h2 className="text-sm font-semibold text-green-800 mb-2">Import complete</h2>
          <div className="flex gap-6 text-sm">
            <div>
              <span className="font-medium text-green-700">{commitResult.created}</span>
              <span className="text-green-600 ml-1">created</span>
            </div>
            <div>
              <span className="font-medium text-green-700">{commitResult.updated}</span>
              <span className="text-green-600 ml-1">updated</span>
            </div>
            {commitResult.failed > 0 && (
              <div>
                <span className="font-medium text-red-600">{commitResult.failed}</span>
                <span className="text-red-500 ml-1">failed</span>
              </div>
            )}
          </div>

          {commitResult.failures.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-red-700 mb-1">Failed records:</p>
              <div className="overflow-x-auto rounded border border-red-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-red-100 text-red-700">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">ISBN13</th>
                      <th className="px-3 py-1.5 text-left font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commitResult.failures.map((f, i) => (
                      <tr key={i} className="bg-red-50">
                        <td className="px-3 py-1.5 font-mono">{f.isbn13}</td>
                        <td className="px-3 py-1.5 text-red-600">{f.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-3">
            <Link href="/admin/titles" className="text-blue-600 hover:underline text-sm">
              View all titles &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
