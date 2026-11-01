import { describe, expect, it } from 'vitest'
import {
  attachHrPreviewFieldProvenance,
  isDirectHrSourceColumn,
  parseHrPreviewFieldProvenance,
} from './intake-provenance'

const headers = [
  'sourceId',
  'field',
  'sourceUrl',
  'sourceTab',
  'sourceRow',
  'sourceFieldOrBasis',
  'sourceValueApplied',
]

const matrix = [
  headers,
  [
    'fictional-app-001',
    'name',
    'https://docs.google.com/spreadsheets/d/fictional-source/edit',
    'Fictional Applicants',
    '42',
    'Candidate',
    'Rhea Sample',
  ],
  [
    'fictional-app-001',
    'email',
    'https://docs.google.com/spreadsheets/d/fictional-source/edit',
    'Fictional Applicants',
    '42',
    'Email',
    'rhea@example.invalid',
  ],
  [
    'fictional-app-001',
    'cohort',
    'https://docs.google.com/spreadsheets/d/fictional-source/edit',
    'Fall Applicants',
    '42',
    'Fall Applicants tab / term',
    'Fictional Fall 2026',
  ],
]

describe('HR preview provenance', () => {
  it('joins by exact sourceId and field and separates direct columns from derived basis', () => {
    const sidecar = parseHrPreviewFieldProvenance(matrix)
    const rows = attachHrPreviewFieldProvenance(
      [
        {
          sourceId: 'fictional-app-001',
          name: 'Rhea Sample',
          email: 'rhea@example.invalid',
          cohort: 'Fictional Fall 2026',
        },
      ],
      sidecar,
    )

    expect(rows[0].hrFieldProvenance.name).toMatchObject({
      sourceId: 'fictional-app-001',
      sourceUrl: 'https://docs.google.com/spreadsheets/d/fictional-source/edit',
      sourceTab: 'Fictional Applicants',
      sourceRow: '42',
      sourceFieldOrBasis: 'Candidate',
      sourceValueApplied: 'Rhea Sample',
    })
    expect(isDirectHrSourceColumn('Candidate')).toBe(true)
    expect(isDirectHrSourceColumn('Fall Applicants tab / term')).toBe(false)
  })

  it('rejects duplicate, unmatched and value-mismatched provenance rows', () => {
    expect(() =>
      parseHrPreviewFieldProvenance([
        headers,
        ...matrix.slice(1, 2),
        ...matrix.slice(1, 2),
      ]),
    ).toThrow(/repeats a sourceId and field pair/i)
    expect(() =>
      attachHrPreviewFieldProvenance(
        [
          {
            sourceId: 'fictional-app-001',
            name: 'Other Name',
            email: 'rhea@example.invalid',
          },
        ],
        parseHrPreviewFieldProvenance(matrix),
      ),
    ).toThrow(/does not match the uploaded value/i)
    expect(() =>
      attachHrPreviewFieldProvenance(
        [
          {
            sourceId: 'fictional-app-002',
            name: 'Rhea Sample',
            email: 'rhea@example.invalid',
          },
        ],
        parseHrPreviewFieldProvenance(matrix),
      ),
    ).toThrow(/outside the uploaded batch/i)
  })
})
