'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Image from 'next/image'

interface Contributor {
  id: string
  role: string
  first_name: string
  last_name: string
  sequence: number | null
}

interface TitleSubject {
  id: string
  bisac_codes: { code: string; description: string } | null
}

interface Title {
  id: string
  isbn13: string
  title: string
  subtitle: string | null
  publisher_id: string | null
  publishers: { id: string; name: string } | null
  format: string | null
  pub_date: string | null
  price_usd: number | null
  publishing_status: string | null
  updated_at: string | null
  created_at: string | null
  cover_image_url: string | null

  // Identification
  isbn10: string | null
  ean: string | null
  upc: string | null
  product_id_type: string | null

  // Title
  title_prefix: string | null
  collection_title: string | null
  collection_sequence: string | null

  // Format
  product_composition: string | null
  product_form_detail: string | null
  edition_number: string | null
  edition_statement: string | null
  number_of_pages: number | null
  illustrations_note: string | null

  // Descriptions
  description_short: string | null
  description_long: string | null
  review_quote: string | null
  biographical_note: string | null
  table_of_contents: string | null

  // Physical
  weight_lbs: number | null
  height_in: number | null
  width_in: number | null
  thickness_in: number | null

  // Pricing
  price_cad: number | null
  price_gbp: number | null
  price_eur: number | null

  // Availability
  availability_code: string | null
  on_sale_date: string | null
  out_of_print_date: string | null
  supplier_name: string | null

  // Rights
  sales_rights: string | null
  rights_territory: string | null

  // Language
  language_code: string | null
  original_language: string | null

  // Related
  series_title: string | null
  series_number: string | null
  related_isbn: string | null

  contributors: Contributor[]
  title_subjects: TitleSubject[]
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200 pb-1 mt-6 mb-3">
      {title}
    </h2>
  )
}

function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
  readOnly = false,
  textarea = false,
}: {
  label: string
  name: string
  value: string | number | null | undefined
  onChange: (name: string, val: string) => void
  type?: string
  readOnly?: boolean
  textarea?: boolean
}) {
  const displayVal = value === null || value === undefined ? '' : String(value)
  const baseClass =
    'mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
  const roClass = 'bg-gray-50 text-gray-600 cursor-not-allowed'
  const editClass = 'bg-white text-gray-900'

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600">{label}</label>
      {textarea ? (
        <textarea
          name={name}
          value={displayVal}
          onChange={(e) => onChange(name, e.target.value)}
          readOnly={readOnly}
          rows={3}
          className={`${baseClass} ${readOnly ? roClass : editClass}`}
        />
      ) : (
        <input
          type={type}
          name={name}
          value={displayVal}
          onChange={(e) => onChange(name, e.target.value)}
          readOnly={readOnly}
          className={`${baseClass} ${readOnly ? roClass : editClass}`}
        />
      )}
    </div>
  )
}

function twoCol(children: React.ReactNode) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
}
function threeCol(children: React.ReactNode) {
  return <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{children}</div>
}
function fourCol(children: React.ReactNode) {
  return <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">{children}</div>
}

