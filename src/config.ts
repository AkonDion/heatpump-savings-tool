const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/**
 * Base URL used in copied “share report” links. In the browser, defaults to the
 * current origin (so Vercel / production URLs match the tab). Optional
 * `VITE_SHARE_BASE_URL` overrides when you need a fixed canonical domain; if that
 * value is localhost but the app is opened on a real host, the live origin wins.
 */
export function getShareBaseUrl(): string {
  const envUrl = (import.meta.env.VITE_SHARE_BASE_URL as string | undefined)?.trim()

  if (typeof window !== 'undefined') {
    if (!envUrl) {
      return window.location.origin
    }

    const trimmed = trimTrailingSlash(envUrl)
    try {
      const configured = new URL(trimmed)
      const configuredLocal =
        configured.hostname === 'localhost' || configured.hostname === '127.0.0.1'
      const browsingLocal =
        window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      if (configuredLocal && !browsingLocal) {
        return window.location.origin
      }
    } catch {
      return window.location.origin
    }

    return trimmed
  }

  return trimTrailingSlash(envUrl || 'http://localhost:5173')
}

export const appConfig = {
  supabaseUrl: trimTrailingSlash(supabaseUrl),
  supabaseAnonKey,
  reportPdfFunctionUrl:
    import.meta.env.VITE_REPORT_PDF_FUNCTION_URL ??
    `${trimTrailingSlash(supabaseUrl)}/functions/v1/report-pdf`,
}
