import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  Plus,
  X,
  Copy,
  ExternalLink,
  Users,
  BookOpen,
  Upload,
  ArrowRight,
} from 'lucide-react'
import { RecordSelector } from './record-selector'
import { EducationClearancePanel } from './education-clearance'
import type { JsonValue, RecordData, RecordEnvelope } from '../lib/crm-types'
import './foundation-workspace.css'
import {
  affiliations,
  workflows as workflowStages,
  workflowLabels,
  contactPermissions,
  resourceStatuses,
  learningProgress,
  isHrWorkflow,
} from '../lib/foundation'

export type FoundationRecord = {
  id: string
  kind: string
  title: string
  ownerId: string | null
  revision: number
  parentId?: string | null
  organizationId?: string | null
  access?: string
  data: RecordData
}
type Member = {
  id: string
  name?: string
  role: string
  hr?: boolean
  active?: boolean
}
export type FoundationSection =
  'Directory' | 'Workflows' | 'Import review' | 'Library'
type Props = {
  section: FoundationSection
  records: FoundationRecord[]
  member: Member
  staff: Member[]
  api: (body: object) => Promise<unknown>
  reload: () => Promise<unknown>
  onOpenLegacy?: (kind: string) => void
  syntheticEducation?: boolean
  syntheticWebsiteIntake?: boolean
}
type Draft = {
  kind: string
  original?: FoundationRecord
  data?: RecordData
}
const workflowNames: Record<string, string> = workflowLabels
const permissions = [...contactPermissions]
const labels: Record<string, string> = {
  contact: 'Person',
  organization: 'Organization',
  affiliation: 'Affiliation',
  engagement: 'Relationship',
  application: 'Application',
  resource: 'Library resource',
  learning: 'Learning assignment',
}
const statuses = [...resourceStatuses]
const intakeFields = [
  ['sourceId', 'Stable source row ID'],
  ['name', 'Person name'],
  ['email', 'Email'],
  ['organization', 'Organization'],
  ['sourceUrl', 'Source URL'],
  ['sourceVersion', 'Source version / tab'],
  ['sourceRow', 'Original source row'],
  ['nextAction', 'Next action'],
  ['nextDue', 'Next due'],
  ['contactPermission', 'Contact permission'],
  ['permissionEvidence', 'Marketing permission evidence URL'],
] as const
const applicantIntakeFields = [
  ['applicantId', 'Original applicant ID'],
  ['program', 'Program'],
  ['cohort', 'Cohort'],
  ['resumeUrl', 'Restricted r�sum� source URL'],
  ['onboardingStatus', 'Source onboarding status (descriptive)'],
] as const
const human = (value: unknown) =>
  String(value ?? '').replace(/([a-z])([A-Z])/g, '$1 $2')
