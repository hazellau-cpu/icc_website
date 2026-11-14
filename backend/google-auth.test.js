const test = require('node:test');
const assert = require('node:assert/strict');
const { assertAllowedDomain, isGoogleEmailAllowed } = require('./google-auth');

test('allows exact Google account matches, but not other Gmail users', () => {
  const allowedEmails = new Set(['center@example.com']);
  assert.equal(isGoogleEmailAllowed('CENTER@example.com', allowedEmails, ''), true);
  assert.equal(isGoogleEmailAllowed('another@gmail.com', allowedEmails, ''), false);
});

test('allows an explicitly configured organization domain', () => {
  assert.equal(isGoogleEmailAllowed('staff@center.example', new Set(), 'center.example'), true);
  assert.equal(isGoogleEmailAllowed('staff@other.example', new Set(), 'center.example'), false);
});

test('rejects broad personal Gmail domain allowlists', () => {
  assert.throws(() => assertAllowedDomain('gmail.com'), /GOOGLE_ALLOWED_EMAILS/);
  assert.throws(() => assertAllowedDomain('googlemail.com'), /GOOGLE_ALLOWED_EMAILS/);
  assert.doesNotThrow(() => assertAllowedDomain('center.example'));
});
