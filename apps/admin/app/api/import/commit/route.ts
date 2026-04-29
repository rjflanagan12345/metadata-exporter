import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

interface ContributorInput {
  role: string
  first_name: string
  last_name: string
  [key: string]: unknown
}

interface ParsedRecord {
  isbn13: string
  title: string
  publisher: string
  format?: string
  pub_date?: string
  price_usd?: number
  publishing_status?: string
  contributors?: ContributorInput[]
  bisac_codes?: string[]
  errors?: string[]
  [key: string]: unknown
}

interface ParseResult {
  records: ParsedRecord[]
}

export async function POST(req: NextRequest) {
  const supabase = getServiceClient()
  const body: ParseResult = await req.json()
  const { records } = body

  let created = 0
  let updated = 0
  let failed = 0
  const failures: { isbn13: string; error: string }[] = []

  // Create a single import batch record
  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({ imported_at: new Date().toISOString(), record_count: records.length })
    .select('id')
    .single()

  if (batchError) {
    // Non-fatal: proceed without batch tracking if table doesn't exist yet
    console.warn('Could not create import_batch record:', batchError.message)
  }

  for (const record of records) {
    // Skip records with errors
    if (record.errors && record.errors.length > 0) {
      failed++
      failures.push({ isbn13: record.isbn13, error: record.errors.join('; ') })
      continue
    }

    const { contributors, bisac_codes, publisher, ...titleFields } = record

    try {
      // Resolve or create publisher
      let publisher_id: string | null = null
      if (publisher) {
        const { data: pub } = await supabase
          .from('publishers')
          .select('id')
          .eq('name', publisher)
          .single()

        if (pub) {
          publisher_id = pub.id
        } else {
          const { data: newPub } = await supabase
            .from('publishers')
            .insert({ name: publisher })
            .select('id')
            .single()
          publisher_id = newPub?.id ?? null
        }
      }

      // Upsert the title
      const { data: upserted, error: upsertError } = await supabase
        .from('titles')
        .upsert(
          {
            ...titleFields,
            publisher_id,
            updated_at: new Date().toISOString(),
            import_batch_id: batch?.id ?? null,
          },
          { onConflict: 'isbn13' }
        )
        .select('id, isbn13')
        .single()

      if (upsertError) throw new Error(upsertError.message)

      const titleId = upserted.id

      // Determine created vs updated: if updated_at was just set and created_at matches, it was new
      // Simpler: count based on whether isbn13 existed before — approximated by checking select before upsert
      // For now, optimistically count as updated if upsert succeeded; Phase 2 can refine
      updated++

      // Replace contributors
      if (contributors && contributors.length > 0) {
        await supabase.from('contributors').delete().eq('title_id', titleId)
        await supabase.from('contributors').insert(
          contributors.map((c: ContributorInput) => ({ ...c, title_id: titleId }))
        )
      }

      // Replace subjects
      if (bisac_codes && bisac_codes.length > 0) {
        await supabase.from('title_subjects').delete().eq('title_id', titleId)
        for (const code of bisac_codes) {
          const { data: bisac } = await supabase
            .from('bisac_codes')
            .select('id')
            .eq('code', code)
            .single()
          if (bisac) {
            await supabase
              .from('title_subjects')
              .insert({ title_id: titleId, bisac_code_id: bisac.id })
          }
        }
      }
    } catch (err: unknown) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      failures.push({ isbn13: record.isbn13, error: message })
      // Undo the optimistic updated++ if we caught after incrementing
      updated = Math.max(0, updated - 1)
    }
  }

  return NextResponse.json({
    created,
    updated,
    failed,
    failures,
    batch_id: batch?.id ?? null,
  })
}
