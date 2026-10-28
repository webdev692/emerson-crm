// This gate deliberately rejects hosted contexts, even when someone sets the
// local rehearsal flag there. It never reads a signing key or contacts a service.
export function syntheticEducationAvailable(
  request: Request,
  read: (name: string) => string | undefined,
): boolean {
  const url = new URL(request.url)
  return (
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    !url.username &&
    !url.password &&
    read('CRM_SYNTHETIC_EDUCATION_ENABLED') === '1' &&
    read('CRM_EDUCATION_ENVIRONMENT') === 'synthetic-local' &&
    !['SITE_ID', 'DEPLOY_ID', 'CONTEXT', 'NETLIFY'].some((key) => read(key))
  )
}
