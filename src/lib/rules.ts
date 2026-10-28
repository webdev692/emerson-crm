export const stages: Record<string, string> = {
  S1: 'New Inquiry',
  S2: 'Acknowledged',
  S3: 'Discovery Booked',
  S4: 'Discovery Held',
  S5: 'Qualified',
  S6: 'Founder Review',
  S7: 'Proposal Sent',
  S8: 'Work Order Issued',
  S9: 'Handed Off (Won)',
  H1: 'HOLD: Regulated (TEA)',
  H2: 'HOLD: Needs Lyric Review',
  H3: 'HOLD: Capacity',
  X1: 'Closed: Not a Fit',
  X2: 'Closed: Declined',
  X3: 'Closed: No Response',
  X4: 'No-Contact',
}
export const kinds = [
  'organization',
  'contact',
  'research',
  'opportunity',
  'activity',
  'task',
  'discovery',
  'offer',
  'proposal',
  'approval',
  'quote',
  'ownership',
  'suppression',
  'workorder',
  'handoff',
] as const
export const roles = ['owner', 'manager', 'contributor', 'delivery', 'viewer']
export const calendarDefault = {
  timezone: 'America/New_York',
  workingDays: [1, 2, 3, 4, 5],
  holidays: [] as string[],
  clock: 'same-local-time',
  holdsPause: false,
}
export function discoveryResult(c: string[]) {
  if (
    c.length !== 5 ||
    c.some((v) => !['Met', 'Not met', 'Unclear'].includes(v))
  )
    return 'Incomplete'
  if (c[3] === 'Not met') return 'H1'
  if (c[0] === 'Not met') return 'X1'
  if (c.every((v) => v === 'Met')) return 'S5'
  if (c.includes('Unclear')) return 'H2'
  return 'Incomplete'
}
export function businessDeadline(iso: string, calendar = calendarDefault) {
  // Advance civil days in the configured timezone; preserve local clock across DST.
  const parts = (d: Date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: calendar.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(d)
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value]),
    )
  const p = parts(new Date(iso))
  const civil = new Date(
    Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second),
  )
  do {
    civil.setUTCDate(civil.getUTCDate() + 1)
  } while (
    !calendar.workingDays.includes(civil.getUTCDay()) ||
    calendar.holidays.includes(civil.toISOString().slice(0, 10))
  )
  let out = new Date(civil)
  for (let i = 0; i < 3; i++) {
    const q = parts(out)
    const local = Date.UTC(
      +q.year,
      +q.month - 1,
      +q.day,
      +q.hour,
      +q.minute,
      +q.second,
    )
    out = new Date(out.getTime() + civil.getTime() - local)
  }
  return out.toISOString()
}
export function normalize(value: string = '') {
  const v = value.trim().toLowerCase()
  if (/^https?:\/\//.test(v)) {
    try {
      return new URL(v).hostname.replace(/^www\./, '')
    } catch {
      return v
    }
  }
  if (/^[+()\d\s.-]+$/.test(v)) return v.replace(/\D/g, '')
  return v.replace(/^www\./, '').replace(/\/$/, '')
}
export function csvCell(value: unknown) {
  let s =
    typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}
export const draftOffers = [
  [
    'TEE',
    'Private group workshops',
    '$150–$500, depending on length and group size',
  ],
  [
    'TEA',
    'Individual tax-return services',
    '$75–$125 simple; $125–$175 with dependents; $175–$250 multiple income sources',
  ],
  ['TEA', 'State-return add-ons', '$25–$50 per state'],
  ['TEA', 'Monthly business support', '$300–$750 per month'],
  ['EPDG', 'Résumé services', '$50–$150 by level; executive $200+'],
  ['EPDG', 'Monthly coaching', '$150–$300 per month'],
  ['Project Studio', 'Business Starter Kit', 'Pending founder decision D3'],
  ['Project Studio', 'Operations Setup', 'Pending founder decision D3'],
]
