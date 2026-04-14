const numberFormatter = new Intl.NumberFormat('en-CA')

export const formatCurrency = (value: number, fractionDigits = 0) =>
  new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)

export const formatNumber = (value: number, fractionDigits = 0) =>
  numberFormatter.format(Number(value.toFixed(fractionDigits)))

export const formatRate = (value: number) => `${formatCurrency(value, 3)}/kWh`

export const formatPercent = (value: number, fractionDigits = 0) =>
  `${formatNumber(value * 100, fractionDigits)}%`
