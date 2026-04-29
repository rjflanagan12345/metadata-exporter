import { NextRequest, NextResponse } from 'next/server'

// TODO Phase 2: replace stub with real parser once @apg/excel-parser is installed
// import { parseExcelBuffer } from '@apg/excel-parser'

export async function POST(_req: NextRequest) {
  // Stub: returns 2 sample parsed records so the UI works end-to-end
  // Real implementation: read multipart form, extract .xlsx file, call parseExcelBuffer()
  const mockResult = {
    records: [
      {
        isbn13: '9781234567890',
        title: 'The Example Book',
        publisher: 'Example Press',
        format: 'Hardcover',
        pub_date: '2024-06-01',
        price_usd: 24.99,
        publishing_status: 'Active',
        contributors: [
          { role: 'Author', first_name: 'Jane', last_name: 'Smith' },
        ],
        bisac_codes: ['FIC000000', 'FIC014000'],
        errors: [],
      },
      {
        isbn13: '9780000000000',
        title: '',
        publisher: 'Example Press',
        format: 'Paperback',
        pub_date: '2024-01-15',
        price_usd: 14.99,
        publishing_status: 'Active',
        contributors: [],
        bisac_codes: ['NON000000'],
        errors: ['Title is required'],
      },
    ],
    valid_count: 1,
    error_count: 1,
  }

  return NextResponse.json(mockResult)
}
