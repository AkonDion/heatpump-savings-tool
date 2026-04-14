const numberFormatter = new Intl.NumberFormat('en-CA')

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const finiteNumber = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const formatCurrency = (value, fractionDigits = 0) =>
  new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(finiteNumber(value))

const formatNumber = (value, fractionDigits = 0) =>
  numberFormatter.format(Number(finiteNumber(value).toFixed(fractionDigits)))

const formatPercent = (value, fractionDigits = 0) => `${formatNumber(finiteNumber(value) * 100, fractionDigits)}%`

const toCelsius = (fahrenheit) => ((finiteNumber(fahrenheit) - 32) * 5) / 9

const formatTemperature = (valueF, unit = 'c', fractionDigits = 1) => {
  if (valueF === null || valueF === undefined || !Number.isFinite(Number(valueF))) {
    return '&mdash;'
  }

  const value = unit === 'c' ? toCelsius(valueF) : finiteNumber(valueF)
  return `${formatNumber(value, fractionDigits)}&deg;${unit.toUpperCase()}`
}

const formatTemperatureDelta = (deltaF, unit = 'c', fractionDigits = 1) => {
  const value = unit === 'c' ? (finiteNumber(deltaF) * 5) / 9 : finiteNumber(deltaF)
  return `${formatNumber(value, fractionDigits)}&deg;${unit.toUpperCase()}`
}

