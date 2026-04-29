import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('titles')
    .select(`
      *,
      publishers ( id, name ),
      contributors ( * ),
      title_subjects ( *, bisac_codes ( code, description ) )
    `)
    .eq('id', id)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }

  return NextResponse.json(data)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = getServiceClient()
  const body = await req.json()

  // Strip read-only fields
  const { isbn13: _isbn13, id: _id, created_at: _ca, contributors: _con, title_subjects: _ts, publishers: _pub, ...fields } = body

  const { data, error } = await supabase
    .from('titles')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(`
      *,
      publishers ( id, name ),
      contributors ( * ),
      title_subjects ( *, bisac_codes ( code, description ) )
    `)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json(data)
}
