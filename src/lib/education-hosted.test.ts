// @vitest-environment node
// Pure protocol/transport tests. HTTPS is mocked; these are not hosted receipts.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HOSTED_EDUCATION,
  configuredHostedEducationProfile,
  hostedEducationAvailable,
  hostedReviewerAllowed,
  hostedReviewerIdSha256,
  hostedReviewerIdentitySha256,
  hostedSigningKey,
  parseHostedEducationProfile,
  parseHostedEducationDecision,
  parseRawHostedDecision,
  serializeHostedDecision,
  signHostedEducationAttempt,
  sendHostedEducationAttempt,
} from '../../netlify/functions/lib/education-hosted.mts'
import type {
  HostedDecisionBody,
  HostedEducationProfile,
  HostedSignedAttempt,
} from '../../netlify/functions/lib/education-hosted.mts'
import type { EducationMember } from '../../netlify/functions/lib/education-policy.mts'
import { FIXTURE_IDS } from '../../netlify/functions/lib/education-handoff.mts'

const https = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('node:https', () => ({ request: https.request }))
const now = Date.parse('2026-10-27T13:00:00.000Z')
const key = randomBytes(32).toString('base64url')
const reviewerFixture = {
  id: '90000000-0000-4000-8000-000000000002',
  email: 'reviewer@emerson.example',
}
const profile: HostedEducationProfile = parseHostedEducationProfile({
  version: 1,
  enabled: true,
  environment: 'synthetic-hosted',
  siteId: HOSTED_EDUCATION.siteId,
  crmOrigin: 'https://crm.example.test',
  backendOrigin: 'https://epdg.example.test',
  databaseName: 'crm_synthetic_rehearsal',
  databaseIdentity: '90000000-0000-4000-8000-000000000001',
  fixtureSourceKey: 'epdg-hosted-synthetic:unit-fixture',
  reviewers: [
    {
      memberIdSha256: hostedReviewerIdSha256(reviewerFixture.id),
      identitySha256: hostedReviewerIdentitySha256(
        reviewerFixture.id,
        reviewerFixture.email,
      ),
    },
  ],
})
const platform = {
  siteId: profile.siteId,
  deployContext: 'production',
  deployId: '6adcc1b33195872cc470df71',
}
function body(): HostedDecisionBody {
  return {
    version: 1,
    source: 'emerson-crm-synthetic',
    environment: 'synthetic-hosted',
    event_id: randomUUID(),
    person_id: FIXTURE_IDS.personId,
    application_id: FIXTURE_IDS.applicationId,
    program_id: FIXTURE_IDS.crmProgramId,
    decision_id: randomUUID(),
    decision_version: 1,
    decision: 'cleared',
    issued_at: new Date(now).toISOString(),
    policy_version: 'synthetic-onboarding-v1',
    reviewer_id: reviewerFixture.id,
    clearance: {
      identity_verified: true,
      onboarding_complete: true,
      agreements_complete: true,
      hr_approved: true,
    },
    withdrawn: false,
  }
}
const env = {
  CRM_HOSTED_EDUCATION_ENABLED: '1',
  CRM_EDUCATION_ENVIRONMENT: 'synthetic-hosted',
}
const read = (name: string) => (env as Record<string, string>)[name]
const attempt = (value = body()) =>
  signHostedEducationAttempt({
    profile,
    rawBody: serializeHostedDecision(value, { now }),
    keyBase64url: key,
    timestamp: Math.floor(now / 1000),
    nonce: randomUUID(),
    now,
  })
