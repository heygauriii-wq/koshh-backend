// Used by the bound-elsewhere recovery DM path to keep raw emails out of
// outbound payloads. 'gauri@example.com' → 'g***@e***.com'.

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';

  const [domainName, ...tldParts] = domain.split('.');
  const tld = tldParts.join('.') || '';

  const mask = (s: string) => s.length <= 1 ? '***' : s[0] + '***';

  return `${mask(local)}@${mask(domainName)}${tld ? '.' + tld : ''}`;
}
