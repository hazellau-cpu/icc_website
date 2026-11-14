const PERSONAL_GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

function assertAllowedDomain(domain) {
  const normalized = String(domain || '').trim().toLowerCase();
  if (PERSONAL_GMAIL_DOMAINS.has(normalized)) {
    throw new Error('Use GOOGLE_ALLOWED_EMAILS for Gmail accounts; a Gmail domain allowlist is not permitted.');
  }
}

function isGoogleEmailAllowed(email, allowedEmails, allowedDomain) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (allowedEmails.has(normalizedEmail)) return true;
  const domain = String(allowedDomain || '').trim().toLowerCase();
  return Boolean(domain && !PERSONAL_GMAIL_DOMAINS.has(domain) && normalizedEmail.endsWith(`@${domain}`));
}

module.exports = { assertAllowedDomain, isGoogleEmailAllowed };
