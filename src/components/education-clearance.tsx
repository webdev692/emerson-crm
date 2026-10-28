import { useCallback, useEffect, useRef, useState } from 'react'
import {
  educationCriteria,
  educationHoldLabel,
  emptyEducationClearance,
  emptyEducationEvidence,
  isEducationSnapshot,
  type EducationDecision,
  type EducationSnapshot,
} from '../lib/education'

export function EducationClearancePanel({
  applicationId,
  api,
}: {
  applicationId: string
  api: (body: object) => Promise<unknown>
}) {
  const [snapshot, setSnapshot] = useState<EducationSnapshot | null>(null)
  const [clearance, setClearance] = useState(emptyEducationClearance)
  const [evidence, setEvidence] = useState(emptyEducationEvidence)
  const [decision, setDecision] = useState<EducationDecision>('held')
  const [withdrawn, setWithdrawn] = useState(false)
  const [restoreWithdrawal, setRestoreWithdrawal] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const invalidate = useCallback(() => {
    generation.current++
  }, [])
  const load = useCallback(async () => {
    const current = ++generation.current
    const value = await api({ action: 'education-status', applicationId })
    if (current !== generation.current) return
    if (!isEducationSnapshot(value) || value.applicationId !== applicationId)
      throw Error('Clearance status was incomplete. Refresh before reviewing.')
    setSnapshot(value)
    // Each review starts unapproved. Existing evidence is historical and cannot
    // turn a new decision into a fresh affirmation without deliberate review.
    setClearance(emptyEducationClearance())
    setEvidence(emptyEducationEvidence())
    setDecision('held')
    setWithdrawn(value.current?.withdrawn === true)
    setRestoreWithdrawal(false)
    setReason('')
  }, [api, applicationId])
  useEffect(() => {
    let mounted = true
    void load().catch((cause: unknown) => {
      if (mounted)
        setError(
          cause instanceof Error ? cause.message : 'Unable to load clearance.',
        )
    })
    return () => {
      mounted = false
      invalidate()
    }
  }, [load, invalidate])
  const run = async (body: object, message: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api(body)
      await load()
      setNotice(message)
    } catch (cause) {
      setSnapshot(null)
      setError(
        cause instanceof Error
          ? cause.message
          : 'The operation could not be completed.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="education-clearance"
      aria-label="HR clearance and education handoff"
      aria-busy={busy}
    >
      <h3>HR clearance &amp; education handoff</h3>
      <p>
        Synthetic rehearsal. Review each requirement against current source
        evidence. Workflow stages and staff training do not establish applicant
        clearance.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!snapshot ? (
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={() =>
            void run(
              { action: 'education-status', applicationId },
              'Current source loaded.',
            )
          }
        >
          Refresh clearance
        </button>
      ) : (
        <>
          <p>
            <strong>Current decision:</strong>{' '}
            {snapshot.current?.decision || 'Not reviewed'} · Version{' '}
            {snapshot.decisionVersion}
            {snapshot.current?.withdrawn ? ' · Withdrawn' : ''}
          </p>
          <p className="muted">
            {snapshot.receiverVersionFloor !== undefined && (
              <>
                Existing portal version baseline {snapshot.receiverVersionFloor}
                ; no earlier CRM decisions are implied.
                <br />
              </>
            )}
            Source {snapshot.sourceVersion} · Application revision{' '}
            {snapshot.applicationRevision} · Person revision{' '}
            {snapshot.personRevision}
          </p>
          {snapshot.current && <p>Last review: {snapshot.current.reason}</p>}
          {!!snapshot.holds.length && (
            <div role="status">
              <strong>Current holds</strong>
              <ul>
                {snapshot.holds.map((hold) => (
                  <li key={hold}>{educationHoldLabel(hold)}</li>
                ))}
              </ul>
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void run(
                {
                  action: 'education-review',
                  applicationId,
                  expected: {
                    applicationRevision: snapshot.applicationRevision,
                    personRevision: snapshot.personRevision,
                    sourceFingerprint: snapshot.sourceFingerprint,
                    decisionVersion: snapshot.decisionVersion,
                  },
                  clearance,
                  evidence,
                  withdrawn,
                  restoreWithdrawal,
                  decision,
                  reason,
                },
                'HR decision recorded. Handoff remains a separate action.',
              )
            }}
          >
            <fieldset disabled={busy}>
              <legend>Review current requirements</legend>
              {educationCriteria.map(([key, label]) => (
                <div className="education-requirement" key={key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={clearance[key]}
                      onChange={(event) =>
                        setClearance({
                          ...clearance,
                          [key]: event.target.checked,
                        })
                      }
                    />{' '}
                    {label}
                  </label>
                  <label className="foundation-field">
                    {label} evidence reference
                    <input
                      value={evidence[key]}
                      maxLength={1000}
                      required
                      onChange={(event) =>
                        setEvidence({ ...evidence, [key]: event.target.value })
                      }
                    />
                  </label>
                </div>
              ))}
              <label className="foundation-field">
                Decision
                <select
                  value={decision}
                  onChange={(event) =>
                    setDecision(event.target.value as EducationDecision)
                  }
                >
                  <option value="held">Hold</option>
                  <option value="cleared">Clear for education handoff</option>
                  <option value="revoked">Revoke earlier clearance</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={withdrawn}
                  onChange={(event) => setWithdrawn(event.target.checked)}
                />{' '}
                Applicant has withdrawn
              </label>
              {snapshot.current?.withdrawn && (
                <label>
                  <input
                    type="checkbox"
                    checked={restoreWithdrawal}
                    onChange={(event) =>
                      setRestoreWithdrawal(event.target.checked)
                    }
                  />{' '}
                  Explicitly reinstate after reviewing the withdrawal
                </label>
              )}
              <label className="foundation-field">
                Review reason
                <textarea
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <button className="primary" type="submit">
                Record HR decision
              </button>
            </fieldset>
          </form>
          <h4>Handoff queue</h4>
          <p>
            Only identifiers, the decision and requirement flags go to the
            synthetic education portal. A receipt confirms delivery; it does not
            create a learner account or enrollment.
          </p>
          <ul>
            {snapshot.outbox.map((entry) => (
              <li key={entry.eventId}>
                Version {entry.decisionVersion}: {entry.decision} ·{' '}
                {entry.status} · {entry.attempts} attempts
                {entry.currentStatus ? ` · Portal ${entry.currentStatus}` : ''}
              </li>
            ))}
          </ul>
          {!snapshot.outbox.length && <p>No handoff queued.</p>}
          <button
            className="secondary"
            type="button"
            disabled={
              busy ||
              !snapshot.outbox.some((entry) =>
                ['pending', 'failed'].includes(entry.status),
              )
            }
            onClick={() =>
              void run(
                { action: 'education-dispatch', applicationId },
                'Handoff attempt finished. Check the queue receipt.',
              )
            }
          >
            Send current handoff to synthetic portal
          </button>
        </>
      )}
    </section>
  )
}
