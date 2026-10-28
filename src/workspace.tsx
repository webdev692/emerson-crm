import { useState, useEffect, useRef, useCallback } from 'react'
import {
  login,
  logout,
  getUser,
  handleAuthCallback,
  acceptInvite,
  requestPasswordRecovery,
  updateUser,
} from '@netlify/identity'
import {
  LayoutDashboard,
  Search,
  ArrowUpRight,
  ArrowRight,
  Plus,
  ChevronRight,
  PanelLeftClose,
  FlaskConical,
  BriefcaseBusiness,
  Columns3,
  ListChecks,
  Layers3,
  ShieldCheck,
  PackageCheck,
  Ban,
  Settings2,
  LogOut,
  Download,
  Upload,
  X,
  Check,
  Clock3,
  LockKeyhole,
  Users,
  FileText,
  RefreshCw,
  ChevronDown,
} from 'lucide-react'
import {
  stages,
  discoveryResult,
  draftOffers,
  calendarDefault,
  normalize,
} from './lib/rules'
import { RecordSelector } from './components/record-selector'
import { FoundationWorkspace } from './components/foundation-workspace'
import { fields, labels } from './lib/fields'
import type { RecordData } from './lib/crm-types'
import type { FoundationMember } from './lib/foundation'
type Rec = {
  id: string
  kind: string
  title: string
  ownerId: string | null
  parentId?: string | null
  organizationId?: string | null
  revision: number
  createdAt: string
  updatedAt: string
  data: RecordData
  sourceKey?: string | null
  access?: string
}
type Api = (body?: object) => Promise<unknown>
type AuditEntry = {
  id: string
  action: string
  actorId: string
  createdAt: string
  after: unknown
}
type AuthMode = 'login' | 'recover' | 'reset' | 'invite'
type SharedProps = {
  records: Rec[]
  member: FoundationMember | null
  staff: FoundationMember[]
  api: Api
  reload: () => Promise<void>
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isMember = (value: unknown): value is FoundationMember =>
  isObject(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.role === 'string' &&
  typeof value.active === 'boolean' &&
  (value.email === undefined || typeof value.email === 'string') &&
  (value.hr === undefined || typeof value.hr === 'boolean') &&
  (value.commercial === undefined || typeof value.commercial === 'boolean')
const isRecord = (value: unknown): value is Rec =>
  isObject(value) &&
  typeof value.id === 'string' &&
  typeof value.kind === 'string' &&
  typeof value.title === 'string' &&
  typeof value.revision === 'number' &&
  typeof value.createdAt === 'string' &&
  typeof value.updatedAt === 'string' &&
  (value.ownerId === null || typeof value.ownerId === 'string') &&
  (value.parentId === undefined ||
    value.parentId === null ||
    typeof value.parentId === 'string') &&
  (value.organizationId === undefined ||
    value.organizationId === null ||
    typeof value.organizationId === 'string') &&
  isObject(value.data)
const isCalendar = (value: unknown): value is typeof calendarDefault =>
  isObject(value) &&
  typeof value.timezone === 'string' &&
  Array.isArray(value.workingDays) &&
  value.workingDays.every((day) => typeof day === 'number') &&
  Array.isArray(value.holidays) &&
  value.holidays.every((day) => typeof day === 'string') &&
  typeof value.clock === 'string' &&
  typeof value.holdsPause === 'boolean'
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'The request could not be completed.'
const errorStatus = (error: unknown) =>
  isObject(error) && typeof error.status === 'number' ? error.status : undefined
const api: Api = async (body) => {
  const res = await fetch(
    '/api/crm',
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : { cache: 'no-store' },
  )
  const json: unknown = await res.json()
  if (!res.ok)
    throw Object.assign(
      Error(
        isObject(json) && typeof json.error === 'string'
          ? json.error
          : 'Request failed',
      ),
      { status: res.status },
    )
  return json
}
const nav = [
  ['Dashboard', LayoutDashboard],
  ['Directory', Users],
  ['Workflows', Columns3],
  ['Import review', Upload],
  ['Library', FileText],
  ['Research', FlaskConical],
  ['Opportunities', BriefcaseBusiness],
  ['Pipeline', Columns3],
  ['Tasks', ListChecks],
  ['Offers', Layers3],
  ['Approvals', ShieldCheck],
  ['Delivery handoffs', PackageCheck],
  ['No-contact', Ban],
  ['Settings', Settings2],
] as const
const pageKinds: Record<string, string[]> = {
  Research: ['research'],
  Opportunities: ['opportunity'],
  Tasks: ['task'],
  Offers: ['offer', 'proposal', 'quote'],
  Approvals: ['approval'],
  'Delivery handoffs': ['workorder', 'handoff'],
  'No-contact': ['suppression'],
}
const descriptions: Record<string, string> = {
  Directory:
    'One place for people, organizations, and their connected relationships.',
  Workflows:
    'Services, classes, partnerships, and applications each have a clear path.',
  'Import review':
    'Review source records, resolve conflicts, and apply deliberate decisions.',
  Library:
    'Approved resources and learning paths, with their source and version intact.',
  Research: 'Find the right fit. Keep the evidence. Request outreach approval.',
  Opportunities: 'Every relationship has an owner and a clear next step.',
  Pipeline: 'From first inquiry to an accepted delivery handoff.',
  Tasks: 'The next action, in the right hands.',
  Offers:
    'Versioned scope and terms. Founder-approved before they reach a client.',
  Approvals:
    'Separate decisions for catalogue, client proposals, and outreach.',
  'Delivery handoffs':
    'Written acceptance, confirmed capacity, and a delivery lead ready to begin.',
  'No-contact':
    'A lasting record of contact restrictions, across every opportunity.',
  Settings: 'People, responsibilities, and the way your workspace operates.',
}
const formatDate = (d?: string) =>
  d
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
      }).format(new Date(d))
    : '—'
