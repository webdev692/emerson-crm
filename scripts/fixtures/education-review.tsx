// Offline visual review fixture only. Never an application or deploy entry.
import { createRoot } from 'react-dom/client'
import { EducationClearancePanel } from '../../src/components/education-clearance'
import {
  emptyEducationClearance,
  emptyEducationEvidence,
} from '../../src/lib/education'
import '../../src/styles.css'
import '../../src/components/foundation-workspace.css'

const applicationId = '82000000-0000-4000-8000-000000000001'
const snapshot = {
  applicationId,
  applicationRevision: 3,
  personRevision: 2,
  sourceFingerprint: 'a'.repeat(64),
  sourceVersion: 'SYNTHETIC source version 2',
  decisionVersion: 2,
  holds: ['source_revision_changed'],
  current: {
    id: '88000000-0000-4000-8000-000000000001',
    decision: 'held',
    withdrawn: false,
    reviewerId: '80000000-0000-4000-8000-000000000001',
    issuedAt: '2026-10-24T12:00:00.000Z',
    reason: 'SYNTHETIC source changed; review current evidence.',
    clearance: emptyEducationClearance(),
    evidence: emptyEducationEvidence(),
  },
  outbox: [
    {
      eventId: '89000000-0000-4000-8000-000000000001',
      decisionVersion: 2,
      decision: 'held',
      status: 'pending',
      attempts: 0,
      bodyHash: 'b'.repeat(64),
    },
  ],
}
async function api(body: object) {
  if ('action' in body && body.action === 'education-status') return snapshot
  throw Error(
    'This offline visual review is read-only. Save and delivery behavior are tested separately.',
  )
}
createRoot(document.getElementById('root')!).render(
  <main
    style={{
      maxWidth: 780,
      padding: 24,
      margin: '24px auto',
      background: '#fffef8',
    }}
  >
    <p className="foundation-badge">Offline synthetic visual review</p>
    <h1>SYNTHETIC applicant</h1>
    <EducationClearancePanel applicationId={applicationId} api={api} />
  </main>,
)