export default function TitleDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [title, setTitle] = useState<Title | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [form, setForm] = useState<Partial<Title>>({})

  useEffect(() => {
    fetch(`/api/titles/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setLoadError(data.error)
        } else {
          setTitle(data)
          setForm(data)
        }
        setLoading(false)
      })
      .catch((e) => {
        setLoadError(e.message)
        setLoading(false)
      })
  }, [id])

  const handleChange = useCallback((name: string, val: string) => {
    setForm((prev) => ({ ...prev, [name]: val === '' ? null : val }))
    setSaveSuccess(false)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      const res = await fetch(`/api/titles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveError(data.error ?? 'Save failed')
      } else {
        setTitle(data)
        setForm(data)
        setSaveSuccess(true)
      }
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-gray-500 text-sm">Loading...</p>
  if (loadError)
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded px-4 py-3 text-sm">
        Error: {loadError}
      </div>
    )
  if (!title) return null

  const f = (name: keyof Title, label: string, opts?: { type?: string; readOnly?: boolean; textarea?: boolean }) => (
    <Field
      label={label}
      name={name}
      value={form[name] as string | number | null | undefined}
      onChange={handleChange}
      type={opts?.type}
      readOnly={opts?.readOnly}
      textarea={opts?.textarea}
    />
  )

  const contributors = title.contributors ?? []
  const subjects = title.title_subjects ?? []

  return (
    <div className="max-w-4xl">
      {/* Back + header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/admin/titles" className="text-blue-600 hover:underline text-sm">
          &larr; Titles
        </Link>
      </div>

      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{title.title || 'Untitled'}</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Last updated: {title.updated_at ? new Date(title.updated_at).toLocaleString() : '—'}
          </p>
        </div>
        {title.cover_image_url && (
          <Image
            src={title.cover_image_url}
            alt="Cover"
            width={64}
            height={96}
            className="object-cover rounded border border-gray-200 shadow-sm"
          />
        )}
      </div>

      {/* Save feedback */}
      {saveError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-4 py-2 text-sm mb-4">
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded px-4 py-2 text-sm mb-4">
          Saved successfully.
        </div>
      )}

      {/* ── IDENTIFICATION ── */}
      <SectionHeader title="Identification" />
      {threeCol(<>
        {f('isbn13', 'ISBN13 (read-only)', { readOnly: true })}
        {f('isbn10', 'ISBN10')}
        {f('ean', 'EAN')}
      </>)}
      {twoCol(<>
        {f('upc', 'UPC')}
        {f('product_id_type', 'Product ID Type')}
      </>)}

      {/* ── TITLE ── */}
      <SectionHeader title="Title" />
      {twoCol(<>
        {f('title', 'Title')}
        {f('subtitle', 'Subtitle')}
      </>)}
      {threeCol(<>
        {f('title_prefix', 'Title Prefix')}
        {f('collection_title', 'Collection Title')}
        {f('collection_sequence', 'Collection Sequence')}
      </>)}

      {/* ── PUBLISHER ── */}
      <SectionHeader title="Publisher" />
      {twoCol(<>
        {f('publisher_id', 'Publisher ID')}
        <div>
          <label className="block text-xs font-medium text-gray-600">Publisher Name (resolved)</label>
          <input
            type="text"
            readOnly
            value={title.publishers?.name ?? '—'}
            className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm bg-gray-50 text-gray-600 cursor-not-allowed"
          />
        </div>
      </>)}

      {/* ── FORMAT ── */}
      <SectionHeader title="Format" />
      {fourCol(<>
        {f('format', 'Format')}
        {f('product_composition', 'Product Composition')}
        {f('product_form_detail', 'Product Form Detail')}
        {f('edition_number', 'Edition Number')}
      </>)}
      {twoCol(<>
        {f('edition_statement', 'Edition Statement')}
        {f('number_of_pages', 'Number of Pages', { type: 'number' })}
      </>)}
      {f('illustrations_note', 'Illustrations Note')}

      {/* ── CONTRIBUTORS ── */}
      <SectionHeader title="Contributors" />
      {contributors.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No contributors. Full editing in Phase 2.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 text-gray-700 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Seq</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">First Name</th>
                <th className="px-3 py-2 font-medium">Last Name</th>
              </tr>
            </thead>
            <tbody>
              {contributors.map((c, i) => (
                <tr key={c.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-1.5 text-gray-500">{c.sequence ?? i + 1}</td>
                  <td className="px-3 py-1.5">{c.role}</td>
                  <td className="px-3 py-1.5">{c.first_name}</td>
                  <td className="px-3 py-1.5">{c.last_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-400 mt-1">Full contributor editing coming in Phase 2.</p>

      {/* ── SUBJECT ── */}
      <SectionHeader title="Subject (BISAC)" />
      {subjects.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No BISAC codes assigned.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {subjects.map((s) =>
            s.bisac_codes ? (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 text-xs px-2 py-1 rounded"
              >
                <span className="font-mono">{s.bisac_codes.code}</span>
                <span className="text-blue-600">{s.bisac_codes.description}</span>
              </span>
            ) : null
          )}
        </div>
      )}
      <p className="text-xs text-gray-400 mt-1">Full subject editing coming in Phase 2.</p>

      {/* ── DESCRIPTIONS ── */}
      <SectionHeader title="Descriptions" />
      {f('description_short', 'Short Description', { textarea: true })}
      {f('description_long', 'Long Description', { textarea: true })}
      {f('review_quote', 'Review Quote', { textarea: true })}
      {f('biographical_note', 'Biographical Note', { textarea: true })}
      {f('table_of_contents', 'Table of Contents', { textarea: true })}

      {/* ── DATES ── */}
      <SectionHeader title="Dates" />
      {threeCol(<>
        {f('pub_date', 'Publication Date', { type: 'date' })}
        {f('on_sale_date', 'On-Sale Date', { type: 'date' })}
        {f('out_of_print_date', 'Out of Print Date', { type: 'date' })}
      </>)}

      {/* ── PHYSICAL ── */}
      <SectionHeader title="Physical" />
      {fourCol(<>
        {f('weight_lbs', 'Weight (lbs)', { type: 'number' })}
        {f('height_in', 'Height (in)', { type: 'number' })}
        {f('width_in', 'Width (in)', { type: 'number' })}
        {f('thickness_in', 'Thickness (in)', { type: 'number' })}
      </>)}

      {/* ── PRICING ── */}
      <SectionHeader title="Pricing" />
      {fourCol(<>
        {f('price_usd', 'Price USD', { type: 'number' })}
        {f('price_cad', 'Price CAD', { type: 'number' })}
        {f('price_gbp', 'Price GBP', { type: 'number' })}
        {f('price_eur', 'Price EUR', { type: 'number' })}
      </>)}

      {/* ── AVAILABILITY ── */}
      <SectionHeader title="Availability" />
      {threeCol(<>
        {f('publishing_status', 'Publishing Status')}
        {f('availability_code', 'Availability Code')}
        {f('supplier_name', 'Supplier Name')}
      </>)}

      {/* ── RIGHTS ── */}
      <SectionHeader title="Rights" />
      {twoCol(<>
        {f('sales_rights', 'Sales Rights')}
        {f('rights_territory', 'Rights Territory')}
      </>)}

      {/* ── LANGUAGE ── */}
      <SectionHeader title="Language" />
      {twoCol(<>
        {f('language_code', 'Language Code')}
        {f('original_language', 'Original Language')}
      </>)}

      {/* ── COVER ── */}
      <SectionHeader title="Cover" />
      {f('cover_image_url', 'Cover Image URL')}
      {form.cover_image_url && (
        <div className="mt-2">
          <Image
            src={form.cover_image_url as string}
            alt="Cover preview"
            width={80}
            height={120}
            className="object-cover rounded border border-gray-200"
          />
        </div>
      )}

      {/* ── RELATED ── */}
      <SectionHeader title="Related" />
      {threeCol(<>
        {f('series_title', 'Series Title')}
        {f('series_number', 'Series Number')}
        {f('related_isbn', 'Related ISBN')}
      </>)}

      {/* Save button */}
      <div className="mt-8 flex items-center gap-4 pb-12">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm px-6 py-2 rounded"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <Link href="/admin/titles" className="text-sm text-gray-500 hover:underline">
          Cancel
        </Link>
      </div>
    </div>
  )
}
