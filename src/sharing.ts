import type { BalanceStrategy } from './calculations'
import { getShareBaseUrl } from './config'
import { supabase } from './supabase'
import type { DailyWeather } from './weather'

export type TemperatureUnit = 'f' | 'c'

export type SharedPerformanceRowInput = {
  id: string
  outdoorTempF: string
  cop: string
  capacityBtuH: string
}

export type SharedReportFormState = {
  propaneLitres: string
  propaneCost: string
  startDate: string
  endDate: string
  electricityRate: string
  modelName: string
  capacityBalancePointF: string
  strategy: BalanceStrategy
  customOffsetF: string
  performanceRows: SharedPerformanceRowInput[]
  weather: DailyWeather[]
  analysisTemperatureUnit: TemperatureUnit
}

export type ReportPdfPayload = {
  generatedAt: string
  company: {
    name: string
    product: string
  }
  report: {
    title: string
    subtitle: string
    temperatureUnit: TemperatureUnit
  }
  project: Record<string, unknown>
  inputs: Record<string, unknown>
  summary: Record<string, unknown>
  breakdown: Record<string, unknown>
  analysis: Record<string, unknown>
  dailyOperations: Record<string, unknown>[]
}

export type SharedReportRecord = {
  share_id: string
  customer_name: string
  form_state: SharedReportFormState
  report_data: ReportPdfPayload
  created_at: string
}

type CreateSharedReportInput = {
  customerName: string
  formState: SharedReportFormState
  reportData: ReportPdfPayload
}

const shareIdAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const shareIdPattern = /^[A-Za-z0-9]{4}$/

const generateShareId = () => {
  const values = new Uint32Array(4)
  crypto.getRandomValues(values)

  return Array.from(values, (value) => shareIdAlphabet[value % shareIdAlphabet.length]).join('')
}

const isUniqueViolation = (error: { code?: string; message?: string }) =>
  error.code === '23505' || error.message?.toLowerCase().includes('duplicate key')

export const getSharedReportIdFromPath = (pathname: string) => {
  const candidate = pathname.replace(/^\/+|\/+$/g, '')

  return shareIdPattern.test(candidate) ? candidate : null
}

export const getShareUrl = (shareId: string) => `${getShareBaseUrl()}/${shareId}`

export async function createSharedReport({
  customerName,
  formState,
  reportData,
}: CreateSharedReportInput) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const shareId = generateShareId()
    const { data, error } = await supabase
      .from('shared_reports')
      .insert({
        share_id: shareId,
        customer_name: customerName.trim(),
        form_state: formState,
        report_data: reportData,
      })
      .select('share_id')
      .single()

    if (!error && data?.share_id) {
      return {
        shareId: data.share_id,
        shareUrl: getShareUrl(data.share_id),
      }
    }

    if (!error || !isUniqueViolation(error)) {
      throw new Error(error?.message ?? 'The report could not be shared.')
    }
  }

  throw new Error('Could not generate a unique share ID. Try sharing again.')
}

export async function loadSharedReport(shareId: string) {
  const { data, error } = await supabase
    .from('shared_reports')
    .select(
      'share_id, customer_name, form_state, report_data, created_at',
    )
    .eq('share_id', shareId)
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data as SharedReportRecord
}

export function buildSharedFormState({
  propaneLitres,
  propaneCost,
  startDate,
  endDate,
  electricityRate,
  modelName,
  capacityBalancePointF,
  strategy,
  customOffsetF,
  performanceRows,
  weather,
  analysisTemperatureUnit,
}: SharedReportFormState) {
  return {
    propaneLitres,
    propaneCost,
    startDate,
    endDate,
    electricityRate,
    modelName,
    capacityBalancePointF,
    strategy,
    customOffsetF,
    performanceRows,
    weather,
    analysisTemperatureUnit,
  }
}
