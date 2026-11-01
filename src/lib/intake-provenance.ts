export type HrPreviewFieldProvenance = {
  sourceId: string
  field: string
  sourceUrl: string
  sourceTab: string
  sourceRow: string
  sourceFieldOrBasis: string
  sourceValueApplied: string
}

export type HrProvenanceInput = Record<string, unknown>

const requiredHeaders = [
  'sourceId',
  'field',
  'sourceUrl',
  'sourceTab',
  'sourceRow',
  'sourceFieldOrBasis',
  'sourceValueApplied',
] as const

const directColumnLabels = new Set([
  'Candidate',
  'Full Legal Name (column C)',
  'Email — Private',
  'Email',
  'Applicant ID',
  'Person ID',
  'Form Resume Link',
  'Resume or CV Upload (T)',
  'Onboarding Status',
  'Timestamp',
])

const sourceBackedFields = [
  'name',
  'email',
  'applicantId',
  'program',
  'cohort',
  'resumeUrl',
  'onboardingStatus',
] as const

export function parseHrPreviewFieldProvenance(
  matrix: string[][],
): HrPreviewFieldProvenance[] {
  const headers = matrix[0] || []
  if (
    requiredHeaders.some(
      (header) => headers.filter((value) => value === header).length !== 1,
    )
  )
    throw Error(
      'Choose the HR provenance CSV with its exact seven column headers.',
    )

  const indexes = Object.fromEntries(
    requiredHeaders.map((header) => [header, headers.indexOf(header)]),
  ) as Record<(typeof requiredHeaders)[number], number>
  const entries: HrPreviewFieldProvenance[] = []
  const unique = new Set<string>()

  for (const row of matrix.slice(1)) {
    if (row.every((value) => !value.trim())) continue
    const entry = Object.fromEntries(
      requiredHeaders.map((header) => [
        header,
        row[indexes[header]]?.trim() || '',
      ]),
    ) as HrPreviewFieldProvenance
    const url = (() => {
      try {
        return new URL(entry.sourceUrl)
      } catch {
        return null
      }
    })()
    if (
      !entry.sourceId ||
      entry.sourceId !== entry.sourceId.trim() ||
      !entry.field ||
      entry.field !== entry.field.trim() ||
      !url ||
      url.protocol !== 'https:' ||
      !entry.sourceTab ||
      !entry.sourceRow ||
      !entry.sourceFieldOrBasis ||
      !entry.sourceValueApplied
    )
      throw Error(
        'Each HR provenance row needs an exact source, field, location, basis and applied value.',
      )
    const key = `${entry.sourceId}\0${entry.field}`
    if (unique.has(key))
      throw Error('The HR provenance CSV repeats a sourceId and field pair.')
    unique.add(key)
    entries.push(entry)
  }
  if (!entries.length) throw Error('The HR provenance CSV has no field rows.')
  return entries
}

function comparableValue(field: string, value: unknown) {
  const text = String(value ?? '').trim()
  return field === 'email' ? text.toLowerCase() : text
}

export function attachHrPreviewFieldProvenance<T extends HrProvenanceInput>(
  rows: T[],
  entries: HrPreviewFieldProvenance[],
): (T & { hrFieldProvenance: Record<string, HrPreviewFieldProvenance> })[] {
  const rowsById = new Map<string, T>()
  for (const row of rows) {
    const sourceId = typeof row.sourceId === 'string' ? row.sourceId : ''
    if (!sourceId || sourceId !== sourceId.trim() || rowsById.has(sourceId))
      throw Error(
        'Every HR row needs one exact, unique sourceId for provenance matching.',
      )
    rowsById.set(sourceId, row)
  }

  const bySource = new Map<string, Record<string, HrPreviewFieldProvenance>>()
  for (const entry of entries) {
    const row = rowsById.get(entry.sourceId)
    if (!row)
      throw Error(
        'The HR provenance CSV contains a sourceId outside the uploaded batch.',
      )
    const fields = bySource.get(entry.sourceId) || {}
    if (fields[entry.field])
      throw Error('The HR provenance CSV repeats a sourceId and field pair.')
    if (
      Object.hasOwn(row, entry.field) &&
      comparableValue(entry.field, row[entry.field]) !==
        comparableValue(entry.field, entry.sourceValueApplied)
    )
      throw Error(
        `The HR provenance value for ${entry.field} does not match the uploaded value.`,
      )
    fields[entry.field] = entry
    bySource.set(entry.sourceId, fields)
  }

  for (const [sourceId, row] of rowsById) {
    const fields = bySource.get(sourceId) || {}
    for (const field of sourceBackedFields) {
      if (String(row[field] ?? '').trim() && !fields[field])
        throw Error(
          `The HR provenance CSV is missing ${field} for an uploaded sourceId.`,
        )
    }
  }

  return rows.map((row) => ({
    ...row,
    hrFieldProvenance: Object.fromEntries(
      Object.entries(
        bySource.get(typeof row.sourceId === 'string' ? row.sourceId : '') ||
          {},
      )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([field, entry]) => [
          field,
          Object.hasOwn(row, field)
            ? {
                ...entry,
                sourceValueApplied: comparableValue(field, row[field]),
              }
            : entry,
        ]),
    ),
  }))
}

export function isDirectHrSourceColumn(label: string) {
  return directColumnLabels.has(label)
}