const iso = (value: string) => (value ? new Date(value).toISOString() : '')
const localDate = (value: unknown) => {
  if (!value || Number.isNaN(new Date(String(value)).getTime())) return ''
  const d = new Date(String(value))
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}
const safeHttps = (value: unknown) => {
  try {
    const url = new URL(String(value))
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** This module only receives the current server-authorized snapshot. It has no persistent client cache. */
export function FoundationWorkspace(props: Props) {
  return (
    <FoundationContent key={`${props.member.id}:${props.section}`} {...props} />
  )
}

function FoundationContent(props: Props) {
  const { section, records, member, api, reload, onOpenLegacy } = props
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('All')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [selected, setSelected] = useState<FoundationRecord | null>(null)
  const [notice, setNotice] = useState('')
  const hr = member.role === 'owner' || !!member.hr
  const canWrite = member.role !== 'viewer'
  const resources = records.filter((r) => r.kind === 'resource')
  const find = (id?: string | null) => records.find((r) => r.id === id)
  const display = (id?: string | null) =>
    find(id)?.title || (id ? 'Restricted or unavailable record' : '—')
  const visible = (rows: FoundationRecord[]) =>
    rows.filter((r) =>
      `${r.title} ${r.data.email || ''} ${r.data.workflow || ''}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
  const save = async (record: RecordEnvelope) => {
    await api({ action: 'foundation-save', record })
    setDraft(null)
    setSelected(null)
    await reload()
  }
  const openNew = (kind: string, data?: RecordData) => {
    setNotice('')
    setDraft({ kind, data })
  }
  const toolbar = (actions: ReactNode) => (
    <div className="foundation-toolbar">
      <label className="foundation-search">
        <span className="sr-only">Search {section.toLowerCase()}</span>
        <input
          type="search"
          value={query}
          placeholder={`Search ${section.toLowerCase()}…`}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="foundation-actions">{actions}</div>
    </div>
  )
  const tabs = (items: [string, string][]) => (
    <div className="foundation-tabs" aria-label={`${section} filters`}>
      {items.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={tab === value ? 'active' : ''}
          aria-pressed={tab === value}
          onClick={() => setTab(value)}
        >
          {label}
        </button>
      ))}
    </div>
  )
  const newButton = (kind: string, text: string, data?: RecordData) =>
    canWrite ? (
      <button
        type="button"
        className="primary"
        onClick={() => openNew(kind, data)}
      >
        <Plus size={15} />
        {text}
      </button>
    ) : null
  const directory = records.filter((r) =>
    ['contact', 'organization', 'affiliation'].includes(r.kind),
  )
  const workflows = records.filter(
    (r) => r.kind === 'engagement' || (r.kind === 'application' && hr),
  )
  return (
    <div className="foundation-workspace">
      {notice && (
        <p role="status" className="foundation-notice">
          {notice}
        </p>
      )}
      {section === 'Directory' && (
        <>
          <Intro
            icon={<Users size={19} />}
            title="One directory. Many relationships."
            text="Keep a person once, then link their organizations, services, classes and applications. Contact permission follows the person; an inquiry is not marketing consent."
          />
          {toolbar(
            <>
              {newButton('contact', 'Add person')}
              {newButton('organization', 'Add organization')}
              {newButton('affiliation', 'Link affiliation')}
            </>,
          )}
          {tabs([
            ['All', `All (${directory.length})`],
            ['contact', 'People'],
            ['organization', 'Organizations'],
            ['affiliation', 'Affiliations'],
          ])}
          <RecordList
            rows={visible(
              directory.filter((r) => tab === 'All' || r.kind === tab),
            )}
            empty="Your shared directory is ready"
            help="Add a person or organization, or review a mapped import. Existing CRM contacts are reused here."
            columns={['Record', 'Relationship / email', 'Visibility']}
            onOpen={setSelected}
            render={(r) => (
              <>
                <td>
                  <button
                    className="foundation-record"
                    onClick={() => setSelected(r)}
                  >
                    {r.title}
                  </button>
                  <small>{labels[r.kind]}</small>
                </td>
                <td>
                  {r.kind === 'affiliation' ? (
                    <>
                      {display(r.data.personId)} → {display(r.organizationId)}
                      <small>{r.data.relationship || r.data.role}</small>
                    </>
                  ) : r.kind === 'contact' ? (
                    <>
                      {r.data.email || 'No email'}
                      <small>
                        {r.data.contactPermission || 'Unknown permission'}
                      </small>
                    </>
                  ) : (
                    r.data.website || 'No website'
                  )}
                </td>
                <td>
                  <span className="foundation-badge">
                    {r.access === 'hr'
                      ? 'HR restricted'
                      : r.access === 'team'
                        ? 'Team'
                        : 'Assigned / readers'}
                  </span>
                </td>
              </>
            )}
          />
        </>
      )}
      {section === 'Workflows' && (
        <>
          <Intro
            title="A clear next step for every relationship"
            text="Class participation, partnerships, investment conversations and applications have separate progress. These counts do not represent revenue or payment."
          />
          {toolbar(
            <>
              {onOpenLegacy && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onOpenLegacy('opportunity')}
                >
                  Service opportunities <ArrowRight size={15} />
                </button>
              )}
              {newButton('engagement', 'Add relationship', {
                workflow: 'class',
              })}
              {hr &&
                newButton('application', 'Add application', {
                  workflow: 'program',
                })}
            </>,
          )}
          {tabs([
            ['All', 'All workflows'],
            ...Object.entries(workflowNames).filter(
              ([key]) => hr || !['program', 'sales'].includes(key),
            ),
          ])}
          <div className="foundation-metrics">
            {Object.entries(workflowNames)
              .filter(([key]) => hr || !['program', 'sales'].includes(key))
              .map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-pressed={tab === key}
                >
                  <strong>
                    {workflows.filter((r) => r.data.workflow === key).length}
                  </strong>
                  <span>{label}</span>
                </button>
              ))}
          </div>
          {!hr && (
            <p className="foundation-help">
              Applicant records are visible only to authorized HR staff.
            </p>
          )}
          <RecordList
            rows={visible(
              workflows.filter((r) => tab === 'All' || r.data.workflow === tab),
            )}
            empty="No relationships in this view"
            help="Create the linked person first, then add the appropriate workflow and next action."
            columns={['Relationship', 'Workflow / stage', 'Next action']}
            onOpen={setSelected}
            render={(r) => (
              <>
                <td>
                  <button
                    className="foundation-record"
                    onClick={() => setSelected(r)}
                  >
                    {r.title}
                  </button>
                  <small>
                    {display(r.data.personId)}
                    {r.organizationId ? ` · ${display(r.organizationId)}` : ''}
                  </small>
                </td>
                <td>
                  {workflowNames[r.data.workflow || ''] || r.data.workflow}
                  <small>
                    <span className="foundation-badge">
                      {r.data.stage || 'New'}
                    </span>
                  </small>
                </td>
                <td>
                  {r.data.nextAction || 'No next action'}
                  <small>
                    {r.data.nextDue
                      ? new Date(r.data.nextDue).toLocaleString()
                      : 'No due date'}
                  </small>
                </td>
              </>
            )}
          />
        </>
      )}
      {section === 'Import review' && (
        <ImportReview {...props} onNotice={setNotice} />
      )}
      {section === 'Library' && (
        <>
          <Intro
            icon={<BookOpen size={19} />}
            title="Approved knowledge, ready to use"
            text="Store reusable templates, training videos and worksheets with their source and version. Drafts remain visible as drafts. Copying a template does not send an email."
          />
          {toolbar(
            <>
              {newButton('resource', 'Add resource', {
                resourceType: 'template',
                status: 'Draft',
                audience: 'team',
              })}
              {canWrite &&
                ['owner', 'manager'].includes(member.role) &&
                newButton('learning', 'Assign training', {
                  progress: 'Not started',
                })}
            </>,
          )}
          {tabs([
            ['All', 'All resources'],
            ['template', 'Templates'],
            ['training', 'Training'],
            ['learning', 'Assignments'],
          ])}
          {tab === 'learning' ? (
            <RecordList
              rows={visible(records.filter((r) => r.kind === 'learning'))}
              empty="No training assignments yet"
              help="Managers can assign approved training and verify completion after reviewing the submitted work."
              columns={['Assignment', 'Progress', 'Next action']}
              onOpen={setSelected}
              render={(r) => (
                <>
                  <td>
                    <button
                      className="foundation-record"
                      onClick={() => setSelected(r)}
                    >
                      {r.title}
                    </button>
                    <small>{display(r.data.resourceId)}</small>
                  </td>
                  <td>{r.data.progress || 'Not started'}</td>
                  <td>{r.data.nextAction || '—'}</td>
                </>
              )}
            />
          ) : (
            <div className="foundation-library">
              {visible(
                resources.filter(
                  (r) => tab === 'All' || r.data.resourceType === tab,
                ),
              ).map((r) => (
                <article key={r.id} className="foundation-resource">
                  <div className="foundation-resource-top">
                    <span className="foundation-badge">
                      {r.data.resourceType === 'training'
                        ? 'Training'
                        : 'Template'}
                    </span>
                    <span
                      className={`foundation-badge ${r.data.status === 'Approved' ? 'approved' : ''}`}
                    >
                      {r.data.status || 'Draft'}
                    </span>
                  </div>
                  <h2>
                    <button
                      className="foundation-record"
                      onClick={() => setSelected(r)}
                    >
                      {r.title}
                    </button>
                  </h2>
                  <p>
                    {String(
                      r.data.body ||
                        'Linked resource. Open details to view its source and version.',
                    ).slice(0, 170)}
                  </p>
                  <div className="foundation-resource-meta">
                    Version {r.data.version || 1} ·{' '}
                    {r.data.audience === 'hr' ? 'HR restricted' : 'Team'}
                  </div>
                  <div className="foundation-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setSelected(r)}
                    >
                      View resource
                    </button>
                    {r.data.resourceType === 'template' &&
                      r.data.status === 'Approved' &&
                      !!r.data.body && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={async () => {
                            try {
                              if (!navigator.clipboard)
                                throw Error(
                                  'Clipboard is unavailable. Open the resource to select its text.',
                                )
                              await navigator.clipboard.writeText(
                                String(r.data.body || ''),
                              )
                              setNotice(
                                'Approved template copied. Review recipients, context and contact permission before using it.',
                              )
                            } catch (error) {
                              setNotice(
                                error instanceof Error
                                  ? error.message
                                  : 'Unable to copy. Open the resource and select its text.',
                              )
                            }
                          }}
                        >
                          <Copy size={14} /> Copy text
                        </button>
                      )}
                  </div>
                </article>
              ))}
              {!visible(
                resources.filter(
                  (r) => tab === 'All' || r.data.resourceType === tab,
                ),
              ).length && (
                <Empty
                  title="Your library starts with approved sources"
                  help="Add an existing worksheet, video link or email template. Resources need review before approval."
                />
              )}
            </div>
          )}
        </>
      )}
      {selected && (
        <FoundationDialog
          title={selected.title}
          onClose={() => setSelected(null)}
        >
          <div className="foundation-detail-tags">
            <span className="foundation-badge">
              {labels[selected.kind] || selected.kind}
            </span>
            <span className="foundation-badge">
              {selected.access === 'hr' || selected.kind === 'application'
                ? 'HR restricted'
                : selected.access === 'team'
                  ? 'Team'
                  : 'Assigned / readers'}
            </span>
            <span>Revision {selected.revision}</span>
          </div>
          <dl className="foundation-details">
            {Object.entries(selected.data)
              .filter(
                ([key, value]) =>
                  value !== '' &&
                  value !== null &&
                  value !== undefined &&
                  !['approvalBy', 'approvedBy'].includes(key),
              )
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{human(key)}</dt>
                  <dd>
                    {['personId', 'resourceId', 'organizationId'].includes(
                      key,
                    ) ? (
                      display(String(value))
                    ) : key === 'assigneeId' ? (
                      props.staff.find((s) => s.id === value)?.name ||
                      'Staff member'
                    ) : safeHttps(value) && /url$/i.test(key) ? (
                      <a
                        href={safeHttps(value)!}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open linked source <ExternalLink size={12} />
                      </a>
                    ) : typeof value === 'object' ? (
                      JSON.stringify(value)
                    ) : (
                      String(value)
                    )}
                  </dd>
                </div>
              ))}
          </dl>
          {selected.organizationId && (
            <p>Organization: {display(selected.organizationId)}</p>
          )}
          {props.syntheticEducation &&
            hr &&
            canWrite &&
            selected.kind === 'application' &&
            selected.id === '82000000-0000-4000-8000-000000000001' &&
            selected.access === 'hr' &&
            selected.data.educationFixture === true &&
            selected.data.workflow === 'program' && (
              <EducationClearancePanel applicationId={selected.id} api={api} />
            )}
          <div className="foundation-actions">
            {canWrite && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setDraft({ kind: selected.kind, original: selected })
                  setSelected(null)
                }}
              >
                {selected.kind === 'resource' &&
                selected.data.status === 'Approved'
                  ? 'Create next version'
                  : 'Edit record'}
              </button>
            )}
            {selected.kind === 'contact' && canWrite && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  openNew('affiliation', { personId: selected.id })
                  setSelected(null)
                }}
              >
                Link organization
              </button>
            )}
          </div>
        </FoundationDialog>
      )}
      {draft && (
        <RecordEditor
          {...props}
          draft={draft}
          onClose={() => setDraft(null)}
          onSave={save}
        />
      )}
    </div>
  )
}

function Intro({
  title,
  text,
  icon,
}: {
  title: string
  text: string
  icon?: ReactNode
}) {
  return (
    <div className="foundation-intro">
      <div>
        {icon}
        <h2>{title}</h2>
      </div>
      <p>{text}</p>
    </div>
  )
}
function Empty({ title, help }: { title: string; help: string }) {
  return (
    <div className="foundation-empty">
      <h3>{title}</h3>
      <p>{help}</p>
    </div>
  )
}
function RecordList({
  rows,
  columns,
  render,
  empty,
  help,
}: {
  rows: FoundationRecord[]
  columns: string[]
  render: (r: FoundationRecord) => ReactNode
  onOpen?: (r: FoundationRecord) => void
  empty: string
  help: string
}) {
  return rows.length ? (
    <div className="foundation-table">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>{render(r)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title={empty} help={help} />
  )
}

function FoundationDialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const dialog = ref.current
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ) || [],
      ).filter((el) => !el.hasAttribute('hidden'))
    focusable()[0]?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const list = focusable(),
        first = list[0],
        last = list[list.length - 1]
      if (!first) {
        event.preventDefault()
        dialog?.focus()
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog?.addEventListener('keydown', keydown)
    return () => {
      dialog?.removeEventListener('keydown', keydown)
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return (
    <div
      className="modal-overlay foundation-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="modal wide foundation-dialog"
      >
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="modal-close icon-btn"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        {children}
      </div>
    </div>
  )
}

function RecordEditor({
  draft,
  records,
  member,
  staff,
  onClose,
  onSave,
}: Props & {
  draft: Draft
  onClose: () => void
  onSave: (record: RecordEnvelope) => Promise<void>
}) {
  const original = draft.original
  const newVersion =
    original?.kind === 'resource' && original.data.status === 'Approved'
  const [title, setTitle] = useState(original?.title || '')
  const [data, setData] = useState<RecordData>(() => ({
    contactPermission: 'Unknown',
    ...(['engagement', 'application'].includes(draft.kind)
      ? { stage: draft.kind === 'application' ? 'Applied' : 'New' }
      : {}),
    ...(original?.data || draft.data || {}),
    ...(newVersion
      ? {
          familyId: original?.data.familyId || original?.id,
          version: Number(original?.data.version || 1) + 1,
          status: 'Draft',
          approvedAt: undefined,
          approvedBy: undefined,
          approvalReason: '',
        }
      : {}),
  }))
  const [ownerId, setOwnerId] = useState(original?.ownerId || member.id)
  const [organizationId, setOrganizationId] = useState(
    original?.organizationId || '',
  )
  const [access, setAccess] = useState(
    draft.kind === 'application'
      ? 'hr'
      : original
        ? original.access || 'record'
        : 'team',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hr = member.role === 'owner' || !!member.hr
  const set = (key: string, value: JsonValue | undefined) =>
    setData((current) => ({ ...current, [key]: value }))
  const field = (
    key: string,
    label: string,
    type = 'text',
    required = false,
    options?: readonly string[],
    help?: string,
  ) => (
    <label
      key={key}
      className={
        type === 'textarea'
          ? 'foundation-field foundation-full'
          : 'foundation-field'
      }
    >
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      {options ? (
        <select
          value={String(data[key] ?? '')}
          disabled={
            draft.kind === 'resource' &&
            !!original &&
            ['resourceType', 'audience'].includes(key)
          }
          onChange={(e) => set(key, e.target.value)}
          required={required}
        >
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : type === 'textarea' ? (
        <textarea
          rows={5}
          value={String(data[key] ?? '')}
          onChange={(e) => set(key, e.target.value)}
          required={required}
        />
      ) : (
        <input
          type={type}
          value={
            type === 'datetime-local'
              ? localDate(data[key])
              : String(data[key] ?? '')
          }
          onChange={(e) =>
            set(
              key,
              type === 'datetime-local' && e.target.value
                ? iso(e.target.value)
                : e.target.value,
            )
          }
          required={required}
          {...(type === 'url'
            ? { pattern: 'https://.*', placeholder: 'https://…' }
            : {})}
        />
      )}
      {help && <small>{help}</small>}
    </label>
  )
  const selector = (
    key: string,
    label: string,
    kinds: string[],
    required = false,
  ) => (
    <div className="foundation-field" key={key}>
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      <RecordSelector
        label={label}
        value={String(data[key] ?? '')}
        required={required}
        options={records
          .filter(
            (r) =>
              kinds.includes(r.kind) &&
              (key !== 'resourceId' ||
                (r.data.resourceType === 'training' &&
                  r.data.status === 'Approved' &&
                  (!original ||
                    draft.kind !== 'learning' ||
                    r.id === original.data.resourceId))),
          )
          .map((r) => ({ id: r.id, label: r.title }))}
        onChange={(value) => set(key, value)}
      />
    </div>
  )
  const kind = draft.kind
  const isWorkflow = kind === 'engagement' || kind === 'application'
  const source = (
    <>
      {field('sourceName', 'Source name')}
      {field('sourceId', 'Source record ID')}
      {field('sourceUrl', 'Source URL', 'url')}
      {field('sourceVersion', 'Source version / tab / row')}
    </>
  )
  return (
    <FoundationDialog
      title={
        newVersion
          ? 'Create next resource version'
          : `${original ? 'Edit' : 'Add'} ${labels[kind]?.toLowerCase() || kind}`
      }
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setError('')
          setBusy(true)
          try {
            await onSave({
              ...(original && !newVersion
                ? { id: original.id, revision: original.revision }
                : {}),
              kind,
              title,
              ownerId,
              organizationId: organizationId || undefined,
              access:
                kind === 'application' || data.audience === 'hr'
                  ? 'hr'
                  : access,
              data: { ...data, ...(kind === 'contact' ? { name: title } : {}) },
            })
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : 'The record could not be saved.',
            )
            setBusy(false)
          }
        }}
      >
        <p className="foundation-help">
          {kind === 'application'
            ? 'HR restricted. Keep résumés and assessment notes in their approved restricted source.'
            : 'Use an existing person and source wherever possible. Changes are checked on the server.'}{' '}
          Dates use your device timezone.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <fieldset disabled={busy} className="foundation-form">
          <label className="foundation-field foundation-full">
            <span>{kind === 'contact' ? 'Person name' : 'Title'} *</span>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={250}
            />
          </label>
          <label className="foundation-field">
            <span>Record owner *</span>
            <select
              required
              value={ownerId}
              disabled={!['owner', 'manager'].includes(member.role)}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              {staff
                .filter((s) => s.active !== false)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.id}
                  </option>
                ))}
            </select>
          </label>
          {kind !== 'application' &&
            hr &&
            !['resource', 'learning'].includes(kind) && (
              <label className="foundation-field">
                <span>Visibility</span>
                <select
                  value={access}
                  onChange={(e) => setAccess(e.target.value)}
                >
                  <option value="record">Assigned / readers</option>
                  <option value="team">Team</option>
                  <option value="hr">HR restricted</option>
                </select>
              </label>
            )}
          {[
            'contact',
            'organization',
            'engagement',
            'application',
            'affiliation',
          ].includes(kind) &&
            kind !== 'organization' && (
              <div className="foundation-field">
                <span>Organization{kind === 'affiliation' ? ' *' : ''}</span>
                <RecordSelector
                  label="Organization"
                  required={kind === 'affiliation'}
                  options={records
                    .filter((r) => r.kind === 'organization')
                    .map((r) => ({ id: r.id, label: r.title }))}
                  value={organizationId}
                  onChange={setOrganizationId}
                />
              </div>
            )}
          {kind === 'contact' && (
            <>
              {field('email', 'Email', 'email')}
              {field('phone', 'Phone', 'tel')}
              {field(
                'contactPermission',
                'Contact permission',
                'text',
                true,
                permissions,
              )}
              {field(
                'permissionEvidence',
                'Marketing permission evidence URL',
                'url',
                data.contactPermission === 'Marketing permitted',
              )}
              {field('contactPreference', 'Preferred channel', 'text', false, [
                'Email',
                'Phone',
                'Other',
              ])}
              {source}
              {field('nextAction', 'Next action', 'text', true)}
              {field('nextDue', 'Next action due', 'datetime-local', true)}
              {field('notes', 'Shared contact notes', 'textarea')}
            </>
          )}
          {kind === 'organization' && (
            <>
              {field('website', 'Official website', 'url')}
              {field('location', 'Location')}
              {field('organizationType', 'Organization type', 'text', false, [
                'Company',
                'College',
                'School',
                'Community partner',
                'Investor',
                'Other',
              ])}
              {source}
              {field('nextAction', 'Next action', 'text', true)}
              {field('nextDue', 'Next action due', 'datetime-local', true)}
              {field('notes', 'Organization notes', 'textarea')}
            </>
          )}
          {kind === 'affiliation' && (
            <>
              {selector('personId', 'Person', ['contact'], true)}
              {field(
                'relationship',
                'Relationship',
                'text',
                true,
                affiliations,
              )}
              {field('jobTitle', 'Role / job title')}
              {field('nextAction', 'Next action', 'text', true)}
              {field('nextDue', 'Next action due', 'datetime-local', true)}
              {source}
            </>
          )}
          {isWorkflow && (
            <>
              {selector('personId', 'Person', ['contact'], true)}
              <label className="foundation-field">
                <span>Workflow *</span>
                <select
                  required
                  disabled={!!original}
                  value={data.workflow || ''}
                  onChange={(e) =>
                    setData((current) => ({
                      ...current,
                      workflow: e.target.value,
                      stage:
                        workflowStages[
                          e.target.value as keyof typeof workflowStages
                        ][0],
                    }))
                  }
                >
                  <option value="">Select…</option>
                  {Object.entries(workflowNames)
                    .filter(([key]) =>
                      kind === 'application'
                        ? ['program', 'sales'].includes(key)
                        : !['program', 'sales'].includes(key),
                    )
                    .map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
              {field(
                'stage',
                'Stage',
                'text',
                true,
                workflowStages[data.workflow as keyof typeof workflowStages] ||
                  [],
              )}
              {field('nextAction', 'Next action', 'text', true)}
              {field('nextDue', 'Next action due', 'datetime-local', true)}
              {source}
              {field(
                'contactPermission',
                'Contact permission',
                'text',
                false,
                permissions,
              )}
              {field(
                'permissionEvidence',
                'Marketing permission evidence URL',
                'url',
                data.contactPermission === 'Marketing permitted',
              )}
              {data.workflow === 'class' && (
                <>
                  {field('className', 'Public class / topic')}
                  {field('sessionDate', 'Session starts', 'datetime-local')}
                  {field('timezone', 'Session timezone')}
                  {field(
                    'registrationStatus',
                    'Registration status',
                    'text',
                    false,
                    ['Inquiry', 'Registered', 'Attended', 'Cancelled'],
                  )}
                  <p className="foundation-help foundation-full">
                    Registration does not prove payment. Internal staff training
                    belongs in the Library.
                  </p>
                </>
              )}
              {kind === 'application' && (
                <>
                  {field('applicantId', 'Source applicant ID')}
                  {field('program', 'Program / position')}
                  {field('cohort', 'Cohort')}
                  {field('resumeUrl', 'Restricted résumé source', 'url')}
                  {field(
                    'onboardingStatus',
                    'Onboarding status',
                    'text',
                    false,
                    [
                      'Not started',
                      'Invited',
                      'In progress',
                      'Ready for review',
                      'Complete',
                    ],
                    'Descriptive workflow status only. This does not grant HR clearance, learner enrollment, staff access or training completion.',
                  )}
                </>
              )}
              {field(
                'notes',
                kind === 'application'
                  ? 'Restricted application notes'
                  : 'Relationship notes',
                'textarea',
              )}
            </>
          )}
          {kind === 'resource' && (
            <>
              {field('resourceType', 'Resource type', 'text', true, [
                'template',
                'training',
              ])}
              {field(
                'status',
                'Status',
                'text',
                true,
                member.role === 'owner'
                  ? statuses
                  : statuses.filter((s) => s !== 'Approved'),
              )}
              {field(
                'audience',
                'Audience',
                'text',
                true,
                hr ? ['team', 'hr'] : ['team'],
              )}
              {field('category', 'Category / training module')}
              {field(
                'assetUrl',
                'Video / worksheet / source link',
                'url',
                false,
                undefined,
                'Use an approved HTTPS link. Drive permissions still apply.',
              )}
              {field(
                'body',
                data.resourceType === 'template'
                  ? 'Template text'
                  : 'Instructions / learning objectives',
                'textarea',
              )}
              {source}
              {member.role === 'owner' &&
                field(
                  'approvalReason',
                  'Approval / revision reason',
                  'textarea',
                  data.status === 'Approved',
                )}
              {data.status !== 'Approved' && (
                <>
                  {field('nextAction', 'Review next action', 'text', true)}
                  {field('nextDue', 'Review due', 'datetime-local', true)}
                </>
              )}
              <p className="foundation-help foundation-full">
                Approval is recorded by the server. Approved versions stay
                unchanged; later edits create another version. Pricing or
                compensation text needs its own valid approval.
              </p>
            </>
          )}
          {kind === 'learning' && (
            <>
              {selector(
                'resourceId',
                'Approved training resource',
                ['resource'],
                true,
              )}
              <label className="foundation-field">
                <span>Assigned staff *</span>
                <select
                  required
                  disabled={!!original}
                  value={data.assigneeId || ''}
                  onChange={(e) => set('assigneeId', e.target.value)}
                >
                  <option value="">Select…</option>
                  {staff
                    .filter((s) => s.active !== false)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name || s.id}
                      </option>
                    ))}
                </select>
              </label>
              {field(
                'progress',
                'Progress',
                'text',
                true,
                ['owner', 'manager'].includes(member.role)
                  ? learningProgress
                  : learningProgress.filter((p) => p !== 'Completed'),
              )}
              {field('worksheetUrl', 'Submitted worksheet link', 'url')}
              {field('nextAction', 'Next action', 'text', true)}
              {field('nextDue', 'Next action due', 'datetime-local', true)}
              {field('notes', 'Training notes', 'textarea')}
              <p className="foundation-help foundation-full">
                Learners submit work; a manager verifies completion. An
                assignment does not grant CRM access or sales authority.
              </p>
            </>
          )}
        </fieldset>
        <div className="form-footer">
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy
              ? 'Saving…'
              : newVersion
                ? 'Save new draft version'
                : 'Save record'}
          </button>
        </div>
      </form>
    </FoundationDialog>
  )
}

export function parseIntakeCSV(text: string): string[][] {
  const rows: string[][] = [],
    row: string[] = []
  let cell = '',
    quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (quoted || !cell) quoted = !quoted
      else
        throw Error('Unexpected quote in CSV. Use a standard UTF-8 CSV export.')
    } else if (!quoted && char === ',') {
      row.push(cell)
      cell = ''
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((v) => v.trim())) rows.push([...row])
      row.length = 0
      cell = ''
    } else cell += char
  }
  if (quoted) throw Error('CSV has an unfinished quoted value.')
  row.push(cell)
  if (row.some((v) => v.trim())) rows.push(row)
  if (rows[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, '')
  if (!rows.length || rows.length < 2)
    throw Error('Include a header row and at least one data row.')
  if (rows.length > 101)
    throw Error(
      'Review up to 100 rows per batch. Split the CSV before uploading.',
    )
  if (rows.some((r) => r.length !== rows[0].length))
    throw Error(
      'CSV rows have different column counts. Check the export before mapping it.',
    )
  return rows
}

export function mappedDueDate(value: string) {
  const timestamp = value.trim()
  if (
    !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp))
  )
    throw Error(
      'Mapped due dates require an ISO timestamp with Z or an explicit timezone offset. Normalize the source timezone, or leave that column unmapped and set the default due date.',
    )
  return new Date(timestamp).toISOString()
}

function ImportReview({
  records,
  member,
  api,
  reload,
  onNotice,
  syntheticWebsiteIntake,
}: Props & { onNotice: (text: string) => void }) {
  const [showUpload, setShowUpload] = useState(false)
  const [selected, setSelected] = useState<FoundationRecord | null>(null)
  const [filter, setFilter] = useState('All')
  const rows = records.filter((r) => r.kind === 'intake')
  const canReview = ['owner', 'manager'].includes(member.role)
  const [pulling, setPulling] = useState(false)
  return (
    <>
      <Intro
        icon={<Upload size={19} />}
        title="Review sources before adding people"
        text="Map a small CSV batch into a protected review queue. Every row needs a deliberate decision; uploads do not create contacts, enroll applicants or send messages."
      />
      <div className="foundation-toolbar">
        {canReview && syntheticWebsiteIntake && (
          <button
            type="button"
            disabled={pulling}
            onClick={async () => {
              setPulling(true)
              try {
                const result = (await api({
                  action: 'website-intake-pull',
                })) as {
                  queued: number
                  acknowledged: number
                  retryRequired?: boolean
                }
                onNotice(
                  `${result.queued} synthetic website inquiries queued. ${result.acknowledged} acknowledged.${result.retryRequired ? ' Retry the fetch to finish acknowledgment safely.' : ''} No contacts or applicants created.`,
                )
                await reload()
              } catch {
                onNotice(
                  'Synthetic website intake is unavailable. No source acknowledgment was confirmed.',
                )
              } finally {
                setPulling(false)
              }
            }}
          >
            {pulling
              ? 'Fetching synthetic inquiries…'
              : 'Fetch synthetic website inquiries'}
          </button>
        )}
        <label className="foundation-field">
          <span>Queue status</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {[
              'All',
              'ready',
              'duplicate',
              'conflict',
              'invalid',
              'test',
              'applied',
              'excluded',
            ].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {canReview && (
          <button
            type="button"
            className="primary"
            onClick={() => setShowUpload(true)}
          >
            <Upload size={15} /> Map CSV batch
          </button>
        )}
      </div>
      <RecordList
        rows={rows.filter((r) => filter === 'All' || r.data.status === filter)}
        empty="No rows waiting in this view"
        help="Use a reviewed source export. Tests, duplicates, consent conflicts and invalid data remain visible for a decision."
        columns={['Source row', 'Review status', 'Next action']}
        render={(r) => (
          <>
            <td>
              <button
                className="foundation-record"
                onClick={() => setSelected(r)}
              >
                {r.title}
              </button>
              <small>
                {r.data.sourceName} · {r.data.sourceId}
              </small>
            </td>
            <td>
              <span
                className={`foundation-badge ${r.data.status === 'ready' ? 'approved' : ''}`}
              >
                {r.data.status}
              </span>
              <small>{workflowNames[r.data.workflow || '']}</small>
            </td>
            <td>
              {r.data.nextAction || 'Review source'}
              <small>{r.data.reason || r.data.issues?.join?.('; ')}</small>
            </td>
          </>
        )}
      />
      {showUpload && (
        <IntakeMapper
          member={member}
          api={api}
          onClose={() => setShowUpload(false)}
          onSaved={async () => {
            setShowUpload(false)
            onNotice(
              'Batch queued for individual review. No directory or workflow records were created.',
            )
            await reload()
          }}
        />
      )}
      {selected && (
        <IntakeDecision
          record={selected}
          records={records}
          canReview={canReview}
          api={api}
          onClose={() => setSelected(null)}
          onSaved={async () => {
            setSelected(null)
            await reload()
          }}
        />
      )}
    </>
  )
}

function IntakeMapper({
  member,
  api,
  onClose,
  onSaved,
}: {
  member: Member
  api: Props['api']
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [csv, setCsv] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [sourceName, setSourceName] = useState('')
  const [workflow, setWorkflow] = useState('class')
  const [nextAction, setNextAction] = useState('Review inquiry')
  const [nextDue, setNextDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hr = member.role === 'owner' || !!member.hr
  const headers = csv[0] || []
  const mappedFields = isHrWorkflow(workflow)
    ? [...intakeFields, ...applicantIntakeFields]
    : intakeFields
  return (
    <FoundationDialog
      title="Map a CSV batch"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            if (
              !csv.length ||
              mapping.sourceId === undefined ||
              mapping.name === undefined ||
              mapping.email === undefined
            )
              throw Error(
                'Map the stable source row ID, person name and email columns.',
              )
            const rows = csv
              .slice(1)
              .map((row) =>
                Object.fromEntries(
                  mappedFields.map(([key]) => [
                    key,
                    mapping[key] === undefined || mapping[key] === ''
                      ? ''
                      : row[Number(mapping[key])],
                  ]),
                ),
              )
            await api({
              action: 'intake-preview',
              sourceName,
              workflow,
              rows: rows.map((row) => ({
                ...row,
                nextAction: row.nextAction || nextAction,
                nextDue: row.nextDue
                  ? mappedDueDate(row.nextDue)
                  : iso(nextDue),
                contactPermission: row.contactPermission || 'Unknown',
              })),
            })
            await onSaved()
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : 'Could not queue this batch.',
            )
            setBusy(false)
          }
        }}
      >
        <p className="foundation-help">
          UTF-8 CSV, up to 100 rows and 1 MB. Select explicit columns for each
          source version; repeated questions must not be guessed. Source row IDs
          must remain stable across repeated imports. The default due date uses
          your device timezone. Mapped due dates need an ISO timestamp with Z or
          an explicit timezone offset; original response dates are not inferred.
          Applicant details are mapped only into HR-restricted applicant
          workflows. Source onboarding status describes the source record; it
          does not grant HR clearance, learner enrollment, staff access or
          training completion.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <fieldset disabled={busy} className="foundation-form">
          <label className="foundation-field foundation-full">
            <span>CSV file *</span>
            <input
              type="file"
              accept=".csv,text/csv"
              required={!csv.length}
              onChange={async (e) => {
                setError('')
                setCsv([])
                setMapping({})
                const file = e.target.files?.[0]
                if (!file) return
                try {
                  if (file.size > 1_000_000)
                    throw Error('Choose a CSV smaller than 1 MB.')
                  const parsed = parseIntakeCSV(await file.text())
                  setCsv(parsed)
                  const proposed: Record<string, string> = {}
                  for (const [key] of mappedFields) {
                    const matches = parsed[0]
                      .map((v, i) =>
                        v.trim().toLowerCase() === key.toLowerCase() ? i : -1,
                      )
                      .filter((i) => i >= 0)
                    if (matches.length === 1) proposed[key] = String(matches[0])
                  }
                  setMapping(proposed)
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : 'Could not read CSV.',
                  )
                }
              }}
            />
          </label>
          <label className="foundation-field">
            <span>Source name / version *</span>
            <input
              required
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="Exact form + tab + version"
            />
          </label>
          <label className="foundation-field">
            <span>Destination workflow *</span>
            <select
              value={workflow}
              onChange={(e) => setWorkflow(e.target.value)}
            >
              {Object.entries(workflowNames)
                .filter(([key]) => hr || !['program', 'sales'].includes(key))
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          <label className="foundation-field">
            <span>Default next action *</span>
            <input
              required
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
            />
          </label>
          <label className="foundation-field">
            <span>Default due date *</span>
            <input
              type="datetime-local"
              required
              value={nextDue}
              onChange={(e) => setNextDue(e.target.value)}
            />
          </label>
          {!!headers.length && (
            <>
              <p className="foundation-help foundation-full">
                {csv.length - 1} source rows. No unique-person or enrollment
                count has been inferred. Columns are numbered so duplicate
                titles remain distinct.
              </p>
              {mappedFields.map(([key, label]) => (
                <label key={key} className="foundation-field">
                  <span>
                    {label}
                    {['sourceId', 'name', 'email'].includes(key) ? ' *' : ''}
                  </span>
                  <select
                    required={['sourceId', 'name', 'email'].includes(key)}
                    value={mapping[key] || ''}
                    onChange={(e) =>
                      setMapping((current) => ({
                        ...current,
                        [key]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Not mapped</option>
                    {headers.map((header, i) => (
                      <option key={i} value={String(i)}>
                        {i + 1}. {header || '(untitled column)'}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </>
          )}
        </fieldset>
        <div className="form-footer">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !csv.length}
          >
            {busy
              ? 'Checking source rows…'
              : `Queue ${csv.length ? csv.length - 1 : ''} rows for review`}
          </button>
        </div>
      </form>
    </FoundationDialog>
  )
}

function IntakeDecision({
  record,
  records,
  canReview,
  api,
  onClose,
  onSaved,
}: {
  record: FoundationRecord
  records: FoundationRecord[]
  canReview: boolean
  api: Props['api']
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [personId, setPersonId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const status = record.data.status
  const decision = async (value: 'apply' | 'exclude') => {
    setBusy(true)
    setError('')
    try {
      if (!reason.trim())
        throw Error('Add a review reason before making a decision.')
      await api({
        action: 'intake-review',
        id: record.id,
        revision: record.revision,
        decision: value,
        personId: personId || undefined,
        reason,
      })
      await onSaved()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Review failed. Refresh and inspect the current row.',
      )
      setBusy(false)
    }
  }
  return (
    <FoundationDialog
      title="Review source row"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <p className="foundation-help">
        Review the source and contact permission. Linking an existing person
        must preserve suppression and existing history. Repeated source rows
        cannot create another workflow record.
      </p>
      <dl className="foundation-details">
        {Object.entries(record.data).map(([key, value]) => (
          <div key={key}>
            <dt>{human(key)}</dt>
            <dd>
              {typeof value === 'object'
                ? JSON.stringify(value)
                : String(value ?? '')}
            </dd>
          </div>
        ))}
      </dl>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {canReview && !['applied', 'excluded'].includes(status || '') && (
        <fieldset disabled={busy} className="foundation-form">
          <div className="foundation-field foundation-full">
            <span>Existing person (review duplicates before linking)</span>
            <RecordSelector
              label="Existing person"
              options={records
                .filter(
                  (r) =>
                    r.kind === 'contact' &&
                    String(r.data.email || '')
                      .trim()
                      .toLowerCase() ===
                      String(record.data.email || '')
                        .trim()
                        .toLowerCase(),
                )
                .map((r) => ({
                  id: r.id,
                  label: `${r.title} · ${r.data.email || 'no email'}`,
                }))}
              value={personId}
              onChange={setPersonId}
            />
          </div>
          <label className="foundation-field foundation-full">
            <span>Review reason *</span>
            <textarea
              rows={3}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="foundation-actions foundation-full">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => decision('exclude')}
            >
              Exclude row
            </button>
            <button
              type="button"
              className="primary"
              disabled={
                busy ||
                ['invalid', 'test', 'conflict'].includes(status || '') ||
                (status === 'duplicate' && !personId)
              }
              onClick={() => decision('apply')}
            >
              {busy
                ? 'Saving decision…'
                : personId
                  ? 'Link person and apply row'
                  : 'Apply reviewed row'}
            </button>
          </div>
          {['invalid', 'test', 'conflict'].includes(status || '') && (
            <p className="foundation-help foundation-full">
              Resolve this issue in the source and queue a corrected version, or
              exclude this row. This row cannot be applied.
            </p>
          )}
          {status === 'duplicate' && !personId && (
            <p className="foundation-help foundation-full">
              Choose the existing person with this source email before applying
              this duplicate. The review keeps their history and contact
              restrictions.
            </p>
          )}
        </fieldset>
      )}
    </FoundationDialog>
  )
}

export default FoundationWorkspace
