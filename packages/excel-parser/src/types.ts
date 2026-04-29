export interface ContributorRecord {
  sequence_number: number
  name: string
  role_code: string
  bio?: string
}

export interface ParsedTitle {
  // Identification
  isbn13: string
  isbn10?: string
  gtin?: string
  upc?: string
  eisbn10_for_print?: string
  eisbn13_for_print?: string
  // Title
  title: string
  subtitle?: string
  series_name?: string
  series_number?: number
  // Publisher
  publisher_name: string // resolves to publisher_id on upsert
  imprint?: string
  copyright_year?: number
  copyright_owner?: string
  copyright_statement?: string
  // Format
  product_format_code?: string
  product_form_detail?: string
  edition_number?: number
  edition_type_code?: string
  // Contributors (separate table)
  contributors: ContributorRecord[]
  // Subject
  bisac_code_1?: string
  bisac_code_2?: string
  bisac_code_3?: string
  bisac_code_4?: string
  bisac_code_5?: string
  keywords?: string
  thema_code?: string
  thema_description?: string
  audience_code?: string
  audience_age_from?: number
  audience_age_to?: number
  grade_range?: string
  // Descriptions
  catalog_description?: string
  short_description?: string
  book_excerpt?: string
  toc?: string
  promo_quote_1?: string
  promo_quote_2?: string
  promo_quote_3?: string
  // Dates (stored as YYYY-MM-DD strings)
  pub_date?: string
  on_sale_date?: string
  ship_date?: string
  // Physical
  height_inches?: number
  width_inches?: number
  spine_thickness_inches?: number
  weight_ounces?: number
  num_pages?: number
  carton_quantity?: number
  illustration_type?: string
  illustration_notes?: string
  num_illustrations?: number
  // Pricing
  price_usd?: number
  cover_image_url?: string
  // Availability
  publishing_status?: string
  product_availability?: string
  // Rights
  sales_rights_type_1?: string
  rights_territory_1?: string
  sales_rights_type_2?: string
  rights_territory_2?: string
  // Language
  language_code?: string
  // Related
  replaces_isbn?: string
  replaced_by_isbn?: string
}

export interface ParseError {
  row: number
  isbn13?: string
  title?: string
  field?: string
  message: string
}

export interface ParseResult {
  valid: ParsedTitle[]
  errors: ParseError[]
  total_rows: number
}
