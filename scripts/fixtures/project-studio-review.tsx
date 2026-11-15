// Standalone local rehearsal entry. Never import from a production route.
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { createRoot } from 'react-dom/client'
import {
  buildDemoBoard,
  inquiryFieldLimits,
  pilotSteps,
  rehearsalNotice,
  reviewOutcomeMappings,
  reviewOutcomes,
  studioCategories,
  syntheticInquiry,
  validateStudioInquiry,
  type DemoPersona,
  type DemoState,
  type InquiryErrors,
  type ReviewOutcome,
  type StudioInquiry,
} from '../../src/lib/project-studio-rehearsal'
import './project-studio-review.css'

const apiPath = '/api/project-studio-demo'
const emptyInquiry: StudioInquiry = {
  businessName: '',
  contactName: '',
  email: '',
  location: '',
  category: '',
  description: '',
  outcome: '',
  timeline: '',
  budget: '',
  currentSystems: '',
  preferredContact: 'none',
  privacyAcknowledged: false,
}
const fieldLabels: Record<keyof StudioInquiry, string> = {
  businessName: 'Business or organization name',
  contactName: 'Contact person’s name',
  email: 'Business email address',
  location: 'General business location',
  category: 'Project category',
  description: 'What does your business need help with?',
  outcome: 'What would a useful result look like?',
  timeline: 'Approximate timeline',
  budget: 'Budget range',
  currentSystems: 'Current systems or tools',
  preferredContact: 'Preferred contact method',
  privacyAcknowledged: 'Synthetic information acknowledgment',
}
const personas: { value: DemoPersona; label: string; description: string }[] = [
  {
    value: 'client',
    label: 'Fictional client · Casey Vale',
    description:
      'Can submit the provided fictional inquiry and see its own status.',
  },
  {
    value: 'sales',
    label: 'Assigned sales reviewer',
    description:
      'Can review assigned synthetic inquiries. No commercial approval or sending authority.',
  },
  {
    value: 'reviewer',
    label: 'Assigned feasibility reviewer',
    description:
      'Can record a synthetic review observation. No real project is accepted.',
  },
  {
    value: 'viewer',
    label: 'Read-only reviewer',
    description:
      'Can inspect permitted fictional records; cannot save review decisions.',
  },
  {
    value: 'outsider',
    label: 'Unassigned staff member',
    description: 'Has no access to the scenario’s inquiry records.',
  },
  {
    value: 'inactive',
    label: 'Inactive simulated member',
    description: 'Cannot access or change inquiry records.',
  },
  {
    value: 'guest',
    label: 'Signed-out simulation',
    description: 'Has no staff review authority.',
  },
]

type ApiResult = Partial<DemoState> & {
  receipt?: string
  duplicate?: boolean
  error?: { code?: string; message?: string }
}

