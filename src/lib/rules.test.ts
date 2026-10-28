import { describe, it, expect } from 'vitest'
import {
  discoveryResult,
  businessDeadline,
  csvCell,
  normalize,
  calendarDefault,
} from './rules'
describe('workbook discovery precedence', () => {
  it('routes regulated core needs before a package mismatch', () =>
    expect(
      discoveryResult(['Not met', 'Met', 'Unclear', 'Not met', 'Met']),
    ).toBe('H1'))
  it('routes package mismatch before unclear criteria', () =>
    expect(discoveryResult(['Not met', 'Unclear', 'Met', 'Met', 'Met'])).toBe(
      'X1',
    ))
  it('qualifies only all five met', () =>
    expect(discoveryResult(Array(5).fill('Met'))).toBe('S5'))
  it('routes uncertainty to founder review', () =>
    expect(discoveryResult(['Met', 'Met', 'Unclear', 'Met', 'Met'])).toBe('H2'))
  it('retains a concrete unfulfilled gap', () =>
    expect(discoveryResult(['Met', 'Not met', 'Met', 'Met', 'Met'])).toBe(
      'Incomplete',
    ))
})
describe('business-calendar targets', () => {
  it('skips a weekend at the same New York clock time', () =>
    expect(businessDeadline('2026-10-23T14:00:00Z')).toBe(
      '2026-10-26T14:00:00.000Z',
    ))
  it('preserves the local clock across DST', () =>
    expect(businessDeadline('2026-10-30T14:00:00Z')).toBe(
      '2026-11-02T15:00:00.000Z',
    ))
  it('skips configured holidays', () =>
    expect(
      businessDeadline('2026-10-23T14:00:00Z', {
        ...calendarDefault,
        holidays: ['2026-10-26'],
      }),
    ).toBe('2026-10-27T14:00:00.000Z'))
})
describe('matching and safe CSV cells', () => {
  it('normalizes official domains including source paths', () =>
    expect(normalize('https://WWW.Emerson.example/about')).toBe(
      'emerson.example',
    ))
  it('normalizes telephone formatting', () =>
    expect(normalize('+1 (212) 555-0123')).toBe('12125550123'))
  it('neutralizes formulas and escapes quotes', () =>
    expect(csvCell(' =HYPERLINK("x")')).toBe('"\' =HYPERLINK(""x"")"'))
})
