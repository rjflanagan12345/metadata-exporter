import * as XLSX from 'xlsx'
import type { ParsedTitle, ParseResult, ParseError, ContributorRecord } from './types'

// Column header → field name mapping
// Keys must match exactly what row 3 of the template contains (trimmed)
const HEADER_MAP: Record<string, keyof ParsedTitle | string> = {
  'ISBN10': 'isbn10',
  'ISBN13': 'isbn13',
  'GTIN': 'gtin',
  'UPC': 'upc',
  'eISBN10 for Print': 'eisbn10_for_print',
  'eISBN13 for Print': 'eisbn13_for_print',
  'Title': 'title',
  'Subtitle': 'subtitle',
  'Series Name': 'series_name',
  'Series Number': 'series_number',
  'Publisher': 'publisher_name',
  'Imprint': 'imprint',
  'Copyright Year': 'copyright_year',
  'Copyright Owner': 'copyright_owner',
  'Copyright Statement': 'copyright_statement',
  'Product Format Code': 'product_format_code',
  'Product Form Detail': 'product_form_detail',
  'Edition Number': 'edition_number',
  'Edition Type Code': 'edition_type_code',
  'Contrib Name 1': 'contrib_name_1',
  'Contrib Role 1': 'contrib_role_1',
  'Contrib Bio 1': 'contrib_bio_1',
  'Contrib Name 2': 'contrib_name_2',
  'Contrib Role 2': 'contrib_role_2',
  'Contrib Bio 2': 'contrib_bio_2',
  'Contrib Name 3': 'contrib_name_3',
  'Contrib Role 3': 'contrib_role_3',
  'Contrib Bio 3': 'contrib_bio_3',
  'Contrib Name 4': 'contrib_name_4',
  'Contrib Role 4': 'contrib_role_4',
  'Contrib Bio 4': 'contrib_bio_4',
  'Contrib Name 5': 'contrib_name_5',
  'Contrib Role 5': 'contrib_role_5',
  'Contrib Bio 5': 'contrib_bio_5',
  'BISAC Code 1': 'bisac_code_1',
  'BISAC Code 2': 'bisac_code_2',
  'BISAC Code 3': 'bisac_code_3',
  'BISAC Code 4': 'bisac_code_4',
  'BISAC Code 5': 'bisac_code_5',
  'Subject Keywords': 'keywords',
  'THEMA Code': 'thema_code',
  'THEMA Description': 'thema_description',
  'Audience Code': 'audience_code',
  'Audience Age From': 'audience_age_from',
  'Audience Age To': 'audience_age_to',
  'Grade Range': 'grade_range',
  'Catalog Description': 'catalog_description',
  'Short Description': 'short_description',
  'Book Excerpt': 'book_excerpt',
  'TOC': 'toc',
  'Promo Quote 1': 'promo_quote_1',
  'Promo Quote 2': 'promo_quote_2',
  'Promo Quote 3': 'promo_quote_3',
  'Pub Date': 'pub_date',
  'On Sale Date': 'on_sale_date',
  'Ship Date': 'ship_date',
  'Height (Inches)': 'height_inches',
  'Width (Inches)': 'width_inches',
  'Spine Thickness (Inches)': 'spine_thickness_inches',
  'Weight (Ounces)': 'weight_ounces',
  'Number of Pages': 'num_pages',
  'Carton Quantity': 'carton_quantity',
  'Illustration Type': 'illustration_type',
  'Illustration Notes': 'illustration_notes',
  'Number of Illustrations': 'num_illustrations',
  'US Price (USD)': 'price_usd',
  'Cover Image URL': 'cover_image_url',
  'Publishing Status': 'publishing_status',
  'Product Availability': 'product_availability',
  'Sales Rights Type 1': 'sales_rights_type_1',
  'Rights Territory 1': 'rights_territory_1',
  'Sales Rights Type 2': 'sales_rights_type_2',
  'Rights Territory 2': 'rights_territory_2',
  'Language Code': 'language_code',
  'Replaces ISBN': 'replaces_isbn',
  'Replaced by ISBN': 'replaced_by_isbn',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function str(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const s = String(value).trim()
  return s === '' ? undefined : s
}

function num(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number') return isNaN(value) ? undefined : value
  const s = String(value).trim()
  if (s === '') return undefined
  const n = Number(s)
  return isNaN(n) ? undefined : n
}

function normalizeDate(value: unknown): string | undefined {
  if (!value) return undefined

  // YYYYMMDD as integer (e.g. 20260115)
  if (typeof value === 'number') {
    const s = String(Math.round(value))
    if (s.length === 8 && /^\d{8}$/.test(s)) {
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
    }
    // Excel date serial number — convert via XLSX
    try {
      const d = XLSX.SSF.parse_date_code(value)
      if (d) {
        return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
      }
    } catch {
      // ignore
    }
    return undefined
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
    // YYYYMMDD string
    if (/^\d{8}$/.test(trimmed)) {
      return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`
    }
  }

  return undefined
}

function validateIsbn13(isbn: string): boolean {
  return /^\d{13}$/.test(isbn) && (isbn.startsWith('978') || isbn.startsWith('979'))
}

// ── Main export ───────────────────────────────────────────────────────────────

export function parseExcelBuffer(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    return { valid: [], errors: [{ row: 0, message: 'Workbook contains no sheets' }], total_rows: 0 }
  }
  const sheet = workbook.Sheets[sheetName]

  // Convert to array-of-arrays so we can index by row/col directly
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]

  // Row index 2 (0-based) = row 3 = headers
  const headerRow = rows[2] as unknown[]
  if (!headerRow) {
    return { valid: [], errors: [{ row: 3, message: 'Header row (row 3) not found' }], total_rows: 0 }
  }

  // Build column index → field name map
  const colMap: Record<number, string> = {}
  for (let c = 0; c < headerRow.length; c++) {
    const headerVal = str(headerRow[c])
    if (headerVal && HEADER_MAP[headerVal]) {
      colMap[c] = HEADER_MAP[headerVal]
    }
  }

  const valid: ParsedTitle[] = []
  const errors: ParseError[] = []

  // Data starts at row index 4 (0-based) = row 5
  const dataRows = rows.slice(4)
  let totalRows = 0

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i] as unknown[]
    const excelRowNum = i + 5 // 1-based row number in Excel

    // Build a flat object from the column map
    const raw: Record<string, unknown> = {}
    for (const [colIdx, fieldName] of Object.entries(colMap)) {
      raw[fieldName] = row[Number(colIdx)]
    }

    // Skip completely empty rows (no ISBN13)
    const rawIsbn13 = str(raw['isbn13'])
    if (!rawIsbn13) continue

    totalRows++

    const isbn13 = rawIsbn13.replace(/[-\s]/g, '') // strip dashes/spaces before validation
    const title = str(raw['title'])
    const publisher_name = str(raw['publisher_name'])

    // Required field validation
    const rowErrors: string[] = []
    if (!validateIsbn13(isbn13)) rowErrors.push(`ISBN13 "${rawIsbn13}" is not valid (must be 13 digits starting with 978 or 979)`)
    if (!title) rowErrors.push('Title is required')
    if (!publisher_name) rowErrors.push('Publisher is required')

    if (rowErrors.length > 0) {
      for (const msg of rowErrors) {
        errors.push({ row: excelRowNum, isbn13: rawIsbn13, title: title ?? undefined, message: msg })
      }
      continue
    }

    // Build contributors
    const contributors: ContributorRecord[] = []
    for (let n = 1; n <= 5; n++) {
      const name = str(raw[`contrib_name_${n}`])
      const role = str(raw[`contrib_role_${n}`])
      if (name && role) {
        const bio = str(raw[`contrib_bio_${n}`])
        contributors.push({
          sequence_number: n,
          name,
          role_code: role,
          ...(bio ? { bio } : {}),
        })
      }
    }

    // Price validation
    const price_usd = num(raw['price_usd'])
    if (price_usd !== undefined && price_usd <= 0) {
      errors.push({ row: excelRowNum, isbn13, title, field: 'price_usd', message: `price_usd must be > 0, got ${price_usd}` })
      continue
    }

    const parsed: ParsedTitle = {
      isbn13,
      title: title!,
      publisher_name: publisher_name!,
      contributors,

      // Optional identification
      ...(str(raw['isbn10']) ? { isbn10: str(raw['isbn10']) } : {}),
      ...(str(raw['gtin']) ? { gtin: str(raw['gtin']) } : {}),
      ...(str(raw['upc']) ? { upc: str(raw['upc']) } : {}),
      ...(str(raw['eisbn10_for_print']) ? { eisbn10_for_print: str(raw['eisbn10_for_print']) } : {}),
      ...(str(raw['eisbn13_for_print']) ? { eisbn13_for_print: str(raw['eisbn13_for_print']) } : {}),

      // Optional title fields
      ...(str(raw['subtitle']) ? { subtitle: str(raw['subtitle']) } : {}),
      ...(str(raw['series_name']) ? { series_name: str(raw['series_name']) } : {}),
      ...(num(raw['series_number']) !== undefined ? { series_number: num(raw['series_number']) } : {}),

      // Optional publisher fields
      ...(str(raw['imprint']) ? { imprint: str(raw['imprint']) } : {}),
      ...(num(raw['copyright_year']) !== undefined ? { copyright_year: num(raw['copyright_year']) } : {}),
      ...(str(raw['copyright_owner']) ? { copyright_owner: str(raw['copyright_owner']) } : {}),
      ...(str(raw['copyright_statement']) ? { copyright_statement: str(raw['copyright_statement']) } : {}),

      // Optional format fields
      ...(str(raw['product_format_code']) ? { product_format_code: str(raw['product_format_code']) } : {}),
      ...(str(raw['product_form_detail']) ? { product_form_detail: str(raw['product_form_detail']) } : {}),
      ...(num(raw['edition_number']) !== undefined ? { edition_number: num(raw['edition_number']) } : {}),
      ...(str(raw['edition_type_code']) ? { edition_type_code: str(raw['edition_type_code']) } : {}),

      // Optional subject fields
      ...(str(raw['bisac_code_1']) ? { bisac_code_1: str(raw['bisac_code_1']) } : {}),
      ...(str(raw['bisac_code_2']) ? { bisac_code_2: str(raw['bisac_code_2']) } : {}),
      ...(str(raw['bisac_code_3']) ? { bisac_code_3: str(raw['bisac_code_3']) } : {}),
      ...(str(raw['bisac_code_4']) ? { bisac_code_4: str(raw['bisac_code_4']) } : {}),
      ...(str(raw['bisac_code_5']) ? { bisac_code_5: str(raw['bisac_code_5']) } : {}),
      ...(str(raw['keywords']) ? { keywords: str(raw['keywords']) } : {}),
      ...(str(raw['thema_code']) ? { thema_code: str(raw['thema_code']) } : {}),
      ...(str(raw['thema_description']) ? { thema_description: str(raw['thema_description']) } : {}),
      ...(str(raw['audience_code']) ? { audience_code: str(raw['audience_code']) } : {}),
      ...(num(raw['audience_age_from']) !== undefined ? { audience_age_from: num(raw['audience_age_from']) } : {}),
      ...(num(raw['audience_age_to']) !== undefined ? { audience_age_to: num(raw['audience_age_to']) } : {}),
      ...(str(raw['grade_range']) ? { grade_range: str(raw['grade_range']) } : {}),

      // Optional description fields
      ...(str(raw['catalog_description']) ? { catalog_description: str(raw['catalog_description']) } : {}),
      ...(str(raw['short_description']) ? { short_description: str(raw['short_description']) } : {}),
      ...(str(raw['book_excerpt']) ? { book_excerpt: str(raw['book_excerpt']) } : {}),
      ...(str(raw['toc']) ? { toc: str(raw['toc']) } : {}),
      ...(str(raw['promo_quote_1']) ? { promo_quote_1: str(raw['promo_quote_1']) } : {}),
      ...(str(raw['promo_quote_2']) ? { promo_quote_2: str(raw['promo_quote_2']) } : {}),
      ...(str(raw['promo_quote_3']) ? { promo_quote_3: str(raw['promo_quote_3']) } : {}),

      // Dates
      ...(normalizeDate(raw['pub_date']) ? { pub_date: normalizeDate(raw['pub_date']) } : {}),
      ...(normalizeDate(raw['on_sale_date']) ? { on_sale_date: normalizeDate(raw['on_sale_date']) } : {}),
      ...(normalizeDate(raw['ship_date']) ? { ship_date: normalizeDate(raw['ship_date']) } : {}),

      // Physical
      ...(num(raw['height_inches']) !== undefined ? { height_inches: num(raw['height_inches']) } : {}),
      ...(num(raw['width_inches']) !== undefined ? { width_inches: num(raw['width_inches']) } : {}),
      ...(num(raw['spine_thickness_inches']) !== undefined ? { spine_thickness_inches: num(raw['spine_thickness_inches']) } : {}),
      ...(num(raw['weight_ounces']) !== undefined ? { weight_ounces: num(raw['weight_ounces']) } : {}),
      ...(num(raw['num_pages']) !== undefined ? { num_pages: num(raw['num_pages']) } : {}),
      ...(num(raw['carton_quantity']) !== undefined ? { carton_quantity: num(raw['carton_quantity']) } : {}),
      ...(str(raw['illustration_type']) ? { illustration_type: str(raw['illustration_type']) } : {}),
      ...(str(raw['illustration_notes']) ? { illustration_notes: str(raw['illustration_notes']) } : {}),
      ...(num(raw['num_illustrations']) !== undefined ? { num_illustrations: num(raw['num_illustrations']) } : {}),

      // Pricing
      ...(price_usd !== undefined ? { price_usd } : {}),
      ...(str(raw['cover_image_url']) ? { cover_image_url: str(raw['cover_image_url']) } : {}),

      // Availability
      ...(str(raw['publishing_status']) ? { publishing_status: str(raw['publishing_status']) } : {}),
      ...(str(raw['product_availability']) ? { product_availability: str(raw['product_availability']) } : {}),

      // Rights
      ...(str(raw['sales_rights_type_1']) ? { sales_rights_type_1: str(raw['sales_rights_type_1']) } : {}),
      ...(str(raw['rights_territory_1']) ? { rights_territory_1: str(raw['rights_territory_1']) } : {}),
      ...(str(raw['sales_rights_type_2']) ? { sales_rights_type_2: str(raw['sales_rights_type_2']) } : {}),
      ...(str(raw['rights_territory_2']) ? { rights_territory_2: str(raw['rights_territory_2']) } : {}),

      // Language
      ...(str(raw['language_code']) ? { language_code: str(raw['language_code']) } : {}),

      // Related
      ...(str(raw['replaces_isbn']) ? { replaces_isbn: str(raw['replaces_isbn']) } : {}),
      ...(str(raw['replaced_by_isbn']) ? { replaced_by_isbn: str(raw['replaced_by_isbn']) } : {}),
    }

    valid.push(parsed)
  }

  return { valid, errors, total_rows: totalRows }
}