function receipt(
  value: HostedDecisionBody,
  overrides: Record<string, unknown> = {},
) {
  return {
    success: true,
    environment: 'synthetic-hosted',
    event_id: value.event_id,
    result: 'accepted',
    received_at: new Date(now).toISOString(),
    current_status:
      value.withdrawn || value.decision === 'revoked'
        ? 'withdrawn'
        : value.decision === 'cleared'
          ? 'ready'
          : 'held',
    decision_version: value.decision_version,
    ...overrides,
  }
}
function respond(status: number, payload: unknown) {
  let options: Record<string, unknown> | undefined
  https.request.mockImplementation((input, callback) => {
    options = input
    const req = new EventEmitter() as EventEmitter & {
      end: ReturnType<typeof vi.fn>
      setTimeout: ReturnType<typeof vi.fn>
      destroy: ReturnType<typeof vi.fn>
    }
    req.end = vi.fn(() =>
      queueMicrotask(() => {
        const res = new PassThrough() as PassThrough & {
          statusCode: number
          headers: Record<string, string>
        }
        res.statusCode = status
        res.headers = { 'content-type': 'application/json' }
        callback(res)
        res.end(JSON.stringify(payload))
      }),
    )
    req.setTimeout = vi.fn()
    req.destroy = vi.fn()
    return req
  })
  return () => options
}
beforeEach(() => https.request.mockReset())
describe('separate hosted synthetic CRM handoff', () => {
  it('remains default-off and requires compiled complete origin/database/reviewer pins', () => {
    const configured = configuredHostedEducationProfile()
    if (configured)
      expect(parseHostedEducationProfile(configured)).toEqual(configured)
    expect(
      hostedEducationAvailable(
        new Request(profile.crmOrigin + '/api/crm'),
        () => undefined,
        profile,
        platform,
      ),
    ).toBe(false)
    for (const change of [
      { enabled: false },
      { siteId: randomUUID() },
      { backendOrigin: 'http://127.0.0.1:58000' },
      { backendOrigin: 'https://epdg.example.test/path' },
      { crmOrigin: profile.backendOrigin },
      { databaseIdentity: null },
      { reviewers: [] },
      {
        reviewers: [
          {
            memberId: reviewerFixture.id,
            email: 'fake@staff.invalid',
          },
        ],
      },
    ])
      expect(() =>
        parseHostedEducationProfile({ ...profile, ...change }),
      ).toThrow()
  })
  it('commits to identities without publishing raw account pins and rejects malformed or duplicate commitments', () => {
    const encoded = JSON.stringify(profile)
    expect(encoded).not.toContain(reviewerFixture.id)
    expect(encoded).not.toContain(reviewerFixture.email)
    expect(profile.reviewers[0]).toEqual({
      memberIdSha256:
        '209e26e91657a464d6c7022f02c59b7212fe51c2d8721b95d35cad96986356b7',
      identitySha256:
        'ebf9742eada246c3d03936390ea54c3a4eae06c5f5c18c275196a037e7def17b',
    })
    for (const reviewers of [
      [{ memberId: reviewerFixture.id, email: reviewerFixture.email }],
      [{ ...profile.reviewers[0], memberIdSha256: 'A'.repeat(64) }],
      [{ ...profile.reviewers[0], identitySha256: 'a'.repeat(63) }],
      [{ ...profile.reviewers[0], email: reviewerFixture.email }],
      [
        profile.reviewers[0],
        { ...profile.reviewers[0], identitySha256: 'a'.repeat(64) },
      ],
      [
        profile.reviewers[0],
        { ...profile.reviewers[0], memberIdSha256: 'a'.repeat(64) },
      ],
    ])
      expect(() =>
        parseHostedEducationProfile({ ...profile, reviewers }),
      ).toThrow()
    expect(() =>
      hostedReviewerIdSha256('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'),
    ).toThrow()
    expect(() =>
      hostedReviewerIdentitySha256(
        reviewerFixture.id,
        'fictional@staff.invalid',
      ),
    ).toThrow()
  })
  it('requires real platform context and cannot be enabled through a URL or runtime flags alone', () => {
    const req = new Request(profile.crmOrigin + '/api/crm')
    expect(hostedEducationAvailable(req, read, profile)).toBe(false)
    expect(hostedEducationAvailable(req, read, profile, platform)).toBe(true)
    for (const change of [
      { siteId: randomUUID() },
      { deployContext: 'deploy-preview' },
      { deployId: 'invalid' },
    ])
      expect(
        hostedEducationAvailable(req, read, profile, {
          ...platform,
          ...change,
        }),
      ).toBe(false)
    expect(
      hostedEducationAvailable(
        new Request('https://other.example.test/api/crm'),
        read,
        profile,
        platform,
      ),
    ).toBe(false)
    expect(
      hostedEducationAvailable(
        req,
        (name) =>
          name === 'CRM_SYNTHETIC_EDUCATION_ENABLED' ? '1' : read(name),
        profile,
        platform,
      ),
    ).toBe(false)
    expect(
      hostedEducationAvailable(
        req,
        (name) => (name === 'SITE_ID' ? randomUUID() : read(name)),
        profile,
        platform,
      ),
    ).toBe(false)
  })
  it('matches current exact staff identity and HR authority without creating or granting membership', () => {
    const member = {
      id: reviewerFixture.id,
      email: reviewerFixture.email,
      name: 'Test reviewer',
      role: 'manager',
      active: true,
      hr: true,
      commercial: false,
      createdAt: new Date(now),
    } as EducationMember
    expect(hostedReviewerAllowed(profile, member)).toBe(true)
    expect(
      hostedReviewerAllowed(profile, {
        ...member,
        email: reviewerFixture.email.toUpperCase(),
      }),
    ).toBe(true)
    for (const change of [
      { id: randomUUID() },
      { email: 'other@emerson.example' },
      { email: 'fictional@staff.invalid' },
      { email: ` ${reviewerFixture.email}` },
      { role: 'viewer' },
      { active: false },
      { hr: false },
    ])
      expect(hostedReviewerAllowed(profile, { ...member, ...change })).toBe(
        false,
      )
    expect(hostedReviewerAllowed(profile, undefined)).toBe(false)
    for (const change of [
      { memberIdSha256: 'a'.repeat(64) },
      { identitySha256: 'a'.repeat(64) },
    ])
      expect(
        hostedReviewerAllowed(
          parseHostedEducationProfile({
            ...profile,
            reviewers: [{ ...profile.reviewers[0], ...change }],
          }),
          member,
        ),
      ).toBe(false)
  })
  it('exports only canonical fixed fictional decisions with the hosted environment', () => {
    const value = body(),
      raw = serializeHostedDecision(value, { now })
    expect(parseRawHostedDecision(raw, { now })).toEqual(value)
    for (const change of [
      { environment: 'synthetic-local' },
      { person_id: randomUUID() },
      { email: 'private@example.test' },
      { clearance: { ...value.clearance, hr_approved: false } },
      { withdrawn: true },
    ])
      expect(() =>
        parseHostedEducationDecision({ ...value, ...change }, { now }),
      ).toThrow()
    expect(() =>
      parseRawHostedDecision(
        raw.replace('"version":1', '"version":1,"version":1'),
        { now },
      ),
    ).toThrow()
    expect(() => parseRawHostedDecision(raw + ' ', { now })).toThrow()
    expect(() =>
      parseHostedEducationDecision(
        { ...value, issued_at: new Date(now - 301000).toISOString() },
        { now },
      ),
    ).toThrow()
  })
  it('signs exact bytes with a separate binary key and bound HTTPS source and audience', () => {
    const signed = attempt(),
      stamp = signed.headers['X-EPDG-Handoff-Timestamp'],
      nonce = signed.headers['X-EPDG-Handoff-Nonce']
    const expected = [
      HOSTED_EDUCATION.signingDomain,
      'POST',
      HOSTED_EDUCATION.path,
      profile.backendOrigin,
      profile.crmOrigin,
      stamp,
      nonce,
      createHash('sha256').update(signed.rawBody).digest('hex'),
    ].join('\n')
    expect(signed.headers['X-EPDG-Handoff-Signature']).toBe(
      createHmac('sha256', Buffer.from(key, 'base64url'))
        .update(expected)
        .digest('hex'),
    )
    expect(signed.headers['X-EPDG-Handoff-Audience']).toBe(
      profile.backendOrigin,
    )
    expect(signed.headers['X-EPDG-Handoff-Source']).toBe(profile.crmOrigin)
    expect(
      hostedSigningKey((name) =>
        name === 'EPDG_HOSTED_PRACTICE_HANDOFF_KEY' ? key : undefined,
      ),
    ).toBe(key)
    expect(() =>
      hostedSigningKey((name) =>
        [
          'EPDG_HOSTED_PRACTICE_HANDOFF_KEY',
          'EPDG_SYNTHETIC_CRM_HANDOFF_KEY',
        ].includes(name)
          ? key
          : undefined,
      ),
    ).toThrow()
    expect(Object.isFrozen(signed)).toBe(true)
    expect(Object.isFrozen(signed.headers)).toBe(true)
  })
  it('uses fixed certificate-verified HTTPS and accepts revoked=false-withdrawn semantics correctly', async () => {
    const value = { ...body(), decision: 'revoked' as const, withdrawn: false },
      signed = attempt(value),
      options = respond(200, receipt(value))
    const result = await sendHostedEducationAttempt(signed, { profile, now })
    expect(result.current_status).toBe('withdrawn')
    expect(options()).toMatchObject({
      hostname: 'epdg.example.test',
      port: 443,
      path: HOSTED_EDUCATION.path,
      rejectUnauthorized: true,
      agent: false,
    })
  })
  it('never follows redirects or forwards arbitrary browser credentials or destinations', async () => {
    const value = body(),
      signed = attempt(value)
    respond(302, receipt(value))
    await expect(
      sendHostedEducationAttempt(signed, { profile, now }),
    ).rejects.toThrow()
    https.request.mockReset()
    for (const altered of [
      {
        ...signed,
        target: 'https://other.example.test' + HOSTED_EDUCATION.path,
      },
      { ...signed, headers: { ...signed.headers, Cookie: 'forbidden' } },
      {
        ...signed,
        headers: {
          ...signed.headers,
          'X-EPDG-Handoff-Audience': 'https://other.example.test',
        },
      },
    ])
      await expect(
        sendHostedEducationAttempt(altered as HostedSignedAttempt, {
          profile,
          now,
        }),
      ).rejects.toThrow()
    expect(https.request).not.toHaveBeenCalled()
  })
  it('rejects contradictory or wrong-environment receipts and preserves current-state duplicate acknowledgements', async () => {
    const value = body(),
      signed = attempt(value)
    for (const change of [
      { environment: 'synthetic-local' },
      { event_id: randomUUID() },
      { current_status: 'held' },
      { decision_version: 2 },
      { privateEvidence: 'forbidden' },
      { privileged_controls_available: false },
    ]) {
      respond(200, receipt(value, change))
      await expect(
        sendHostedEducationAttempt(signed, { profile, now }),
      ).rejects.toThrow()
    }
    respond(
      200,
      receipt(value, {
        result: 'duplicate',
        current_status: 'withdrawn',
        decision_version: 2,
      }),
    )
    expect(
      (await sendHostedEducationAttempt(signed, { profile, now }))
        .current_status,
    ).toBe('withdrawn')
  })
})