export function ProjectStudioRehearsal() {
  const [state, setState] = useState<DemoState | null>(null)
  const [inquiry, setInquiry] = useState<StudioInquiry>({ ...emptyInquiry })
  const [errors, setErrors] = useState<InquiryErrors>({})
  const [errorAttempt, setErrorAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [systemError, setSystemError] = useState('')
  const [message, setMessage] = useState('')
  const [receipt, setReceipt] = useState('')
  const [lastSubmission, setLastSubmission] = useState<StudioInquiry | null>(
    null,
  )
  const [selectedId, setSelectedId] = useState('SYN-PS5-001')
  const [reviewOutcome, setReviewOutcome] =
    useState<ReviewOutcome>('feasibility')
  const [reviewReason, setReviewReason] = useState('')
  const [reviewError, setReviewError] = useState('')
  const errorSummary = useRef<HTMLDivElement>(null)
  const reviewErrorSummary = useRef<HTMLDivElement>(null)
  const selected =
    state?.inquiries.find((record) => record.id === selectedId) ||
    state?.inquiries[0]
  const canReview =
    !!state?.session.active &&
    ['sales', 'reviewer'].includes(state.session.persona)
  const canSubmit =
    !!state?.session.active && state.session.persona === 'client'
  const board = buildDemoBoard(selected)
  const currentPersona = personas.find(
    (persona) => persona.value === state?.session.persona,
  )

  useEffect(() => {
    let cancelled = false
    fetch(apiPath, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        const result = (await response.json()) as ApiResult
        if (
          !response.ok ||
          !result.session ||
          !result.csrfToken ||
          !Array.isArray(result.inquiries)
        ) {
          throw new Error(
            result.error?.message ||
              'The isolated demonstration is unavailable. Start the dedicated local review server.',
          )
        }
        if (!cancelled) setState(result as DemoState)
      })
      .catch((error) => {
        if (!cancelled)
          setSystemError(
            error instanceof Error
              ? error.message
              : 'The local demonstration could not load.',
          )
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (errorAttempt) errorSummary.current?.focus()
  }, [errorAttempt])
  useEffect(() => {
    if (reviewError) reviewErrorSummary.current?.focus()
  }, [reviewError])

  async function request(body: unknown, session = false) {
    if (!state) throw new Error('The local session is not ready.')
    const response = await fetch(`${apiPath}${session ? '/session' : ''}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': state.csrfToken,
      },
      body: JSON.stringify(body),
    })
    const result = (await response.json()) as ApiResult
    if (!response.ok)
      throw new Error(
        result.error?.message || 'The simulated operation was not completed.',
      )
    if (result.session && result.csrfToken && Array.isArray(result.inquiries)) {
      setState(result as DemoState)
    } else {
      const refresh = await fetch(apiPath, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const refreshed = (await refresh.json()) as ApiResult
      if (
        !refresh.ok ||
        !refreshed.session ||
        !refreshed.csrfToken ||
        !Array.isArray(refreshed.inquiries)
      ) {
        throw new Error(
          'The operation returned, but the local review state could not refresh. Retry with the same inquiry reference; do not assume a new record is needed.',
        )
      }
      setState(refreshed as DemoState)
    }
    return result
  }

  async function changePersona(value: DemoPersona) {
    setBusy(true)
    setSystemError('')
    setMessage('')
    setReviewError('')
    try {
      await request({ persona: value }, true)
      setInquiry({ ...emptyInquiry })
      setErrors({})
      setReceipt('')
      setLastSubmission(null)
      setReviewReason('')
      setMessage(
        `Simulated account changed to ${personas.find((persona) => persona.value === value)?.label}. The server controls this account’s access.`,
      )
    } catch (error) {
      setSystemError(
        error instanceof Error
          ? error.message
          : 'The simulated account could not be changed.',
      )
    } finally {
      setBusy(false)
    }
  }

  function updateField<K extends keyof StudioInquiry>(
    key: K,
    value: StudioInquiry[K],
  ) {
    setInquiry((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => ({ ...previous, [key]: undefined }))
  }

  async function simulateSubmission(value: StudioInquiry) {
    setBusy(true)
    setSystemError('')
    setMessage('')
    try {
      const result = await request({
        action: 'submit',
        submissionId: 'SYN-PS5-001',
        inquiry: value,
      })
      setLastSubmission(value)
      setReceipt(result.receipt || 'SYN-PS5-001')
      setMessage(
        result.duplicate
          ? 'Duplicate retry recognized. The same fictional receipt is retained; no second inquiry was created.'
          : 'Simulation complete. The fictional inquiry is available in this local review session. Nothing was sent to Emerson or a production CRM, and no engagement was accepted.',
      )
    } catch (error) {
      setSystemError(
        error instanceof Error
          ? error.message
          : 'The simulated submission did not complete.',
      )
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validation = validateStudioInquiry(inquiry)
    if (!validation.ok) {
      setErrors(validation.errors)
      setErrorAttempt((previous) => previous + 1)
      return
    }
    setErrors({})
    void simulateSubmission(validation.value)
  }

  async function saveReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reviewReason.trim()) {
      setReviewError(
        'Add a short fictional reason for this review observation.',
      )
      return
    }
    if (!selected) return
    setBusy(true)
    setReviewError('')
    setSystemError('')
    setMessage('')
    try {
      await request({
        action: 'review',
        inquiryId: selected.id,
        revision: selected.revision,
        outcome: reviewOutcome,
        reason: reviewReason,
      })
      setMessage(
        'Synthetic review saved. The illustrative stage remains S1; no CRM opportunity was created. No proposal, contract, message or assignment was created.',
      )
    } catch (error) {
      setReviewError(
        error instanceof Error
          ? error.message
          : 'The review was not saved. Refresh and review the current revision.',
      )
    } finally {
      setBusy(false)
    }
  }

  function field(
    key: keyof typeof inquiryFieldLimits,
    options: {
      help?: string
      multiline?: boolean
      wide?: boolean
      optional?: boolean
      type?: string
    } = {},
  ) {
    const describedBy = [
      `ps5-${key}-help`,
      errors[key] ? `ps5-${key}-error` : '',
    ]
      .filter(Boolean)
      .join(' ')
    const common = {
      id: `ps5-${key}`,
      name: key,
      value: inquiry[key],
      maxLength: inquiryFieldLimits[key],
      'aria-invalid': !!errors[key],
      'aria-describedby': describedBy,
      required: !options.optional,
      autoComplete: 'off',
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        updateField(key, event.target.value),
    }
    return (
      <div className={`ps5-field ${options.wide ? 'ps5-field-wide' : ''}`}>
        <label htmlFor={`ps5-${key}`}>
          {fieldLabels[key]}
          {options.optional && (
            <span className="ps5-optional"> (optional)</span>
          )}
        </label>
        {options.multiline ? (
          <textarea {...common} rows={4} />
        ) : (
          <input {...common} type={options.type || 'text'} />
        )}
        <span id={`ps5-${key}-help`} className="ps5-field-help">
          {options.help ||
            `Fictional information only. Up to ${inquiryFieldLimits[key]} characters.`}
        </span>
        {errors[key] && (
          <p className="ps5-field-error" id={`ps5-${key}-error`}>
            {errors[key]}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="ps5">
      <a href="#ps5-main" className="ps5-skip">
        Skip to demonstration
      </a>
      <div className="ps5-safety">
        <strong>Local synthetic demonstration.</strong> Real intake, CRM
        integration, messages, contracts and payments remain closed.
      </div>
      <header className="ps5-wrap ps5-header">
        <div className="ps5-wordmark">
          The Emerson Empire
          <small>Project Studio · Phase Five preparation</small>
        </div>
        <nav aria-label="Demonstration sections">
          <a href="#client-inquiry">Client inquiry</a>
          <a href="#staff-review">Staff review</a>
          <a href="#delivery-board">Delivery illustration</a>
        </nav>
      </header>
      <main id="ps5-main" tabIndex={-1}>
        <section className="ps5-hero" aria-labelledby="ps5-title">
          <div className="ps5-wrap ps5-hero-grid">
            <div>
              <p className="ps5-kicker">
                From a business need to a considered next step
              </p>
              <h1 id="ps5-title">
                Make the work clear before the work begins.
              </h1>
              <p className="ps5-lede">
                Try a preliminary inquiry, inspect a staff review, and follow a
                fictional project through its proposed delivery checkpoints.
              </p>
            </div>
            <aside className="ps5-hero-note">
              <p className="ps5-kicker">One fictional business</p>
              <h2>Harbor Lantern Services</h2>
              <p>
                Casey Vale needs clearer mobile service pages and an organized
                appointment-request workflow. This example uses fictional
                materials, simulated roles and no live bookings.
              </p>
              <p>
                Nothing here is a client agreement, a staff assignment or a
                promise of service availability.
              </p>
            </aside>
          </div>
        </section>
        <div className="ps5-wrap">
          <section className="ps5-session" aria-labelledby="session-heading">
            <div>
              <h2 id="session-heading">Explore a simulated account</h2>
              <p>
                These are fictional role presets for testing. They do not sign
                in as a real person or grant production access. Switching
                accounts clears unsent form values and previous receipt notices.
              </p>
              <p>
                <strong>Server-reported role:</strong>{' '}
                {state
                  ? `${state.session.role} · ${state.session.active ? 'active' : 'inactive'}`
                  : 'Loading isolated session…'}
              </p>
            </div>
            <div>
              <label htmlFor="ps5-persona">Simulated account</label>
              <select
                id="ps5-persona"
                value={state?.session.persona || 'client'}
                disabled={!state || busy}
                onChange={(event) =>
                  void changePersona(event.target.value as DemoPersona)
                }
              >
                {personas.map((persona) => (
                  <option key={persona.value} value={persona.value}>
                    {persona.label}
                  </option>
                ))}
              </select>
              <p className="ps5-field-help">
                {currentPersona?.description ||
                  'The dedicated local server must be available.'}
              </p>
            </div>
          </section>
          {systemError && (
            <div className="ps5-notice ps5-error" role="alert">
              <strong>Operation not completed</strong>
              <p>{systemError}</p>
            </div>
          )}
          <div role="status" aria-live="polite" aria-atomic="true">
            {message && (
              <div className="ps5-notice">
                <p>{message}</p>
                {receipt && (
                  <p>
                    <strong>Local reference:</strong> {receipt}
                  </p>
                )}
              </div>
            )}
          </div>

          <section
            id="client-inquiry"
            className="ps5-section"
            aria-labelledby="inquiry-heading"
          >
            <div className="ps5-section-head">
              <div>
                <p className="ps5-kicker">01 · Client-side demonstration</p>
                <h2 id="inquiry-heading">Describe the work you need.</h2>
                <p>
                  Use the fictional example below. Required fields help a
                  reviewer understand the need; they do not establish scope,
                  price, a deadline or a client relationship.
                </p>
              </div>
              <button
                className="ps5-button ps5-button-secondary"
                type="button"
                onClick={() => {
                  setInquiry({
                    ...syntheticInquiry,
                    privacyAcknowledged: false,
                  })
                  setErrors({})
                }}
              >
                Fill fictional example
              </button>
            </div>
            <div className="ps5-form-layout">
              <form
                className="ps5-form"
                noValidate
                onSubmit={submit}
                aria-label="Synthetic preliminary inquiry"
              >
                {Object.values(errors).some(Boolean) && (
                  <div
                    ref={errorSummary}
                    className="ps5-error-summary"
                    role="alert"
                    tabIndex={-1}
                  >
                    <h3>Check the following fields</h3>
                    <ul>
                      {Object.entries(errors)
                        .filter(([, error]) => error)
                        .map(([key, error]) => (
                          <li key={key}>
                            {key === 'form' ? (
                              error
                            ) : (
                              <a
                                href={`#ps5-${key}`}
                                onClick={(event) => {
                                  event.preventDefault()
                                  document.getElementById(`ps5-${key}`)?.focus()
                                }}
                              >
                                {fieldLabels[key as keyof StudioInquiry]}:{' '}
                                {error}
                              </a>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
                <div className="ps5-field-grid">
                  {field('businessName', {
                    help: 'Use Harbor Lantern Services for this demonstration.',
                  })}
                  {field('contactName', {
                    help: 'Use Casey Vale, the fictional client contact.',
                  })}
                  {field('email', {
                    type: 'email',
                    help: 'Use casey@harbor-lantern.invalid. Real email addresses are rejected.',
                  })}
                  {field('location', {
                    help: 'Country/region only; label it fictional or synthetic. No street address.',
                  })}
                  <div className="ps5-field ps5-field-wide">
                    <label htmlFor="ps5-category">Project category</label>
                    <select
                      id="ps5-category"
                      name="category"
                      required
                      value={inquiry.category}
                      aria-invalid={!!errors.category}
                      aria-describedby={`ps5-category-help${errors.category ? ' ps5-category-error' : ''}`}
                      onChange={(event) =>
                        updateField('category', event.target.value)
                      }
                    >
                      <option value="">Choose an area, or Other</option>
                      {studioCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                    <span className="ps5-field-help" id="ps5-category-help">
                      You do not need technical terminology. Every category
                      requires individual feasibility and capacity review.
                    </span>
                    {errors.category && (
                      <p className="ps5-field-error" id="ps5-category-error">
                        {errors.category}
                      </p>
                    )}
                  </div>
                  {field('description', {
                    multiline: true,
                    wide: true,
                    help: 'Describe the fictional business problem. No passwords, tax returns, personnel details, client lists or confidential code.',
                  })}
                  {field('outcome', {
                    multiline: true,
                    wide: true,
                    help: 'Describe a useful result. This is a goal for review, not a guaranteed outcome.',
                  })}
                  {field('timeline', {
                    help: 'A broad window or “unsure” is enough. No delivery date is promised.',
                  })}
                  {field('budget', {
                    optional: true,
                    help: 'Optional fictional planning range or “unsure”; this does not create a quote.',
                  })}
                  {field('currentSystems', {
                    optional: true,
                    wide: true,
                    help: 'Tool names and broad purpose only. No private links, access details, files or data exports.',
                  })}
                  <div className="ps5-field ps5-field-wide">
                    <label htmlFor="ps5-preferredContact">
                      Preferred contact method
                    </label>
                    <select
                      id="ps5-preferredContact"
                      name="preferredContact"
                      value={inquiry.preferredContact}
                      aria-invalid={!!errors.preferredContact}
                      aria-describedby="ps5-preferredContact-help"
                      onChange={(event) =>
                        updateField(
                          'preferredContact',
                          event.target
                            .value as StudioInquiry['preferredContact'],
                        )
                      }
                    >
                      <option value="none">
                        No contact — demonstration only
                      </option>
                      <option value="email">
                        Email preference — simulated, no message sent
                      </option>
                    </select>
                    <span
                      id="ps5-preferredContact-help"
                      className="ps5-field-help"
                    >
                      This does not authorize marketing, call scheduling or any
                      external communication.
                    </span>
                  </div>
                </div>
                <div className="ps5-check">
                  <input
                    id="ps5-privacyAcknowledged"
                    name="privacyAcknowledged"
                    type="checkbox"
                    checked={inquiry.privacyAcknowledged}
                    aria-invalid={!!errors.privacyAcknowledged}
                    aria-describedby={
                      errors.privacyAcknowledged
                        ? 'ps5-privacyAcknowledged-error'
                        : 'ps5-privacy-help'
                    }
                    onChange={(event) =>
                      updateField('privacyAcknowledged', event.target.checked)
                    }
                  />
                  <div>
                    <label htmlFor="ps5-privacyAcknowledged">
                      I am using fictional information and understand this is a
                      local demonstration, not a real request.
                    </label>
                    <p className="ps5-field-help" id="ps5-privacy-help">
                      Do not enter sensitive or real client information. Unsent
                      form values remain in page memory; simulated submissions
                      remain only in the local server process until it stops.
                    </p>
                    {errors.privacyAcknowledged && (
                      <p
                        className="ps5-field-error"
                        id="ps5-privacyAcknowledged-error"
                      >
                        {errors.privacyAcknowledged}
                      </p>
                    )}
                  </div>
                </div>
                {!canSubmit && (
                  <p className="ps5-muted">
                    Choose the fictional client account to simulate a
                    submission. The server enforces the account boundary.
                  </p>
                )}
                <div className="ps5-actions">
                  <button
                    className="ps5-button"
                    type="submit"
                    disabled={busy || !canSubmit}
                  >
                    {busy ? 'Working locally…' : 'Simulate inquiry submission'}
                  </button>
                  {lastSubmission && (
                    <button
                      className="ps5-button ps5-button-secondary"
                      type="button"
                      disabled={busy || !canSubmit}
                      onClick={() => void simulateSubmission(lastSubmission)}
                    >
                      Retry the same inquiry
                    </button>
                  )}
                  <button
                    className="ps5-button ps5-button-secondary"
                    type="button"
                    onClick={() => {
                      setInquiry({ ...emptyInquiry })
                      setErrors({})
                    }}
                  >
                    Clear unsent fields
                  </button>
                </div>
                <p className="ps5-field-help">
                  Reference SYN-PS5-001. Retrying identical content reuses its
                  receipt; changing content under the same reference is a
                  conflict.
                </p>
              </form>
              <aside className="ps5-aside">
                <h3>A small inquiry. A careful review.</h3>
                <p>
                  Collect enough context to decide what should happen next,
                  before asking for confidential materials.
                </p>
                <ul>
                  <li>No uploads, payment details or account credentials.</li>
                  <li>
                    No automatic CRM contact, accepted project or staff
                    assignment.
                  </li>
                  <li>No email, appointment or marketing enrollment.</li>
                  <li>
                    Financial, HR and security work require appropriate
                    qualifications and written authority.
                  </li>
                </ul>
                <hr />
                <h3>What happens in this demo?</h3>
                <p>
                  Submit the fictional example, retry it to inspect duplicate
                  handling, then choose an assigned reviewer account above to
                  record a review observation.
                </p>
                <p>
                  Read-only, unassigned and inactive presets demonstrate access
                  boundaries. They are not real CRM memberships.
                </p>
              </aside>
            </div>
          </section>

          <section
            id="staff-review"
            className="ps5-section"
            aria-labelledby="review-heading"
          >
            <div className="ps5-section-head">
              <div>
                <p className="ps5-kicker">02 · Internal review demonstration</p>
                <h2 id="review-heading">
                  Decide the next question, not the final commitment.
                </h2>
                <p>
                  The server returns only records available to the selected
                  simulated account. A review outcome does not bypass CRM
                  approvals or advance the sales lifecycle.
                </p>
              </div>
              <span className="ps5-pill">
                Server-filtered fictional records
              </span>
            </div>
            {!state?.inquiries.length ? (
              <div className="ps5-empty">
                <h3>No inquiry records available to this account</h3>
                <p>
                  Submit the fictional example as the client, then select an
                  assigned reviewer. Unassigned, inactive and signed-out
                  simulations cannot use staff access.
                </p>
              </div>
            ) : (
              <div className="ps5-review-layout">
                <ul
                  className="ps5-inquiry-list"
                  aria-label="Available fictional inquiries"
                >
                  {state.inquiries.map((record) => (
                    <li key={record.id}>
                      <button
                        type="button"
                        className="ps5-inquiry-button"
                        aria-pressed={record.id === selected?.id}
                        onClick={() => {
                          setSelectedId(record.id)
                          setReviewError('')
                        }}
                      >
                        <strong>{record.inquiry.businessName}</strong>
                        <span>
                          {record.id} · revision {record.revision}
                        </span>
                        <span>
                          {reviewOutcomeMappings[record.reviewOutcome].label}
                        </span>
                        {record.potentialDuplicate && (
                          <span>
                            Potential duplicate — separate review required
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
                {selected && (
                  <article
                    className="ps5-review-detail"
                    aria-labelledby="selected-inquiry-heading"
                  >
                    <p className="ps5-kicker">
                      {selected.id} · Synthetic review summary
                    </p>
                    <h3 id="selected-inquiry-heading">
                      {selected.inquiry.businessName}
                    </h3>
                    <dl className="ps5-facts">
                      <div>
                        <dt>Fictional contact</dt>
                        <dd>
                          {selected.inquiry.contactName}
                          <br />
                          {selected.inquiry.email}
                        </dd>
                      </div>
                      <div>
                        <dt>Project category</dt>
                        <dd>
                          {studioCategories.find(
                            (category) =>
                              category.id === selected.inquiry.category,
                          )?.label || selected.inquiry.category}
                        </dd>
                      </div>
                      <div>
                        <dt>Review outcome</dt>
                        <dd>
                          {reviewOutcomeMappings[selected.reviewOutcome].label}
                        </dd>
                      </div>
                      <div>
                        <dt>Illustrative CRM stage</dt>
                        <dd>
                          {selected.stage} · {selected.stageLabel}
                        </dd>
                      </div>
                      <div>
                        <dt>Desired timeline</dt>
                        <dd>{selected.inquiry.timeline}</dd>
                      </div>
                      <div>
                        <dt>Budget information</dt>
                        <dd>
                          {selected.inquiry.budget ||
                            'Not provided; no quote approved.'}
                        </dd>
                      </div>
                    </dl>
                    <h4>Business need</h4>
                    <p>{selected.inquiry.description}</p>
                    <h4>Desired outcome</h4>
                    <p>{selected.inquiry.outcome}</p>
                    <p className="ps5-muted">
                      <strong>CRM mapping:</strong> {selected.reviewMapping}
                    </p>
                    {selected.review && (
                      <p className="ps5-muted">
                        <strong>Latest simulated review:</strong>{' '}
                        {selected.review.reason}
                      </p>
                    )}
                    {canReview ? (
                      <form
                        className="ps5-review-form"
                        onSubmit={saveReview}
                        noValidate
                        aria-label="Synthetic staff review"
                      >
                        <h4>Record a review observation</h4>
                        {reviewError && (
                          <div
                            ref={reviewErrorSummary}
                            className="ps5-error-summary"
                            role="alert"
                            tabIndex={-1}
                          >
                            {reviewError}
                          </div>
                        )}
                        <div className="ps5-field">
                          <label htmlFor="ps5-review-outcome">
                            Proposed next outcome
                          </label>
                          <select
                            id="ps5-review-outcome"
                            value={reviewOutcome}
                            onChange={(event) =>
                              setReviewOutcome(
                                event.target.value as ReviewOutcome,
                              )
                            }
                          >
                            {reviewOutcomes.map((outcome) => (
                              <option key={outcome} value={outcome}>
                                {reviewOutcomeMappings[outcome].label}
                              </option>
                            ))}
                          </select>
                          <p className="ps5-field-help">
                            {reviewOutcomeMappings[reviewOutcome].crmMapping}
                          </p>
                        </div>
                        <div className="ps5-field">
                          <label htmlFor="ps5-review-reason">
                            Review reason and next step
                          </label>
                          <textarea
                            id="ps5-review-reason"
                            rows={4}
                            maxLength={800}
                            value={reviewReason}
                            required
                            aria-invalid={!!reviewError}
                            aria-describedby="ps5-review-help"
                            onChange={(event) =>
                              setReviewReason(event.target.value)
                            }
                          />
                          <p id="ps5-review-help" className="ps5-field-help">
                            Fictional, non-sensitive notes only. Explain missing
                            information, feasibility, qualifications, capacity
                            or the reason for a hold. Up to 800 characters.
                          </p>
                        </div>
                        <button
                          className="ps5-button"
                          type="submit"
                          disabled={busy}
                        >
                          Save simulated review
                        </button>
                      </form>
                    ) : (
                      <p className="ps5-empty">
                        This account cannot save staff review decisions. Choose
                        an assigned reviewer to inspect that authorized
                        simulation.
                      </p>
                    )}
                  </article>
                )}
              </div>
            )}
          </section>
        </div>

        <section
          id="delivery-board"
          className="ps5-board ps5-section"
          aria-labelledby="board-heading"
        >
          <div className="ps5-wrap">
            <div className="ps5-section-head">
              <div>
                <p className="ps5-kicker">03 · Illustrative delivery board</p>
                <h2 id="board-heading">
                  Keep responsibility and blockers visible.
                </h2>
                <p>
                  {board.projectId} · Linked fictional inquiry {board.inquiryId}
                  . This static scenario is separate from the review queue. It
                  does not create an approved scope, task assignment or client
                  acceptance.
                </p>
              </div>
              <span className="ps5-pill">Not ready for real handoff</span>
            </div>
            <div className="ps5-board-grid">
              <article className="ps5-board-card">
                <h3>Accountable owner</h3>
                <p>{board.responsibleRole}</p>
              </article>
              <article className="ps5-board-card">
                <h3>Approved work</h3>
                <p>{board.approvedWork}</p>
              </article>
              <article className="ps5-board-card">
                <h3>Next milestone</h3>
                <p>{board.nextMilestone}</p>
              </article>
              <article className="ps5-board-card">
                <h3>Overdue / reminders</h3>
                <p>{board.overdue}</p>
              </article>
              <article className="ps5-board-card">
                <h3>Client feedback needed</h3>
                <p>{board.feedback}</p>
              </article>
              <article className="ps5-board-card">
                <h3>Reviewed so far</h3>
                <p>{board.reviewed}</p>
              </article>
            </div>
            <div className="ps5-notice">
              <strong>Work remains blocked pending separate decisions.</strong>
              <p>
                {board.blocked.join(' · ')}. S9 is an internal delivery handoff,
                not final client acceptance or revenue.
              </p>
            </div>
            <h3>Grouped milestone summary</h3>
            <div className="ps5-board-grid">
              {board.milestones.map((milestone) => (
                <article className="ps5-board-card" key={milestone.id}>
                  <p className="ps5-kicker">
                    {milestone.id} · {milestone.status}
                  </p>
                  <h3>{milestone.title}</h3>
                  <p>
                    <strong>{milestone.owner}</strong>
                    {milestone.evidence}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="ps5-wrap ps5-section"
          aria-labelledby="scenario-heading"
        >
          <p className="ps5-kicker">An inspectable sequence</p>
          <h2 id="scenario-heading">
            Follow the twelve preparation checkpoints.
          </h2>
          <p className="ps5-muted">
            Open each checkpoint to inspect the fictional evidence and its
            relationship to the existing CRM. Draft templates and approvals
            remain unexecuted.
          </p>
          <ol className="ps5-flow">
            {pilotSteps.map((step) => (
              <li key={step.id}>
                <details>
                  <summary>{step.title.replace(/^\d+\.\s*/, '')}</summary>
                  <p>{step.summary}</p>
                  <p className="ps5-mapping">
                    <strong>CRM relationship:</strong> {step.crmMapping}
                  </p>
                  <p>
                    <strong>Illustrative evidence:</strong> {step.evidence}
                  </p>
                </details>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="ps5-footer">
        <div className="ps5-wrap">
          <p>{state?.notice || rehearsalNotice}</p>
          <p>
            Founder-led. Built through collaboration. Credit given wherever
            credit is due. Commercial activation requires a separate founder
            decision and verified release.
          </p>
        </div>
      </footer>
    </div>
  )
}

const mount = document.getElementById('root')
if (mount) createRoot(mount).render(<ProjectStudioRehearsal />)
