import { getReportPdfOptions, getReportPdfViewport, renderReportPdfHtml } from './reportPdf.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const defaultFilename = 'comfort-hub-hybrid-heating-report.pdf'

const sanitizeFilename = (filename: unknown) =>
  typeof filename === 'string' && filename.trim()
    ? filename.replace(/[^a-z0-9._-]/gi, '-').toLowerCase()
    : defaultFilename

const jsonResponse = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  const browserlessApiKey = Deno.env.get('BROWSERLESS_API_KEY') ?? Deno.env.get('BROWSERLESS_TOKEN')

  if (!browserlessApiKey) {
    return jsonResponse({ error: 'Browserless API key is not configured.' }, 500)
  }

  let body: { report?: unknown; filename?: unknown }

  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400)
  }

  if (!body.report || typeof body.report !== 'object') {
    return jsonResponse({ error: 'Report data is required.' }, 400)
  }

  const endpoint = Deno.env.get('BROWSERLESS_PDF_ENDPOINT') ?? 'https://production-sfo.browserless.io/chrome/pdf'
  const browserlessUrl = new URL(endpoint)
  browserlessUrl.searchParams.set('token', browserlessApiKey)

  try {
    const browserlessResponse = await fetch(browserlessUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: renderReportPdfHtml(body.report),
        emulateMediaType: 'print',
        waitForTimeout: 100,
        viewport: getReportPdfViewport(),
        options: getReportPdfOptions(),
      }),
    })

    if (!browserlessResponse.ok) {
      await browserlessResponse.arrayBuffer()
      return jsonResponse(
        { error: `Browserless PDF generation failed with status ${browserlessResponse.status}.` },
        502,
      )
    }

    const pdf = await browserlessResponse.arrayBuffer()

    return new Response(pdf, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${sanitizeFilename(body.filename)}"`,
        'Content-Length': String(pdf.byteLength),
      },
    })
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'PDF generation failed.' },
      502,
    )
  }
})