const formatDate = (value) => {
  if (!value) return 'Not specified'

  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return escapeHtml(value)

  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

const formatGeneratedAt = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

const operationBandLabel = (band, unit) => {
  switch (band?.id) {
    case 'near':
      return `Near cutout: ${formatTemperatureDelta(0, unit)} to ${formatTemperatureDelta(5, unit)} above`
    case 'moderate':
      return `Moderate heat pump zone: ${formatTemperatureDelta(5, unit)} to ${formatTemperatureDelta(15, unit)} above`
    case 'mild':
      return `Warm / low-heating zone: ${formatTemperatureDelta(15, unit)}+ above`
    default:
      return escapeHtml(band?.label ?? 'Unknown')
  }
}

const copRangeLabel = (range, unit) => {
  switch (range?.type) {
    case 'single-point':
      return `Single point at ${formatTemperature(range.lowerTempF, unit)}`
    case 'clamp-cold':
      return `Clamped at ${formatTemperature(range.lowerTempF, unit)}`
    case 'clamp-warm':
      return `Clamped at ${formatTemperature(range.lowerTempF, unit)}`
    case 'interpolate':
      return `${formatTemperature(range.lowerTempF, unit)} to ${formatTemperature(range.upperTempF, unit)}`
    default:
      return 'No valid COP points'
  }
}

const metricCard = ({ label, value, note = '' }) => `
  <div class="metric-card">
    <div class="metric-label">${escapeHtml(label)}</div>
    <div class="metric-value">${value}</div>
    ${note ? `<div class="metric-note">${escapeHtml(note)}</div>` : ''}
  </div>
`

const detailRow = (label, value) => `
  <tr>
    <th>${escapeHtml(label)}</th>
    <td>${value}</td>
  </tr>
`

const barRow = (label, value, width, variant = '') => `
  <div class="bar-row">
    <div class="bar-meta">
      <span>${escapeHtml(label)}</span>
      <strong>${value}</strong>
    </div>
    <div class="bar-track">
      <span class="bar-fill ${variant}" style="width: ${clamp(width, 2, 100).toFixed(2)}%"></span>
    </div>
  </div>
`

const renderOperationBands = (bands = [], unit) =>
  bands
    .map(
      (band) => `
        <tr>
          <td>${operationBandLabel(band, unit)}</td>
          <td class="num">${formatNumber(band.dayCount)}</td>
          <td class="num">${formatPercent(band.dayShare, 1)}</td>
          <td class="num">${formatTemperature(band.averageMeanTempF, unit)}</td>
          <td class="num">${formatTemperature(band.averageMinTempF, unit)}</td>
          <td class="num">${formatTemperature(band.averageMaxTempF, unit)}</td>
          <td class="num">${band.averageCop === null ? '&mdash;' : formatNumber(band.averageCop, 2)}</td>
          <td>${escapeHtml(band.interpretation)}</td>
        </tr>
      `,
    )
    .join('')

const renderDailyRows = (days = [], unit) =>
  days
    .map(
      (day) => `
        <tr>
          <td>${escapeHtml(day.date)}</td>
          <td class="num">${formatTemperature(day.meanTempF, unit)}</td>
          <td class="num">${formatTemperature(day.minTempF, unit)}</td>
          <td class="num">${formatTemperature(day.maxTempF, unit)}</td>
          <td>${escapeHtml(day.context)}</td>
          <td class="num">${formatNumber(day.cop, 2)}</td>
          <td class="num">${formatPercent(day.fractionAboveCutout, 0)}</td>
          <td class="num">${formatPercent(day.fractionBelowCutout, 0)}</td>
          <td class="num">${formatCurrency(day.backupCost)}</td>
        </tr>
      `,
    )
    .join('')

const renderPerformancePoints = (points = [], unit) =>
  points
    .map(
      (point) => `
        <tr>
          <td>${formatTemperature(point.outdoorTempF, unit)}</td>
          <td class="num">${formatNumber(point.cop, 2)}</td>
          <td class="num">${
            point.capacityBtuH === null || point.capacityBtuH === undefined
              ? '&mdash;'
              : `${formatNumber(point.capacityBtuH)} Btu/h`
          }</td>
        </tr>
      `,
    )
    .join('')

const renderCopRanges = (ranges = [], unit) =>
  ranges
    .map(
      (range) => `
        <tr>
          <td>${copRangeLabel(range, unit)}</td>
          <td class="num">${formatNumber(range.dayCount)}</td>
          <td class="num">${formatNumber(range.heatPumpHeatKwh)} kWh</td>
        </tr>
      `,
    )
    .join('')

const reportStyles = `
  @page {
    size: Letter;
  }

  * {
    box-sizing: border-box;
  }

  html,
  body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #1f2933;
    font-family: Inter, Arial, Helvetica, sans-serif;
    font-size: 10.5px;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  body {
    min-width: 0;
  }

  h1,
  h2,
  h3,
  p {
    margin: 0;
  }

  .report {
    width: 100%;
  }

  .document-header {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 24px;
    padding-bottom: 18px;
    border-bottom: 2px solid #0f766e;
    break-after: avoid-page;
  }

  .eyebrow {
    color: #0f766e;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h1 {
    margin-top: 7px;
    color: #111827;
    font-size: 28px;
    line-height: 1.05;
    letter-spacing: -0.01em;
  }

  .subtitle {
    margin-top: 8px;
    max-width: 420px;
    color: #4b5563;
    font-size: 11px;
  }

  .meta-panel {
    min-width: 178px;
    border: 1px solid #d8e2e0;
    border-radius: 6px;
    padding: 10px 12px;
  }

  .meta-panel div + div {
    margin-top: 7px;
  }

  .meta-label {
    display: block;
    color: #6b7280;
    font-size: 7.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .meta-value {
    display: block;
    margin-top: 2px;
    color: #111827;
    font-size: 10px;
    font-weight: 700;
  }

  .section {
    margin-top: 18px;
    break-inside: auto;
  }

  .section.compact,
  .summary-band,
  .metric-card,
  .bar-comparison,
  .method-box {
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  .section-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 8px;
    break-after: avoid-page;
  }

  h2 {
    color: #111827;
    font-size: 15px;
    line-height: 1.2;
  }

  h3 {
    color: #111827;
    font-size: 11px;
    line-height: 1.25;
  }

  .section-kicker {
    color: #6b7280;
    font-size: 9px;
    font-weight: 700;
  }

  .summary-band {
    display: grid;
    grid-template-columns: 1fr 1.18fr;
    gap: 16px;
    padding: 18px;
    border: 1px solid #d8e2e0;
    border-radius: 8px;
    background: #f7fbfa;
  }

  .savings-label {
    color: #4b5563;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .savings-value {
    margin-top: 5px;
    color: #0f766e;
    font-size: 38px;
    font-weight: 800;
    line-height: 1;
  }

  .savings-value.negative {
    color: #b42318;
  }

  .summary-copy {
    margin-top: 9px;
    color: #374151;
    font-size: 10.5px;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .metric-card {
    min-height: 62px;
    border: 1px solid #d8e2e0;
    border-radius: 6px;
    padding: 10px;
    background: #ffffff;
  }

  .metric-label {
    color: #64748b;
    font-size: 7.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .metric-value {
    margin-top: 5px;
    color: #111827;
    font-size: 17px;
    font-weight: 800;
    line-height: 1.05;
  }

  .metric-note {
    margin-top: 3px;
    color: #64748b;
    font-size: 8.5px;
  }

  .two-column {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  .three-column {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .bar-comparison {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 12px;
    background: #ffffff;
  }

  .bar-row + .bar-row {
    margin-top: 10px;
  }

  .bar-meta {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: #374151;
    font-size: 9.5px;
  }

  .bar-track {
    position: relative;
    height: 9px;
    margin-top: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: #e5e7eb;
  }

  .bar-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: #0f766e;
  }

  .bar-fill.dark {
    background: #1f2937;
  }

  .method-box {
    border-left: 3px solid #0f766e;
    padding: 8px 0 8px 12px;
    color: #374151;
  }

  .method-box p + p {
    margin-top: 6px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  thead {
    display: table-header-group;
  }

  tr {
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  th,
  td {
    padding: 6px 6px;
    border-bottom: 1px solid #e5e7eb;
    vertical-align: top;
    overflow-wrap: anywhere;
  }

  th {
    color: #64748b;
    font-size: 7.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-align: left;
    text-transform: uppercase;
  }

  td {
    color: #1f2937;
    font-size: 9px;
  }

  .detail-table th {
    width: 47%;
  }

  .detail-table td {
    font-weight: 700;
  }

  .num {
    text-align: right;
    white-space: nowrap;
  }

  .appendix {
    page-break-before: always;
  }

  .daily-table th,
  .daily-table td {
    padding: 4px 5px;
    font-size: 7.4px;
  }

  .note {
    margin-top: 8px;
    color: #64748b;
    font-size: 8.5px;
  }
`

export function renderReportPdfHtml(report = {}) {
  const unit = report.report?.temperatureUnit === 'f' ? 'f' : 'c'
  const summary = report.summary ?? {}
  const breakdown = report.breakdown ?? {}
  const analysis = report.analysis ?? {}
  const inputs = report.inputs ?? {}
  const project = report.project ?? {}
  const maxCost = Math.max(finiteNumber(summary.propaneCost), finiteNumber(summary.totalHybridCost), 1)
  const propaneBarWidth = (finiteNumber(summary.propaneCost) / maxCost) * 100
  const hybridBarWidth = (finiteNumber(summary.totalHybridCost) / maxCost) * 100
  const savingsPositive = finiteNumber(summary.estimatedSavings) >= 0
  const generatedAt = formatGeneratedAt(report.generatedAt)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(report.report?.title ?? 'Propane to heat pump savings report')}</title>
    <style>${reportStyles}</style>
  </head>
  <body data-report-ready="true">
    <main class="report">
      <header class="document-header">
        <div>
          <p class="eyebrow">${escapeHtml(report.company?.name ?? 'Comfort Hub')} ${escapeHtml(
            report.company?.product ?? 'Hybrid heating estimator',
          )}</p>
          <h1>${escapeHtml(report.report?.title ?? 'Propane to heat pump savings report')}</h1>
          <p class="subtitle">${escapeHtml(
            report.report?.subtitle ?? 'Weather-aware hybrid operating-cost estimate',
          )}</p>
        </div>
        <aside class="meta-panel">
          <div>
            <span class="meta-label">Heat pump model</span>
            <span class="meta-value">${escapeHtml(project.modelName)}</span>
          </div>
          <div>
            <span class="meta-label">Analysis period</span>
            <span class="meta-value">${formatDate(project.analysisStartDate)} to ${formatDate(
              project.analysisEndDate,
            )}</span>
          </div>
          <div>
            <span class="meta-label">Generated</span>
            <span class="meta-value">${escapeHtml(generatedAt)}</span>
          </div>
        </aside>
      </header>

      <section class="section compact">
        <div class="summary-band">
          <div>
            <p class="savings-label">${savingsPositive ? 'Estimated annual savings' : 'Estimated annual increase'}</p>
            <p class="savings-value ${savingsPositive ? '' : 'negative'}">${formatCurrency(
              Math.abs(finiteNumber(summary.estimatedSavings)),
            )}</p>
            <p class="summary-copy">
              Compared with the entered propane spend for ${escapeHtml(project.modelName)} using Ottawa historical weather from
              ${formatDate(project.weatherStartDate)} to ${formatDate(project.weatherEndDate)}.
            </p>
          </div>
          <div class="summary-grid">
            ${metricCard({ label: 'Current propane cost', value: formatCurrency(summary.propaneCost) })}
            ${metricCard({ label: 'Projected hybrid cost', value: formatCurrency(summary.totalHybridCost) })}
            ${metricCard({ label: 'Heat pump electricity', value: formatCurrency(summary.totalHeatPumpCost) })}
            ${metricCard({ label: 'Backup propane', value: formatCurrency(summary.totalBackupCost) })}
          </div>
        </div>
      </section>

      <section class="section compact two-column">
        <div class="bar-comparison">
          <div class="section-title">
            <h2>Operating Cost Comparison</h2>
            <span class="section-kicker">CAD</span>
          </div>
          ${barRow('Current propane', formatCurrency(summary.propaneCost), propaneBarWidth, 'dark')}
          ${barRow('Projected hybrid', formatCurrency(summary.totalHybridCost), hybridBarWidth)}
          <p class="note">Bars compare annualized operating cost for the analyzed heating period.</p>
        </div>

        <table class="detail-table">
          <tbody>
            ${detailRow('Propane entered', `${formatNumber(inputs.propaneLitres)} L`)}
            ${detailRow('Electricity rate', `${formatCurrency(inputs.electricityRate, 3)}/kWh`)}
            ${detailRow('Capacity balance point', formatTemperature(inputs.capacityBalancePointF, unit))}
            ${detailRow('Control strategy', escapeHtml(inputs.strategyLabel))}
            ${detailRow('Effective cutout', formatTemperature(breakdown.effectiveCutoutTempF, unit))}
            ${detailRow('Days analyzed', formatNumber(breakdown.daysAnalyzed))}
          </tbody>
        </table>
      </section>

      <section class="section compact">
        <div class="section-title">
          <h2>Executive Interpretation</h2>
        </div>
        <div class="method-box">
          <p>
            The estimate converts the entered propane litres into delivered space-heating energy using a 95% furnace efficiency, then distributes that load across Ottawa daily weather.
          </p>
          <p>
            Heat pump performance is estimated from the entered NEEP COP points. Days above the effective cutout are assigned to the heat pump where capacity allows; days below the cutout remain on backup propane.
          </p>
          <p>
            Electricity cost and backup propane cost are combined and compared with the entered propane bill to estimate the operating-cost difference.
          </p>
        </div>
      </section>

      <section class="section two-column">
        <div>
          <div class="section-title">
            <h2>Calculation Breakdown</h2>
          </div>
          <table class="detail-table">
            <tbody>
              ${detailRow('Delivered heat', `${formatNumber(breakdown.deliveredHeatKwh)} kWh`)}
              ${detailRow('Propane cost per delivered kWh', `${formatCurrency(
                breakdown.propaneCostPerDeliveredKwh,
                3,
              )}/kWh`)}
              ${detailRow('Break-even COP', formatNumber(breakdown.breakEvenCop, 2))}
              ${detailRow('Load-weighted active COP', formatNumber(breakdown.weightedAverageCop, 2))}
              ${detailRow('Total heat pump energy', `${formatNumber(summary.totalHeatPumpKwh)} kWh`)}
              ${detailRow('Total backup propane', `${formatNumber(summary.totalBackupLitres)} L`)}
              ${detailRow('Heat pump heat share', formatPercent(summary.heatPumpShare, 1))}
              ${detailRow('Backup heat share', formatPercent(summary.backupHeatShare, 1))}
            </tbody>
          </table>
        </div>

        <div>
          <div class="section-title">
            <h2>Weather Summary</h2>
          </div>
          <table class="detail-table">
            <tbody>
              ${detailRow('Average daily mean', formatTemperature(analysis.weatherDistribution?.averageDailyMeanF, unit))}
              ${detailRow('Coldest daily minimum', formatTemperature(analysis.weatherDistribution?.coldestDailyMinimumF, unit))}
              ${detailRow('Warmest daily maximum', formatTemperature(analysis.weatherDistribution?.warmestDailyMaximumF, unit))}
              ${detailRow('Days near cutout', formatNumber(analysis.weatherDistribution?.daysNearCutout))}
              ${detailRow('Fully above cutout', formatNumber(breakdown.daysFullyAboveCutout))}
              ${detailRow('Partly crossing cutout', formatNumber(breakdown.daysPartiallyCrossingCutout))}
              ${detailRow('Fully below cutout', formatNumber(breakdown.daysFullyBelowCutout))}
              ${detailRow('Active heat pump days', formatNumber(breakdown.activeHeatPumpDays))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="section">
        <div class="section-title">
          <h2>Temperature Operating Zones</h2>
          <span class="section-kicker">Weather-weighted operating view</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Band</th>
              <th class="num">Days</th>
              <th class="num">% Days</th>
              <th class="num">Avg Mean</th>
              <th class="num">Avg Min</th>
              <th class="num">Avg Max</th>
              <th class="num">Avg COP</th>
              <th>Interpretation</th>
            </tr>
          </thead>
          <tbody>
            ${renderOperationBands(analysis.operationBands, unit)}
          </tbody>
        </table>
      </section>

      <section class="section two-column">
        <div>
          <div class="section-title">
            <h2>NEEP Performance Points</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Outdoor temp</th>
                <th class="num">COP</th>
                <th class="num">Heating capacity</th>
              </tr>
            </thead>
            <tbody>
              ${renderPerformancePoints(inputs.performancePoints, unit)}
            </tbody>
          </table>
        </div>

        <div>
          <div class="section-title">
            <h2>COP Interpolation Use</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Temperature range</th>
                <th class="num">Days</th>
                <th class="num">Heat served</th>
              </tr>
            </thead>
            <tbody>
              ${renderCopRanges(analysis.copRangeSummary, unit)}
            </tbody>
          </table>
        </div>
      </section>

      <section class="section appendix">
        <div class="section-title">
          <h2>Daily Weather and Operation Appendix</h2>
          <span class="section-kicker">${formatNumber(report.dailyOperations?.length ?? 0)} daily records</span>
        </div>
        <table class="daily-table">
          <thead>
            <tr>
              <th>Date</th>
              <th class="num">Mean</th>
              <th class="num">Min</th>
              <th class="num">Max</th>
              <th>Operating context</th>
              <th class="num">COP</th>
              <th class="num">HP share</th>
              <th class="num">Backup</th>
              <th class="num">Backup cost</th>
            </tr>
          </thead>
          <tbody>
            ${renderDailyRows(report.dailyOperations, unit)}
          </tbody>
        </table>
      </section>
    </main>
  </body>
</html>`
}

export const getReportPdfOptions = () => ({
  format: 'Letter',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="box-sizing:border-box;width:100%;padding:0 0.55in;color:#6b7280;font-family:Arial,Helvetica,sans-serif;font-size:7px;"><span>Comfort Hub hybrid heating report</span><span style="float:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
  margin: {
    top: '0.55in',
    right: '0.55in',
    bottom: '0.62in',
    left: '0.55in',
  },
})

export const getReportPdfViewport = () => ({
  width: 816,
  height: 1056,
  deviceScaleFactor: 1,
})
