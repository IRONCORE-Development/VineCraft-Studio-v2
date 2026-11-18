// Phase 0 Security Specification Reference — Dirty Dozen Validation Matrix
// Run against Firebase Emulator if emulator suite is installed.

export const DIRTY_DOZEN_PAYLOADS = [
  { name: 'unauthenticated_read', path: 'users/u1/reviews/r1', auth: null, expected: 'PERMISSION_DENIED' },
  { name: 'unverified_email_create', path: 'users/u1', auth: { uid: 'u1', token: { email_verified: false } }, expected: 'PERMISSION_DENIED' },
  { name: 'cross_tenant_list', path: 'users/u1/reviews', auth: { uid: 'u2', token: { email_verified: true } }, expected: 'PERMISSION_DENIED' },
  { name: 'identity_spoof_ownerId', path: 'users/u1/reviews/r1', data: { ownerId: 'u2' }, expected: 'PERMISSION_DENIED' },
  { name: 'shadow_field_isAdmin', path: 'users/u1', data: { isAdmin: true }, expected: 'PERMISSION_DENIED' },
  { name: 'id_poisoning_length', path: `users/u1/reviews/${'a'.repeat(200)}`, expected: 'PERMISSION_DENIED' },
  { name: 'timestamp_forgery', path: 'users/u1/reviews/r1', data: { createdAt: '2025-01-01T00:00:00Z' }, expected: 'PERMISSION_DENIED' },
  { name: 'invalid_asin_injection', path: 'users/u1/reviews/r1', data: { asin: 'bad<script>' }, expected: 'PERMISSION_DENIED' },
  { name: 'oversized_body_dos', path: 'users/u1/reviews/r1', data: { draftBody: 'x'.repeat(25000) }, expected: 'PERMISSION_DENIED' },
  { name: 'unbounded_strengths_array', path: 'users/u1/reviews/r1', data: { qualityStrengths: Array(30).fill('good') }, expected: 'PERMISSION_DENIED' },
  { name: 'terminal_posted_mutation', path: 'users/u1/reviews/r1', existingStatus: 'posted', data: { status: 'queued' }, expected: 'PERMISSION_DENIED' },
  { name: 'immutable_asin_mutation', path: 'users/u1/reviews/r1', data: { asin: 'B000000002' }, expected: 'PERMISSION_DENIED' },
];