export function Workspace() {
  const [page, setPage] = useState('Dashboard'),
    [records, setRecords] = useState<Rec[]>([]),
    [member, setMember] = useState<FoundationMember | null>(null),
    [syntheticEducation, setSyntheticEducation] = useState(false),
    [syntheticWebsiteIntake, setSyntheticWebsiteIntake] = useState(false),
    [staff, setStaff] = useState<FoundationMember[]>([]),
    [signed, setSigned] = useState(false),
    [loading, setLoading] = useState(true),
    [access, setAccess] = useState<
      'checking' | 'signed-out' | 'membership' | 'loading' | 'ready' | 'error'
    >('checking'),
    [notice, setNotice] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('All records'),
    [modal, setModal] = useState<string | null>(null),
    [selected, setSelected] = useState<Rec | null>(null),
    [calendar, setCalendar] = useState(calendarDefault),
    [authMode, setAuthMode] = useState<AuthMode>('login'),
    [invite, setInvite] = useState(''),
    [mobile, setMobile] = useState(false)
  const loadSequence = useRef(0)
  const navigationToggle = useRef<HTMLButtonElement>(null)
  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setAccess((current) =>
      current === 'ready' || current === 'loading' ? 'loading' : 'checking',
    )
    setRecords([])
    setSyntheticEducation(false)
    setSyntheticWebsiteIntake(false)
    setStaff([])
    setSelected(null)
    setModal((current) =>
      current === 'auth' || current === 'import' ? current : null,
    )
    try {
      const u = await getUser()
      if (sequence !== loadSequence.current) return
      setSigned(!!u)
      if (u) {
        setAccess((current) =>
          current === 'ready' || current === 'loading' ? 'loading' : 'checking',
        )
        const d = await api()
        if (
          !isObject(d) ||
          !isMember(d.member) ||
          !Array.isArray(d.records) ||
          !d.records.every(isRecord) ||
          !Array.isArray(d.staff) ||
          !d.staff.every(isMember) ||
          !Array.isArray(d.settings)
        )
          throw Error(
            'The workspace response was incomplete. Refresh to try again.',
          )
        if (sequence !== loadSequence.current) return
        setAccess('ready')
        setMember(d.member)
        setSyntheticEducation(d.syntheticEducation === true)
        setSyntheticWebsiteIntake(d.syntheticWebsiteIntake === true)
        setRecords(d.records)
        setStaff(d.staff)
        const calendarSetting = d.settings.find(
          (s) => isObject(s) && s.key === 'calendar',
        )
        setCalendar(
          isObject(calendarSetting) && isCalendar(calendarSetting.data)
            ? calendarSetting.data
            : calendarDefault,
        )
      } else {
        setAccess('signed-out')
        setMember(null)
        setRecords([])
        setModal((current) => (current === 'auth' ? current : null))
        setCalendar(calendarDefault)
      }
    } catch (e) {
      if (sequence !== loadSequence.current) return
      setAccess(
        errorStatus(e) === 403
          ? 'membership'
          : errorStatus(e) === 401
            ? 'signed-out'
            : 'error',
      )
      if (errorStatus(e) === 401) setSigned(false)
      setMember(null)
      setRecords([])
      setStaff([])
      setModal((current) => (current === 'auth' ? current : null))
      setCalendar(calendarDefault)
      setNotice(errorMessage(e))
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    ;(async () => {
      try {
        const cb = await handleAuthCallback()
        if (cb?.type === 'invite') {
          setInvite(cb.token || '')
          setAuthMode('invite')
          setModal('auth')
        }
        if (cb?.type === 'recovery') {
          setAuthMode('reset')
          setModal('auth')
        }
      } catch (e) {
        setNotice(errorMessage(e))
      }
      await reload()
    })()
  }, [reload])
  useEffect(() => {
    if (!modal) return
    const previous = document.activeElement as HTMLElement | null
    const dialog = document.querySelector<HTMLElement>('[role=dialog]')
    const targets = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,a[href]',
        ) || [],
      )
    targets()[0]?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModal(null)
      if (e.key === 'Tab') {
        const items = targets(),
          first = items[0],
          last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
      previous?.focus()
    }
  }, [modal])
  useEffect(() => {
    if (!mobile) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        document.querySelector('[role=dialog]')
      )
        return
      event.preventDefault()
      setMobile(false)
      navigationToggle.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [mobile])
  const go = (p: string) => {
    if (mobile) navigationToggle.current?.focus()
    setPage(p)
    setFilter('All records')
    setQuery('')
    setMobile(false)
  }
  function create(kind: string) {
    if (!member || access !== 'ready') {
      if (!signed) {
        setAuthMode('login')
        setModal('auth')
      } else
        setNotice(
          'An active CRM membership and successfully loaded workspace are required before creating records.',
        )
      return
    }
    if (kind === 'organization' || kind === 'contact') {
      setSelected(null)
      setModal(null)
      go('Directory')
      setNotice('Use the directory to add or update people and organizations.')
      return
    }
    setSelected(null)
    setModal(kind)
  }
  const open = (r: Rec) => {
    setSelected(r)
    setModal('detail')
  }
  const opportunities = records.filter((r) => r.kind === 'opportunity')
  const openOpp = opportunities.filter((r) =>
      /^S[1-8]$/.test(r.data.stage || ''),
    ),
    holds = opportunities.filter((r) => r.data.stage?.startsWith('H')),
    won = opportunities.filter((r) => r.data.stage === 'S9')
  const pending = records.filter(
    (r) =>
      ['research', 'offer', 'proposal', 'quote'].includes(r.kind) &&
      !records.some(
        (a) =>
          a.kind === 'approval' &&
          a.parentId === r.id &&
          a.data.targetRevision === r.revision,
      ),
  )
  const tasks = records.filter(
    (r) => r.kind === 'task' && r.data.status !== 'Complete',
  )
  const overdue = tasks.filter(
    (r) => r.data.nextDue && new Date(r.data.nextDue) < new Date(),
  )
  const owner = (id: string | null) =>
    staff.find((s) => s.id === id)?.name || 'Assigned staff'
  const approval = (r: Rec) =>
    records
      .filter(
        (a) =>
          a.kind === 'approval' &&
          a.parentId === r.id &&
          a.data.targetRevision === r.revision,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.data
      .decision || 'Pending review'
  const newButton = (kind: string, text?: string) => (
    <button className="primary" onClick={() => create(kind)}>
      <Plus size={16} />
      {text || `New ${labels[kind]?.toLowerCase()}`}
    </button>
  )
  const metrics = [
    [
      'Open pipeline',
      openOpp.length,
      'S1–S8 · active opportunities',
      BriefcaseBusiness,
    ],
    ['On hold', holds.length, 'Awaiting a decision or capacity', Clock3],
    [
      'Founder reviews',
      pending.length,
      'Drafts awaiting a decision',
      ShieldCheck,
    ],
    ['Won handoffs', won.length, 'Accepted by delivery · S9', PackageCheck],
  ] as const
  const visible = records.filter(
    (r) =>
      (page === 'Approvals'
        ? pending.some((p) => p.id === r.id) || r.kind === 'approval'
        : pageKinds[page]?.includes(r.kind)) &&
      `${r.title} ${r.data.service || ''} ${r.data.stage || ''}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === 'All records' ||
        (filter === 'Assigned to me' && r.ownerId === member?.id) ||
        r.data.stage === filter ||
        r.kind === filter),
  )
  const table = (
    rows: Rec[],
    emptyTitle = 'A clear space for your next opportunity',
    emptyText = 'Add your first record to give the team a shared place to work.',
  ) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>RECORD / ORGANIZATION</th>
            <th>STATUS</th>
            <th>OWNER</th>
            <th>NEXT ACTION</th>
            <th>DUE</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => open(r)}>
              <td>
                <button
                  className="record-link"
                  onClick={(e) => {
                    e.stopPropagation()
                    open(r)
                  }}
                >
                  {r.title}
                </button>
                <small>
                  {r.data.company || labels[r.kind]} ·{' '}
                  {r.id.slice(0, 8).toUpperCase()}
                </small>
              </td>
              <td>
                <span
                  className={`badge ${r.data.suppressed ? 'danger' : r.data.stage?.startsWith('H') ? 'amber' : ''}`}
                >
                  {r.data.suppressed
                    ? 'No-contact'
                    : stages[r.data.stage || ''] ||
                      r.data.result ||
                      r.data.status ||
                      (r.kind === 'approval'
                        ? r.data.decision
                        : ['offer', 'proposal', 'research', 'quote'].includes(
                              r.kind,
                            )
                          ? approval(r)
                          : r.kind === 'handoff'
                            ? 'Accepted'
                            : labels[r.kind])}
                </span>
              </td>
              <td>
                <span className="avatar mini">
                  {owner(r.ownerId).slice(0, 1)}
                </span>
                {owner(r.ownerId)}
              </td>
              <td>{r.data.nextAction || r.data.nextStep || '—'}</td>
              <td
                className={
                  r.data.nextDue && new Date(r.data.nextDue) < new Date()
                    ? 'late'
                    : ''
                }
              >
                {formatDate(r.data.nextDue)}
              </td>
              <td>
                <ChevronRight size={15} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="empty">
          <div className="empty-icon">
            <BriefcaseBusiness size={25} strokeWidth={1.3} />
          </div>
          <h3>{emptyTitle}</h3>
          <p>{emptyText}</p>
        </div>
      )}
    </div>
  )
  return (
    <div className="app-shell">
      <aside
        id="workspace-navigation"
        className={mobile ? 'sidebar show' : 'sidebar'}
      >
        <a className="brand" href="/" aria-label="Emerson CRM home">
          <span className="brand-mark">
            E<span>·</span>
          </span>
          <span>
            EMERSON<small>CUSTOMER RELATIONSHIPS</small>
          </span>
        </a>
        <div className="workspace-label">
          THE EMERSON EMPIRE <ChevronDown size={12} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {nav
            .filter(([p]) => p !== 'Settings')
            .map(([p, Icon]) => (
              <button
                key={p}
                className={page === p ? 'active' : ''}
                onClick={() => go(p)}
              >
                <Icon size={18} strokeWidth={1.7} />
                <span>{p}</span>
                {p === 'Approvals' && pending.length > 0 && (
                  <em>{pending.length}</em>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="studio-note">
            <span className="status-dot" /> PROJECT STUDIO
            <small>
              A thoughtful process.
              <br />A stronger relationship.
            </small>
          </div>
          <button
            className={page === 'Settings' ? 'active' : ''}
            onClick={() => go('Settings')}
          >
            <Settings2 size={18} />
            Settings & staff
          </button>
          <button
            className="profile"
            onClick={() =>
              signed
                ? logout()
                    .then(() => {
                      ++loadSequence.current
                      setAccess('signed-out')
                      setLoading(false)
                      setStaff([])
                      setSelected(null)
                      setModal(null)
                      setMember(null)
                      setSigned(false)
                      setRecords([])
                      setNotice('Signed out securely.')
                    })
                    .catch((e: Error) =>
                      setNotice(
                        `Sign-out failed: ${errorMessage(e)}. Try again.`,
                      ),
                    )
                : setModal('auth')
            }
          >
            <span className="avatar">
              {member ? member.name.slice(0, 1) : 'E'}
            </span>
            <span>
              {member?.name || 'Your workspace'}
              <small>{member?.role || 'Invitation-only access'}</small>
            </span>
            {signed ? <LogOut size={16} /> : <LockKeyhole size={16} />}
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-menu"
              ref={navigationToggle}
              aria-label="Toggle navigation"
              aria-controls="workspace-navigation"
              aria-expanded={mobile}
              onClick={() => setMobile((current) => !current)}
            >
              <PanelLeftClose size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="top-actions">
            <span className="operating">
              <span className="status-dot" />
              Internal workspace
            </span>
            <button
              className="icon-btn"
              title="Refresh workspace"
              aria-label="Refresh workspace"
              onClick={reload}
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
            </button>
            <span className="top-divider" />
            <span className="avatar small">
              {member ? member.name.slice(0, 1) : 'E'}
            </span>
          </div>
        </header>
        <main>
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button onClick={() => setNotice('')} aria-label="Dismiss">
                <X size={15} />
              </button>
            </div>
          )}
          {access !== 'ready' && (
            <div className="access-banner">
              <LockKeyhole size={17} />
              <div>
                <strong>
                  {access === 'signed-out'
                    ? 'Sign in to your workspace'
                    : access === 'membership'
                      ? 'Staff access is pending'
                      : access === 'error'
                        ? 'Workspace could not load'
                        : access === 'loading'
                          ? 'Loading authorized records…'
                          : 'Checking account access…'}
                </strong>
                <span>
                  {access === 'signed-out'
                    ? 'Use your accepted staff invitation. CRM records and totals appear after authorized loading.'
                    : access === 'membership'
                      ? 'Your Identity account is signed in. The owner must grant an active CRM membership; inactive access must be restored by an owner.'
                      : access === 'error'
                        ? 'Records and totals are unavailable. Check your connection and retry; contact the owner if the problem continues.'
                        : 'Please wait while account access and records are checked.'}
                </span>
              </div>
              {access === 'signed-out' ? (
                <button
                  onClick={() => {
                    setAuthMode('login')
                    setModal('auth')
                  }}
                >
                  Staff sign in <ArrowRight size={15} />
                </button>
              ) : (
                !loading && (
                  <button onClick={reload}>
                    Retry access <RefreshCw size={15} />
                  </button>
                )
              )}
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                THE EMERSON EMPIRE <span>/</span>{' '}
                {page === 'Dashboard'
                  ? 'OVERVIEW'
                  : [
                        'Directory',
                        'Workflows',
                        'Import review',
                        'Library',
                      ].includes(page)
                    ? 'COMPANY RELATIONSHIPS'
                    : 'PROJECT STUDIO'}
              </div>
              <h1>
                {page === 'Dashboard'
                  ? 'A little clarity. A lot of possibility.'
                  : page}
              </h1>
              <p>
                {page === 'Dashboard'
                  ? 'Your company relationships, from the first conversation to the next chapter.'
                  : descriptions[page]}
              </p>
            </div>
            {page === 'Dashboard' ||
            page === 'Opportunities' ||
            page === 'Pipeline'
              ? newButton('opportunity', 'New opportunity')
              : pageKinds[page] && page !== 'Approvals'
                ? newButton(pageKinds[page][0])
                : null}
          </div>
          {access !== 'ready' || !member ? (
            <section className="panel" aria-busy={loading}>
              <div className="empty">
                {loading
                  ? 'Loading workspace…'
                  : 'Business records and totals are unavailable until access succeeds.'}
              </div>
            </section>
          ) : page === 'Directory' ||
            page === 'Workflows' ||
            page === 'Import review' ||
            page === 'Library' ? (
            <FoundationWorkspace
              key={`${member.id}:${page}`}
              section={page}
              records={records}
              member={member}
              staff={staff}
              api={api}
              reload={reload}
              syntheticEducation={syntheticEducation}
              syntheticWebsiteIntake={syntheticWebsiteIntake}
              onOpenLegacy={() => go('Opportunities')}
            />
          ) : page === 'Dashboard' ? (
            <>
              <div className="overview-line">
                <h2>At a glance</h2>
                <span>
                  <span className="status-dot" />
                  {records.some((r) => r.kind !== 'offer')
                    ? 'Live workspace'
                    : 'Authorized workspace · no business records yet'}{' '}
                  <span className="muted">· America/New_York</span>
                </span>
              </div>
              <div className="metrics">
                {metrics.map(([title, value, desc, Icon], i) => (
                  <button
                    key={title}
                    className="metric"
                    onClick={() => {
                      go(
                        i === 2
                          ? 'Approvals'
                          : i === 3
                            ? 'Delivery handoffs'
                            : i === 1
                              ? 'Pipeline'
                              : 'Opportunities',
                      )
                    }}
                  >
                    <div>
                      <span>{title}</span>
                      <Icon size={19} />
                    </div>
                    <strong>
                      {loading ? '—' : value.toString().padStart(2, '0')}
                    </strong>
                    <small>{desc}</small>
                  </button>
                ))}
              </div>
              <div className="dashboard-grid">
                <section className="panel pipeline-panel">
                  <div className="panel-head">
                    <div>
                      <h2>The sales journey</h2>
                      <p>A considered next step at every stage.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => go('Pipeline')}
                    >
                      View pipeline <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="journey">
                    {['S1', 'S3', 'S5', 'S6', 'S7', 'S9'].map((s, i) => (
                      <button
                        key={s}
                        onClick={() => {
                          go('Opportunities')
                          setFilter(s)
                        }}
                      >
                        <span className={'journey-dot j' + i}>{i + 1}</span>
                        <strong>
                          {
                            opportunities.filter((o) => o.data.stage === s)
                              .length
                          }
                        </strong>
                        <small>{stages[s]}</small>
                      </button>
                    ))}
                  </div>
                  <div className="panel-foot">
                    <span>
                      <span className="small-dot" />
                      Open pipeline: {openOpp.length}
                    </span>
                    <span>On hold: {holds.length}</span>
                    <span>
                      Other closed:{' '}
                      {
                        opportunities.filter((o) =>
                          /^X[1-3]$/.test(o.data.stage || ''),
                        ).length
                      }
                    </span>
                    <span>
                      No-contact:{' '}
                      {
                        opportunities.filter(
                          (o) => o.data.stage === 'X4' || o.data.suppressed,
                        ).length
                      }
                    </span>
                    <span>
                      Research:{' '}
                      {records.filter((o) => o.kind === 'research').length}
                    </span>
                  </div>
                </section>
                <section className="panel focus-panel">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">A GOOD PLACE TO START</span>
                      <h2>Make the next move.</h2>
                    </div>
                    <span className="focus-symbol">↗</span>
                  </div>
                  <p>
                    Build relationships with care.
                    <br />
                    Keep the next action clear.
                  </p>
                  <button onClick={() => create('research')}>
                    <FlaskConical size={17} />
                    Research a prospect
                    <ArrowRight size={17} />
                  </button>
                  <button onClick={() => create('task')}>
                    <ListChecks size={17} />
                    Plan a follow-up
                    <ArrowRight size={17} />
                  </button>
                </section>
              </div>
              <div className="dashboard-grid second">
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>Opportunities to move forward</h2>
                      <p>Accountability starts with a clear next action.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => go('Opportunities')}
                    >
                      View all <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {table(
                    openOpp.slice(0, 5),
                    'Your next chapter starts here',
                    'Add a genuine inquiry when you’re ready. Your production pipeline starts clean.',
                  )}
                </section>
                <section className="panel attention">
                  <div className="panel-head">
                    <h2>Needs your attention</h2>
                    <span className="badge">
                      {overdue.length + pending.length + holds.length}
                    </span>
                  </div>
                  <button onClick={() => go('Tasks')}>
                    <span className="attention-icon">
                      <Clock3 size={18} />
                    </span>
                    <span>
                      <strong>Overdue next actions</strong>
                      <small>Keep your commitments in view</small>
                    </span>
                    <b>{overdue.length}</b>
                    <ChevronRight size={15} />
                  </button>
                  <button onClick={() => go('Approvals')}>
                    <span className="attention-icon">
                      <ShieldCheck size={18} />
                    </span>
                    <span>
                      <strong>Founder review queue</strong>
                      <small>Offers, proposals & outreach</small>
                    </span>
                    <b>{pending.length}</b>
                    <ChevronRight size={15} />
                  </button>
                  <button onClick={() => go('Pipeline')}>
                    <span className="attention-icon">
                      <PackageCheck size={18} />
                    </span>
                    <span>
                      <strong>Capacity checks</strong>
                      <small>Confirm before committing</small>
                    </span>
                    <b>
                      {
                        opportunities.filter(
                          (r) =>
                            r.data.stage === 'H3' ||
                            (r.data.stage === 'S6' &&
                              r.data.capacityStatus !== 'Confirmed'),
                        ).length
                      }
                    </b>
                    <ChevronRight size={15} />
                  </button>
                  <button onClick={() => go('Opportunities')}>
                    <span className="attention-icon">
                      <FileText size={18} />
                    </span>
                    <span>
                      <strong>Missing required information</strong>
                      <small>Owners, next actions & evidence</small>
                    </span>
                    <b>
                      {
                        opportunities.filter(
                          (r) =>
                            !r.ownerId ||
                            !r.data.nextAction ||
                            !r.data.nextDue ||
                            (r.data.stage !== 'S1' && !r.data.stageEvidence),
                        ).length
                      }
                    </b>
                    <ChevronRight size={15} />
                  </button>
                  <div className="attention-note">
                    <ShieldCheck size={15} />
                    <span>
                      Commercial approval stays explicit.
                      <br />
                      Every offer needs the right sign-off.
                    </span>
                  </div>
                </section>
              </div>
              <div className="workspace-footer">
                <span>ONE EMPIRE. CONNECTED RELATIONSHIPS.</span>
                <div>
                  TEE <span>·</span> TEA <span>·</span> EPDG <span>·</span>{' '}
                  PROJECT STUDIO
                </div>
              </div>
            </>
          ) : page === 'Pipeline' ? (
            <>
              <div className="section-tabs">
                <span className="selected">Sales stages</span>
                <span>{openOpp.length} open opportunities</span>
              </div>
              <div className="kanban">
                {Object.entries(stages).map(([code, label]) => (
                  <section className="kanban-col" key={code}>
                    <h3>
                      <span className="small-dot" />
                      {code} · {label}
                      <b>
                        {
                          opportunities.filter((r) => r.data.stage === code)
                            .length
                        }
                      </b>
                    </h3>
                    {opportunities
                      .filter((r) => r.data.stage === code)
                      .map((r) => (
                        <button
                          className="kanban-card"
                          key={r.id}
                          onClick={() => open(r)}
                        >
                          <small>{r.data.service || 'Project Studio'}</small>
                          <strong>{r.title}</strong>
                          <p>{r.data.nextAction}</p>
                          <span>
                            {owner(r.ownerId)} · {formatDate(r.data.nextDue)}
                          </span>
                        </button>
                      ))}
                    {!opportunities.some((r) => r.data.stage === code) && (
                      <p className="column-empty">No opportunities</p>
                    )}
                  </section>
                ))}
              </div>
            </>
          ) : page === 'Settings' ? (
            <SettingsView
              member={member}
              staff={staff}
              calendar={calendar}
              api={api}
              reload={reload}
              notice={setNotice}
              create={create}
            />
          ) : (
            <>
              <div className="section-tabs">
                {(page === 'Offers'
                  ? ['All records', 'offer', 'proposal', 'quote']
                  : page === 'Approvals'
                    ? ['All records']
                    : ['All records', 'Assigned to me']
                ).map((t) => (
                  <button
                    className={filter === t ? 'selected' : ''}
                    onClick={() => setFilter(t)}
                    key={t}
                  >
                    {labels[t] || t}
                    {t === 'All records' && <span>{visible.length}</span>}
                  </button>
                ))}
              </div>
              {page === 'Offers' && (
                <div className="info-strip">
                  <FileText size={18} />
                  <span>
                    Historical ranges are reference only. Prices remain pending
                    until an explicit commercial decision.
                  </span>
                  {member?.role === 'owner' && (
                    <button
                      className="text-button"
                      onClick={async () => {
                        try {
                          for (const [
                            company,
                            service,
                            referenceRange,
                          ] of draftOffers) {
                            if (
                              records.some(
                                (r) =>
                                  r.kind === 'offer' && r.title === service,
                              )
                            )
                              continue
                            await api({
                              action: 'save',
                              record: {
                                kind: 'offer',
                                title: service,
                                data: {
                                  company,
                                  service,
                                  offerId: service
                                    .toLowerCase()
                                    .replace(/[^a-z]+/g, '-'),
                                  version: '1',
                                  pricingModel: 'pending',
                                  referenceRange,
                                  referenceSource:
                                    'May 2026 company pricing guide, via Todor Tomic review 2026-10-19',
                                  referenceDate: '2026-05-01',
                                  currency: 'USD',
                                },
                              },
                            })
                          }
                          await reload()
                          setNotice(
                            'Draft service catalogue added. No prices are approved.',
                          )
                        } catch (e) {
                          setNotice(errorMessage(e))
                        }
                      }}
                    >
                      Initialize draft catalogue
                      <ArrowRight size={15} />
                    </button>
                  )}
                </div>
              )}
              <div className="toolbar">
                <label className="search">
                  <Search size={17} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${page.toLowerCase()}…`}
                    aria-label={`Search ${page}`}
                  />
                </label>
                <div>
                  {page === 'Opportunities' && (
                    <select
                      aria-label="Filter by stage"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option>All records</option>
                      {Object.entries(stages).map(([code, label]) => (
                        <option value={code} key={code}>
                          {code} · {label}
                        </option>
                      ))}
                    </select>
                  )}
                  {page === 'Research' && (
                    <button
                      className="secondary"
                      onClick={() =>
                        member ? setModal('import') : setModal('auth')
                      }
                    >
                      <Upload size={15} />
                      Import CSV
                    </button>
                  )}
                  <button
                    className="secondary"
                    onClick={async () => {
                      if (!member) {
                        setModal('auth')
                        return
                      }
                      try {
                        const r = await fetch('/api/crm?export=csv')
                        if (!r.ok) throw Error('Export failed')
                        const u = URL.createObjectURL(await r.blob())
                        const a = document.createElement('a')
                        a.href = u
                        a.download = 'emerson-crm.csv'
                        a.click()
                        URL.revokeObjectURL(u)
                      } catch (e) {
                        setNotice(errorMessage(e))
                      }
                    }}
                  >
                    <Download size={15} />
                    Export
                  </button>
                </div>
              </div>
              <section className="panel">
                {loading ? (
                  <div className="empty skeleton">Loading your workspace…</div>
                ) : (
                  table(
                    visible,
                    `No ${page.toLowerCase()} yet`,
                    page === 'Approvals'
                      ? 'Draft offers, proposals, research outreach, and quote requests appear here for review.'
                      : 'Create a record to begin. Only deliberately entered production records appear here.',
                  )
                )}
              </section>
              {page === 'Opportunities' && (
                <div className="related-tools">
                  <span>RELATIONSHIP DIRECTORY</span>
                  <button
                    onClick={() => {
                      setModal('directory')
                      setSelected(null)
                    }}
                  >
                    <Users size={16} />
                    Organizations & contacts
                  </button>
                  <button onClick={() => create('activity')}>
                    Log activity
                  </button>
                  <button onClick={() => create('discovery')}>
                    Record discovery
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <section
            className={'modal ' + (modal === 'detail' ? 'wide' : '')}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === 'auth' ? 'Staff access' : labels[modal] || modal
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-btn"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === 'auth' ? (
              <Auth
                mode={authMode}
                setMode={setAuthMode}
                invite={invite}
                done={async () => {
                  setModal(null)
                  await reload()
                }}
              />
            ) : modal === 'directory' ? (
              <>
                <div className="eyebrow">RELATIONSHIPS</div>
                <h2>Organizations & contacts</h2>
                <p className="muted">
                  Create an organization before linking research or
                  opportunities.
                </p>
                <div className="button-row">
                  {newButton('organization')}
                  {newButton('contact')}
                </div>
                {table(
                  records.filter((r) =>
                    ['organization', 'contact'].includes(r.kind),
                  ),
                )}
              </>
            ) : modal === 'import' ? (
              <Importer
                records={records}
                member={member}
                api={api}
                reload={reload}
              />
            ) : modal === 'detail' && selected ? (
              <Detail
                record={records.find((r) => r.id === selected.id) || selected}
                records={records}
                staff={staff}
                member={member}
                approval={approval}
                api={api}
                onEdit={() => {
                  if (
                    selected.kind === 'organization' ||
                    selected.kind === 'contact'
                  ) {
                    setSelected(null)
                    setModal(null)
                    go('Directory')
                    setNotice(
                      'Open this record in the directory to edit its shared details.',
                    )
                  } else setModal(selected.kind)
                }}
                onCreate={(kind: string) => {
                  const p = selected
                  setSelected({
                    kind,
                    title: p.title,
                    parentId: p.id,
                    organizationId: p.organizationId,
                    ownerId: member?.id,
                    data: {},
                    revision: 0,
                  } as Rec)
                  setModal(kind)
                }}
                onVersion={() => {
                  setSelected({
                    ...selected,
                    id: '',
                    revision: 0,
                    data: {
                      ...selected.data,
                      version: String(Number(selected.data.version || 1) + 1),
                    },
                  })
                  setModal(selected.kind)
                }}
                reload={reload}
              />
            ) : (
              <RecordForm
                kind={modal}
                selected={selected}
                records={records}
                staff={staff}
                member={member}
                api={api}
                done={async () => {
                  setModal(null)
                  await reload()
                }}
              />
            )}
          </section>
        </div>
      )}
    </div>
  )
}
function Auth({
  mode,
  setMode,
  invite,
  done,
}: {
  mode: AuthMode
  setMode: (mode: AuthMode) => void
  invite: string
  done: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <>
      <span className="dialog-monogram">E.</span>
      <div className="eyebrow">EMERSON CRM · STAFF ACCESS</div>
      <h2>
        {mode === 'invite'
          ? 'Welcome to the team.'
          : mode === 'reset'
            ? 'Set a new password.'
            : mode === 'recover'
              ? 'Recover your account.'
              : 'Welcome back.'}
      </h2>
      <p className="muted">
        An individual staff invitation and active membership are required.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          const f = new FormData(e.currentTarget)
          try {
            if (mode === 'invite')
              await acceptInvite(invite, String(f.get('password')))
            else if (mode === 'reset')
              await updateUser({ password: String(f.get('password')) })
            else if (mode === 'recover') {
              await requestPasswordRecovery(String(f.get('email')))
              setError(
                'If eligible, a recovery link is on its way. Check your inbox.',
              )
              return
            } else
              await login(String(f.get('email')), String(f.get('password')))
            await done()
          } catch (err) {
            setError(errorMessage(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        {!['reset', 'invite'].includes(mode) && (
          <label>
            Email address
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              placeholder="Your staff email"
            />
          </label>
        )}
        {mode !== 'recover' && (
          <label>
            {mode === 'login' ? 'Password' : 'New password'}
            <input
              type="password"
              name="password"
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              minLength={mode === 'login' ? 1 : 12}
              required
            />
          </label>
        )}
        {error && (
          <p className="form-error" role="status">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy}>
          {busy
            ? 'Working…'
            : mode === 'login'
              ? 'Sign in'
              : mode === 'recover'
                ? 'Send recovery link'
                : 'Set password & continue'}
          <ArrowRight size={16} />
        </button>
      </form>
      {['login', 'recover'].includes(mode) && (
        <button
          className="text-button auth-switch"
          onClick={() => {
            setMode(mode === 'login' ? 'recover' : 'login')
            setError('')
          }}
        >
          {mode === 'login' ? 'Forgot your password?' : 'Back to sign in'}
        </button>
      )}
      <div className="security-note">
        <LockKeyhole size={15} />
        Private workspace. No public registration.
      </div>
    </>
  )
}
function RecordForm({
  kind,
  selected,
  records,
  staff,
  member,
  api,
  done,
}: Omit<SharedProps, 'reload'> & {
  kind: string
  selected: Rec | null
  done: () => Promise<void>
}) {
  const [data, setData] = useState<RecordData>(
      selected?.kind === kind
        ? { ...selected.data }
        : {
            stage: 'S1',
            status: 'Open',
            currency: 'USD',
            pricingModel: 'pending',
            criteria: ['Unclear', 'Unclear', 'Unclear', 'Unclear', 'Unclear'],
          },
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [organizationId, setOrganizationId] = useState(
      selected?.organizationId || '',
    ),
    [parentId, setParentId] = useState(selected?.parentId || ''),
    [ownerId, setOwnerId] = useState(selected?.ownerId || member?.id || '')
  const recordOptions = (kinds: string[], linkedParent = '') =>
    records
      .filter(
        (r: Rec) =>
          kinds.includes(r.kind) &&
          (!linkedParent || r.parentId === linkedParent) &&
          (!organizationId ||
            !r.organizationId ||
            r.organizationId === organizationId),
      )
      .map((r: Rec) => ({
        id: r.id,
        label: [
          r.title,
          labels[r.kind],
          records.find((o: Rec) => o.id === r.organizationId)?.title,
          r.data.email,
          r.data.website,
          r.data.version && `version ${r.data.version}`,
          r.data.stage,
          r.createdAt && new Date(r.createdAt).toLocaleString(),
        ]
          .filter(Boolean)
          .join(' · '),
      }))
  const staffOptions = (deliveryOnly = false) =>
    staff
      .filter(
        (s) =>
          s.active && (!deliveryOnly || ['owner', 'delivery'].includes(s.role)),
      )
      .map((s) => ({ id: s.id, label: `${s.name} · ${s.role}` }))
  const relationKinds: Record<string, string[]> = {
    contactId: ['contact'],
    proposalId: ['proposal'],
    researchId: ['research'],
  }
  const parentKinds =
    kind === 'contact'
      ? []
      : kind === 'task'
        ? ['research', 'opportunity']
        : kind === 'activity'
          ? ['research', 'opportunity']
          : ['discovery', 'proposal', 'quote', 'workorder', 'handoff'].includes(
                kind,
              )
            ? ['opportunity']
            : []
  return (
    <>
      <div className="eyebrow">
        PROJECT STUDIO · {selected?.id ? 'RECORD UPDATE' : 'NEW RECORD'}
      </div>
      <h2>
        {selected?.id ? 'Update' : 'Create'} {labels[kind]?.toLowerCase()}
      </h2>
      <p className="muted">
        {['offer', 'proposal'].includes(kind)
          ? 'Each version is immutable. Approval applies only to its original scope, price, and terms.'
          : kind === 'handoff'
            ? 'Saving accepts delivery responsibility with your identity and timestamp.'
            : 'Keep facts clear and evidence linked. Do not enter sensitive tax or identity information.'}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          const f = new FormData(e.currentTarget)
          try {
            await api({
              action: 'save',
              record: {
                id:
                  selected?.kind === kind
                    ? selected.id || undefined
                    : undefined,
                revision: selected?.revision,
                kind,
                title: f.get('title'),
                ownerId: f.get('ownerId'),
                organizationId: f.get('organizationId'),
                parentId: f.get('parentId'),
                data: Object.fromEntries(
                  Object.entries(data).map(([k, v]) => [
                    k,
                    fields[kind]?.find((f) => f[0] === k)?.[2] ===
                      'datetime-local' && v
                      ? new Date(String(v)).toISOString()
                      : v,
                  ]),
                ),
              },
            })
            await done()
          } catch (err) {
            setError(errorMessage(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="form-grid">
          <div className="form-field span-2">
            Record title / organization name
            <input
              aria-label="Record title / organization name"
              name="title"
              required
              defaultValue={selected?.kind === kind ? selected.title : ''}
            />
          </div>
          <div className="form-field">
            Accountable owner
            <RecordSelector
              label="Accountable owner"
              name="ownerId"
              required
              value={ownerId}
              onChange={setOwnerId}
              options={staffOptions().filter(
                (s) =>
                  ['owner', 'manager'].includes(member?.role || '') ||
                  s.id === member?.id,
              )}
            />
          </div>
          {kind !== 'organization' && (
            <div className="form-field">
              Organization
              <RecordSelector
                label="Organization"
                name="organizationId"
                value={organizationId}
                onChange={(id: string) => {
                  setOrganizationId(id)
                  setParentId('')
                  setData({
                    ...data,
                    contactId: '',
                    proposalId: '',
                    researchId: '',
                  })
                }}
                options={recordOptions(['organization'])}
              />
            </div>
          )}
          {parentKinds.length > 0 && (
            <div className="form-field span-2">
              Linked record
              <RecordSelector
                label="Linked record"
                name="parentId"
                required
                value={parentId}
                onChange={(id: string) => {
                  setParentId(id)
                  const p = records.find((r: Rec) => r.id === id)
                  if (p?.organizationId) setOrganizationId(p.organizationId)
                  setData({ ...data, proposalId: '' })
                }}
                options={recordOptions(parentKinds)}
              />
            </div>
          )}
          {(fields[kind] || []).map(([key, label, type, options]) => (
            <div
              key={key}
              className={
                type === 'textarea' || type === 'rubric'
                  ? 'form-field span-2'
                  : 'form-field'
              }
            >
              {label}
              {relationKinds[key] ? (
                <RecordSelector
                  label={label}
                  value={String(data[key] ?? '')}
                  onChange={(id: string) => setData({ ...data, [key]: id })}
                  options={
                    key === 'proposalId' &&
                    !(kind === 'opportunity' ? selected?.id : parentId)
                      ? []
                      : recordOptions(
                          relationKinds[key],
                          key === 'proposalId'
                            ? kind === 'opportunity'
                              ? selected?.id
                              : parentId
                            : '',
                        )
                  }
                />
              ) : ['capacityReviewer', 'deliveryLead'].includes(key) ? (
                <RecordSelector
                  label={label}
                  value={String(data[key] ?? '')}
                  onChange={(id: string) => setData({ ...data, [key]: id })}
                  options={staffOptions(true)}
                />
              ) : type === 'rubric' ? (
                <div className="rubric">
                  {[
                    'Need matches a package',
                    'Business stage',
                    'Decision-maker',
                    'No regulated core need',
                    'Client can take part',
                  ].map((c, i) => (
                    <div key={c}>
                      <span>
                        {i + 1}. {c}
                      </span>
                      <select
                        aria-label={c}
                        value={data.criteria?.[i] || 'Unclear'}
                        onChange={(e) => {
                          const criteria = [
                            ...(data.criteria || Array(5).fill('Unclear')),
                          ]
                          criteria[i] = e.target.value
                          setData({ ...data, criteria })
                        }}
                      >
                        {['Met', 'Not met', 'Unclear'].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <strong>
                    Recommendation:{' '}
                    {stages[discoveryResult(data.criteria || [])] ||
                      'Incomplete — record the gap'}
                  </strong>
                </div>
              ) : type === 'textarea' ? (
                <textarea
                  aria-label={label}
                  rows={3}
                  value={String(data[key] ?? '')}
                  onChange={(e) => setData({ ...data, [key]: e.target.value })}
                />
              ) : type === 'select' || type === 'stage' ? (
                <select
                  aria-label={label}
                  value={String(data[key] ?? '')}
                  onChange={(e) => setData({ ...data, [key]: e.target.value })}
                >
                  <option value="">Select…</option>
                  {type === 'stage'
                    ? Object.entries(stages).map(([code, l]) => (
                        <option key={code} value={code}>
                          {code} — {l}
                        </option>
                      ))
                    : options?.map((v) => <option key={v}>{v}</option>)}
                </select>
              ) : (
                <input
                  aria-label={label}
                  type={type || 'text'}
                  step={type === 'number' ? '0.01' : undefined}
                  value={
                    type === 'datetime-local' && data[key]
                      ? new Date(
                          new Date(String(data[key])).getTime() -
                            new Date(String(data[key])).getTimezoneOffset() *
                              60000,
                        )
                          .toISOString()
                          .slice(0, 16)
                      : String(data[key] ?? '')
                  }
                  onChange={(e) => setData({ ...data, [key]: e.target.value })}
                />
              )}
            </div>
          ))}
          {selected?.id &&
            !fields[kind]?.some((f) => f[0] === 'ownershipReason') && (
              <div className="form-field span-2">
                Reason for ownership change (if reassigning)
                <input
                  aria-label="Reason for ownership change"
                  value={data.ownershipReason || ''}
                  onChange={(e) =>
                    setData({ ...data, ownershipReason: e.target.value })
                  }
                />
              </div>
            )}
          {['owner', 'manager'].includes(member?.role || '') && (
            <div className="form-field span-2">
              Additional permitted readers
              <RecordSelector
                label="Additional permitted readers"
                multiple
                value={Array.isArray(data.readers) ? data.readers : []}
                onChange={(ids: string[]) => setData({ ...data, readers: ids })}
                options={staffOptions()}
              />
            </div>
          )}
        </div>
        <p className="muted form-time-note">
          Date/time inputs use your device timezone. Deadlines and date labels
          use America/New_York.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          <span>Changes are recorded in the audit history.</span>
          <button className="primary" disabled={busy}>
            {busy
              ? 'Saving…'
              : kind === 'handoff'
                ? 'Accept delivery handoff'
                : 'Save record'}
            <Check size={16} />
          </button>
        </div>
      </form>
    </>
  )
}
function Detail({
  record: r,
  records,
  staff,
  member,
  approval,
  api,
  onEdit,
  onCreate,
  onVersion,
  reload,
}: SharedProps & {
  record: Rec
  approval: (record: Rec) => string
  onEdit: () => void
  onCreate: (kind: string) => void
  onVersion: () => void
}) {
  const [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<AuditEntry[] | null>(null)
  const linked = records.filter((x) => x.parentId === r.id)
  const contacts = [
    ...linked,
    ...records.filter(
      (x) => r.data.researchId && x.parentId === r.data.researchId,
    ),
  ]
    .filter((x) => x.kind === 'activity' && x.data.contactEvent)
    .sort((a, b) =>
      (b.data.occurredAt || '').localeCompare(a.data.occurredAt || ''),
    )
  const immutable = [
    'offer',
    'proposal',
    'activity',
    'suppression',
    'handoff',
    'workorder',
    'approval',
    'ownership',
  ].includes(r.kind)
  return (
    <>
      <div className="eyebrow">
        {labels[r.kind]} · {r.id.slice(0, 8).toUpperCase()} · REV {r.revision}
      </div>
      <h2>{r.title}</h2>
      <div className="detail-meta">
        <span className="badge">
          {stages[r.data.stage || ''] ||
            (['research', 'offer', 'proposal', 'quote'].includes(r.kind)
              ? approval(r)
              : labels[r.kind])}
        </span>
        <span>
          {staff.find((s) => s.id === r.ownerId)?.name || 'Assigned staff'}
        </span>
        <span>Updated {formatDate(r.updatedAt)}</span>
      </div>
      <div className="button-row">
        {!immutable && member?.role !== 'viewer' && (
          <button className="secondary" onClick={onEdit}>
            Edit record
          </button>
        )}
        {['offer', 'proposal'].includes(r.kind) && (
          <button className="secondary" onClick={onVersion}>
            <Plus size={15} />
            Create new version
          </button>
        )}
        {['research', 'opportunity'].includes(r.kind) && (
          <>
            <button className="secondary" onClick={() => onCreate('activity')}>
              Log activity
            </button>
            <button className="secondary" onClick={() => onCreate('task')}>
              Add task
            </button>
          </>
        )}
        {r.kind === 'opportunity' && (
          <>
            <button className="secondary" onClick={() => onCreate('discovery')}>
              Discovery
            </button>
            <button className="secondary" onClick={() => onCreate('proposal')}>
              Proposal
            </button>
            <button className="secondary" onClick={() => onCreate('quote')}>
              Custom quote
            </button>
            <button className="secondary" onClick={() => onCreate('workorder')}>
              Work order
            </button>
            <button className="secondary" onClick={() => onCreate('handoff')}>
              Accept handoff
            </button>
          </>
        )}
      </div>
      {r.kind === 'opportunity' && (
        <div className="info-strip">
          <Clock3 size={16} />
          Last actual contact:{' '}
          {contacts[0]
            ? formatDate(contacts[0].data.occurredAt)
            : 'No contact event logged'}{' '}
          · Acknowledgment target: {formatDate(r.data.acknowledgmentDue)}
        </div>
      )}
      <dl className="details-grid">
        {Object.entries(r.data)
          .filter(([, v]) => v !== null && v !== '' && v !== undefined)
          .map(([k, v]) => (
            <div key={k}>
              <dt>
                {fields[r.kind]?.find((f) => f[0] === k)?.[1] ||
                  k.replace(/([A-Z])/g, ' $1')}
              </dt>
              <dd>
                {typeof v === 'string' && /^https:\/\//.test(v) ? (
                  <a href={v} target="_blank" rel="noreferrer">
                    {v}
                    <ArrowUpRight size={12} />
                  </a>
                ) : typeof v === 'object' ? (
                  <pre>{JSON.stringify(v, null, 2)}</pre>
                ) : (
                  String(v)
                )}
              </dd>
            </div>
          ))}
      </dl>
      {['offer', 'proposal', 'research', 'quote'].includes(r.kind) &&
        (member?.role === 'owner' || member?.commercial) && (
          <div className="approval-box">
            <h3>Commercial decision</h3>
            <p>
              Approval attaches to revision {r.revision}. Catalogue, proposal
              and outreach decisions are separate.
            </p>
            <label>
              Decision reason
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
              />
            </label>
            <div className="button-row">
              {['approved', 'changes requested', 'declined'].map((d) => (
                <button
                  key={d}
                  className={d === 'approved' ? 'primary' : 'secondary'}
                  disabled={busy || !reason}
                  onClick={async () => {
                    setBusy(true)
                    setError('')
                    try {
                      await api({
                        action: 'decide',
                        id: r.id,
                        revision: r.revision,
                        decision: d,
                        reason,
                      })
                      await reload()
                      setReason('')
                    } catch (e) {
                      setError(errorMessage(e))
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {d === 'approved'
                    ? 'Approve'
                    : d === 'declined'
                      ? 'Decline'
                      : 'Request changes'}
                </button>
              ))}
            </div>
          </div>
        )}
      {linked.length > 0 && (
        <>
          <h3 className="linked-title">Linked records & history</h3>
          <div className="linked-records">
            {linked.map((x) => (
              <div key={x.id}>
                <span className="badge">{labels[x.kind]}</span>
                <strong>{x.title}</strong>
                <small>{formatDate(x.createdAt)}</small>
                <p>
                  {x.data.notes ||
                    x.data.reason ||
                    x.data.result ||
                    x.data.nextAction ||
                    x.data.reference}
                </p>
                <code>{x.id}</code>
              </div>
            ))}
          </div>
        </>
      )}
      {['owner', 'manager'].includes(member?.role || '') && (
        <button
          className="text-button"
          onClick={async () => {
            try {
              const result = await api({ action: 'audit', id: r.id })
              if (
                !Array.isArray(result) ||
                !result.every(
                  (item): item is AuditEntry =>
                    isObject(item) &&
                    typeof item.id === 'string' &&
                    typeof item.action === 'string' &&
                    typeof item.actorId === 'string' &&
                    typeof item.createdAt === 'string',
                )
              )
                throw Error('The audit response was incomplete.')
              setHistory(result)
            } catch (e) {
              setError(errorMessage(e))
            }
          }}
        >
          View audit history
          <ArrowRight size={15} />
        </button>
      )}
      {history && (
        <div className="audit-list">
          {history.map((a) => (
            <div key={a.id}>
              <strong>{a.action}</strong> · {formatDate(a.createdAt)}
              <small>Actor {a.actorId}</small>
              <pre>{JSON.stringify(a.after, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </>
  )
}
function SettingsView({
  member,
  staff,
  calendar,
  api,
  reload,
  notice,
  create,
}: Omit<SharedProps, 'records'> & {
  calendar: typeof calendarDefault
  notice: (message: string) => void
  create: (kind: string) => void
}) {
  const [tab, setTab] = useState('Staff access'),
    [busy, setBusy] = useState(false)
  return (
    <>
      <div className="section-tabs">
        {['Staff access', 'Business calendar', 'Workspace guide'].map((t) => (
          <button
            className={tab === t ? 'selected' : ''}
            onClick={() => setTab(t)}
            key={t}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="settings-layout">
        <section className="panel settings-panel">
          {tab === 'Staff access' ? (
            <>
              <h2>People & responsibilities</h2>
              <p className="muted">
                Individual accounts. Explicit permissions. Commercial and HR
                authority are granted separately from sales management.
              </p>
              {staff.map((s) => (
                <div className="staff-row" key={s.id}>
                  <span className="avatar">{s.name[0]}</span>
                  <div>
                    <strong>{s.name}</strong>
                    <small>{s.email}</small>
                    <code>{s.id}</code>
                  </div>
                  <span className="badge">{s.role}</span>
                  <span className="badge">
                    {s.active ? 'Active' : 'Inactive'}
                  </span>
                  {s.commercial && <ShieldCheck size={18} />}
                  {(s.role === 'owner' || s.hr) && (
                    <span className="badge">HR access</span>
                  )}
                </div>
              ))}
              {!staff.length && (
                <p className="muted">Sign in to see permitted staff records.</p>
              )}
              {member?.role === 'owner' && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault()
                    setBusy(true)
                    const f = new FormData(e.currentTarget)
                    try {
                      await api({
                        action: 'staff',
                        ...Object.fromEntries(f),
                        commercial: f.get('commercial') === 'on',
                        hr: f.get('hr') === 'on',
                        active: f.get('active') === 'on',
                      })
                      await reload()
                      notice('Staff membership saved.')
                    } catch (err) {
                      notice(errorMessage(err))
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  <h3>Grant or update staff membership</h3>
                  <p className="muted">
                    Invite the person through Netlify Identity first. Copy their
                    verified user UUID from the account detail.
                  </p>
                  <div className="form-grid">
                    <label>
                      Identity user UUID
                      <input name="id" required />
                    </label>
                    <label>
                      Verified email
                      <input name="email" type="email" required />
                    </label>
                    <label>
                      Display name
                      <input name="name" required />
                    </label>
                    <label>
                      Application role
                      <select name="role">
                        {[
                          'manager',
                          'contributor',
                          'delivery',
                          'viewer',
                          'owner',
                        ].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="check-label">
                    <input type="checkbox" name="active" defaultChecked />
                    Active membership
                  </label>
                  <label className="check-label">
                    <input type="checkbox" name="commercial" />
                    Explicit commercial approval authority
                  </label>
                  <label className="check-label">
                    <input type="checkbox" name="hr" />
                    Restricted HR access (applications, assessments, and
                    onboarding)
                  </label>
                  <button disabled={busy} className="primary">
                    Save membership
                  </button>
                </form>
              )}
            </>
          ) : tab === 'Business calendar' ? (
            <>
              <h2>Business-day targets</h2>
              <p>
                One business day for inquiry acknowledgment and discovery
                documentation. No automatic no-response closure.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  try {
                    await api({
                      action: 'settings',
                      data: {
                        timezone: 'America/New_York',
                        workingDays: f.getAll('days').map(Number),
                        holidays: String(f.get('holidays'))
                          .split(/[,\n]/)
                          .map((x) => x.trim())
                          .filter(Boolean),
                        clock: 'same-local-time',
                        holdsPause: false,
                      },
                    })
                    await reload()
                    notice(
                      'Calendar saved. Existing deadlines retain their original commitment.',
                    )
                  } catch (err) {
                    notice(errorMessage(err))
                  }
                }}
              >
                <label>
                  Operating timezone
                  <input readOnly value="America/New_York" />
                </label>
                <h3>Working days</h3>
                <div className="weekday-list">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
                    (d, i) => (
                      <label key={d} className="check-label">
                        <input
                          type="checkbox"
                          name="days"
                          value={i}
                          defaultChecked={calendar.workingDays.includes(i)}
                          disabled={member?.role !== 'owner'}
                        />
                        {d}
                      </label>
                    ),
                  )}
                </div>
                <label>
                  Non-working holidays (YYYY-MM-DD, one per line)
                  <textarea
                    name="holidays"
                    defaultValue={calendar.holidays.join('\n')}
                    readOnly={member?.role !== 'owner'}
                  />
                </label>
                <div className="info-strip">
                  Initial rule: same local clock time on the next working date;
                  Monday–Friday; no holidays configured. Hold clocks continue.
                  Changes affect newly calculated commitments.
                </div>
                {member?.role === 'owner' && (
                  <button className="primary">Save calendar</button>
                )}
              </form>
            </>
          ) : (
            <>
              <h2>A considered sales process</h2>
              <p>
                Project Studio uses immutable S1–S9 stage codes, H1–H3 holds,
                and X1–X4 closures. Founder approval is required before
                proposals and research outreach.
              </p>
              <p>
                Research is separate from the pipeline. Notes never count as
                contact. S9 records accepted delivery responsibility and does
                not mean payment was collected.
              </p>
              <h3>Start with the relationship</h3>
              <div className="button-row">
                <button
                  className="secondary"
                  onClick={() => create('organization')}
                >
                  Add organization
                </button>
                <button className="secondary" onClick={() => create('contact')}>
                  Add contact
                </button>
              </div>
              <h3>Source review</h3>
              <p>
                The October 2026 CRM workbook and Todor’s October 19 pricing
                review informed this release. Blank identifiers and EXAMPLE rows
                were excluded. No prototype was supplied.
              </p>
              <h3>Export & recovery</h3>
              <p>
                Export produces a permission-filtered CSV containing IDs, linked
                record IDs, versions, and JSON details. Store exports securely.
                Database restoration requires an authorized platform
                administrator. CSV import currently supports research only and
                is not a full restore operation.
              </p>
            </>
          )}
        </section>
        <aside className="panel settings-aside">
          <ShieldCheck size={24} />
          <h3>Access is intentional.</h3>
          <p>
            The owner manages staff access. A sales manager manages the
            pipeline. Assignment alone never grants commercial authority.
          </p>
          <hr />
          <h4>Configurable responsibilities</h4>
          <p>
            Lyric: intended owner & approver.
            <br />
            Todor: sales workflow.
            <br />
            Kenny: operational oversight.
            <br />
            Adit: capacity & work orders.
          </p>
          <p className="muted">
            Map responsibilities to verified staff accounts; names alone confer
            no permissions.
          </p>
        </aside>
      </div>
    </>
  )
}
// RFC 4180 CSV parser supports quoted commas, newlines, and escaped quotes.
function parseCSV(text: string) {
  const rows: string[][] = []
  let row: string[] = [],
    cell = '',
    quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = !quoted
    } else if (c === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  if (quoted) throw Error('CSV contains an unclosed quote')
  return rows
}
function Importer({
  records,
  member,
  api,
  reload,
}: Omit<SharedProps, 'staff'>) {
  const [rows, setRows] = useState<string[][]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [result, setResult] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState('')
  const keys = [
    'sourceId',
    'organization',
    'sourceUrl',
    'location',
    'service',
    'fitRationale',
    'contactRoute',
    'sourceCategory',
    'sourcedBy',
    'nextAction',
    'nextDue',
  ]
  const preview = rows.slice(1).map((r, i) => {
    const get = (k: string) =>
      mapping[k] !== undefined && mapping[k] !== ''
        ? r[Number(mapping[k])] || ''
        : ''
    const data = Object.fromEntries(keys.map((k) => [k, get(k)]))
    let status = 'Accepted'
    if (
      !data.organization ||
      Object.values(data).some((v) => /\bEXAMPLE\b/i.test(v))
    )
      status = 'Skipped'
    else if (
      !data.sourceId ||
      !data.sourceUrl.startsWith('https://') ||
      !data.location ||
      !data.service ||
      !data.fitRationale ||
      !data.contactRoute ||
      !data.sourceCategory ||
      !data.nextAction ||
      !data.nextDue ||
      Number.isNaN(Date.parse(data.nextDue))
    )
      status = 'Invalid'
    else if (
      records.some((x) => x.sourceKey === `${source}:${data.sourceId}`) ||
      rows
        .slice(1, i + 1)
        .some((p) => p[Number(mapping.sourceId)] === data.sourceId) ||
      records.some(
        (x) =>
          x.kind === 'organization' &&
          normalize(x.data.website) === normalize(data.sourceUrl) &&
          x.sourceKey !== `${source}:${data.sourceId}:org`,
      )
    )
      status = 'Duplicate'
    return { data, status, index: i + 2 }
  })
  return (
    <>
      <div className="eyebrow">RESEARCH · CONTROLLED IMPORT</div>
      <h2>Review before you import.</h2>
      <p className="muted">
        Research CSV only. Blank numbered rows and EXAMPLE records are skipped.
        Existing source identifiers are never silently duplicated. No outreach
        occurs.
      </p>
      {!['owner', 'manager'].includes(member?.role || '') ? (
        <p>Imports require manager or owner access.</p>
      ) : (
        <>
          <label>
            Stable source name (reuse on every re-import)
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="For example: October research list"
              required
            />
          </label>
          <label>
            Research CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                try {
                  const file = e.target.files?.[0]
                  if (!file) return
                  if (file.size > 400000)
                    throw Error(
                      'Please use a CSV smaller than 400 KB per batch',
                    )
                  setRows(parseCSV(await file.text()))
                  setMapping({})
                  setResult([])
                  setError('')
                } catch (err) {
                  setError(errorMessage(err))
                }
              }}
            />
          </label>
          {rows.length > 0 && (
            <>
              <div className="form-grid">
                {keys.map((k) => (
                  <label key={k}>
                    {k}
                    <select
                      value={mapping[k] ?? ''}
                      onChange={(e) =>
                        setMapping({ ...mapping, [k]: e.target.value })
                      }
                    >
                      <option value="">Map column…</option>
                      {rows[0].map((h, i) => (
                        <option value={i} key={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="import-counts">
                {['Accepted', 'Skipped', 'Duplicate', 'Invalid'].map((s) => (
                  <span key={s}>
                    {s}: <b>{preview.filter((r) => r.status === s).length}</b>
                  </span>
                ))}
              </div>
              <div className="import-preview">
                {preview.map((r) => (
                  <div key={r.index}>
                    <span>Row {r.index}</span>
                    <strong>
                      {r.data.organization || 'Blank numbered row'}
                    </strong>
                    <span className="badge">{r.status}</span>
                  </div>
                ))}
              </div>
              <button
                className="primary"
                disabled={
                  !source ||
                  busy ||
                  !preview.some((r) => r.status === 'Accepted')
                }
                onClick={async () => {
                  setBusy(true)
                  setError('')
                  const summary: string[] = []
                  for (const row of preview) {
                    if (row.status !== 'Accepted') continue
                    try {
                      const key = `${source}:${row.data.sourceId}`
                      let org = records.find(
                        (r) =>
                          r.kind === 'organization' &&
                          r.sourceKey === `${key}:org`,
                      )
                      if (!org) {
                        const saved = await api({
                          action: 'save',
                          record: {
                            kind: 'organization',
                            title: row.data.organization,
                            sourceKey: `${key}:org`,
                            data: {
                              location: row.data.location,
                              website: row.data.sourceUrl,
                              importSource: source,
                              originalSourceId: row.data.sourceId,
                            },
                          },
                        })
                        if (!isObject(saved) || !isRecord(saved.record))
                          throw Error(
                            'The organization response was incomplete.',
                          )
                        org = saved.record
                      }
                      await api({
                        action: 'save',
                        record: {
                          kind: 'research',
                          title: row.data.organization,
                          organizationId: org.id,
                          sourceKey: key,
                          data: {
                            ...row.data,
                            importSource: source,
                            originalSourceId: row.data.sourceId,
                            importRow: row.index,
                            importedAt: new Date().toISOString(),
                            contactPermission: 'Unknown',
                            duplicateStatus: 'Not reviewed',
                          },
                        },
                      })
                      summary.push(`Row ${row.index}: imported`)
                    } catch (e) {
                      summary.push(
                        `Row ${row.index}: failed — ${errorMessage(e)}`,
                      )
                    }
                  }
                  try {
                    await api({
                      action: 'import-summary',
                      source,
                      summary,
                      counts: Object.fromEntries(
                        ['Accepted', 'Skipped', 'Duplicate', 'Invalid'].map(
                          (s) => [
                            s,
                            preview.filter((r) => r.status === s).length,
                          ],
                        ),
                      ),
                    })
                  } catch (e) {
                    setError(
                      'Records were processed, but summary persistence failed: ' +
                        errorMessage(e),
                    )
                  }
                  setResult(summary)
                  await reload()
                  setBusy(false)
                }}
              >
                {busy ? 'Importing…' : 'Import accepted rows'}
              </button>
            </>
          )}
          {result.length > 0 && (
            <div className="import-summary">
              <h3>Import summary</h3>
              {result.map((s) => (
                <p key={s}>{s}</p>
              ))}
              <button
                className="secondary"
                onClick={() => {
                  const u = URL.createObjectURL(
                    new Blob([result.join('\n')], { type: 'text/plain' }),
                  )
                  const a = document.createElement('a')
                  a.href = u
                  a.download = 'emerson-import-summary.txt'
                  a.click()
                  URL.revokeObjectURL(u)
                }}
              >
                Download summary
              </button>
            </div>
          )}
        </>
      )}
      {error && <p className="form-error">{error}</p>}
    </>
  )
}
