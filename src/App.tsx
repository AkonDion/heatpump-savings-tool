import { useEffect, useMemo, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import {
  calculateWeatherAwareSavings,
  filterValidPerformancePoints,
  getStrategyOffset,
  getWeightedAverageCopForHeatPumpLoad,
  summarizeCopInterpolationRanges,
  summarizeOperationBands,
  summarizeWeatherDistribution,
  type BalanceStrategy,
  type DailyOperation,
  type HeatingPerformancePoint,
  type WeatherAwareCalculationResult,
} from './calculations'
import { formatCurrency, formatNumber, formatPercent } from './format'
import {
  buildSharedFormState,
  createSharedReport,
  getSharedReportIdFromPath,
  loadSharedReport,
  type ReportPdfPayload,
  type SharedReportRecord,
  type TemperatureUnit,
} from './sharing'
import { useAuth } from './auth'
import { appConfig } from './config'
import { fetchOttawaHistoricalWeather, type DailyWeather } from './weather'

type WeatherState =
  | { status: 'idle'; data: DailyWeather[]; error: null }
  | { status: 'loading'; data: DailyWeather[]; error: null }
  | { status: 'success'; data: DailyWeather[]; error: null }
  | { status: 'error'; data: DailyWeather[]; error: string }

type PerformanceRowInput = {
  id: string
  outdoorTempF: string
  cop: string
  capacityBtuH: string
}

type CalculationView =
  | { result: WeatherAwareCalculationResult; error: null }
  | { result: null; error: string | null }

type PdfDownloadState =
  | { status: 'idle'; error: null }
  | { status: 'loading'; error: null }
  | { status: 'error'; error: string }

type SharedLoadState =
  | { status: 'idle'; record: null; error: null }
  | { status: 'loading'; record: null; error: null }
  | { status: 'success'; record: SharedReportRecord; error: null }
  | { status: 'error'; record: null; error: string }

type ShareDialogState = {
  isOpen: boolean
  name: string
  address: string
  email: string
  status: 'idle' | 'loading' | 'success' | 'error'
  shareUrl: string | null
  error: string | null
}

const defaultCustomerInputs = {
  propaneLitres: '',
  propaneCost: '',
  startDate: '',
  endDate: '',
  electricityRate: '',
}

const defaultNeepInputs = {
  modelName: '',
  capacityBalancePointF: '',
  strategy: 'standard' as BalanceStrategy,
  customOffsetF: '',
}

const defaultPerformanceRows: PerformanceRowInput[] = [
  { id: 'point-1', outdoorTempF: '', cop: '', capacityBtuH: '' },
  { id: 'point-2', outdoorTempF: '', cop: '', capacityBtuH: '' },
  { id: 'point-3', outdoorTempF: '', cop: '', capacityBtuH: '' },
]

const preloadCustomerInputs = {
  propaneLitres: '3763',
  propaneCost: '2945.25',
  startDate: '2025-03-19',
  endDate: '2026-03-12',
  electricityRate: '0.12',
}

const preloadNeepInputs = {
  modelName: 'DH7VSA2410A',
  capacityBalancePointF: '22',
  strategy: 'standard' as BalanceStrategy,
  customOffsetF: '',
}

const preloadPerformanceRows: PerformanceRowInput[] = [
  { id: 'preload-5', outdoorTempF: '5', cop: '2.0', capacityBtuH: '17000' },
  { id: 'preload-17', outdoorTempF: '17', cop: '2.4', capacityBtuH: '22000' },
  { id: 'preload-47', outdoorTempF: '47', cop: '3.0', capacityBtuH: '23200' },
]

const parseNumberInput = (value: string) => {
  if (value.trim() === '' || value === '-' || value === '.' || value === '-.') {
    return Number.NaN
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

const sanitizeNumberInput = (value: string, allowNegative = false) => {
  if (value === '' || value === '-' || value === '.' || value === '-.') {
    return value
  }

  const parsed = Number(value)
  return !allowNegative && Number.isFinite(parsed) && parsed < 0 ? '0' : value
}

const sortRowsByOutdoorTemp = (rows: PerformanceRowInput[]) =>
  [...rows].sort((a, b) => {
    const aTemp = parseNumberInput(a.outdoorTempF)
    const bTemp = parseNumberInput(b.outdoorTempF)

    if (!Number.isFinite(aTemp)) return 1
    if (!Number.isFinite(bTemp)) return -1
    return aTemp - bTemp
  })

const reportPdfFilename = 'comfort-hub-hybrid-heating-report.pdf'

const defaultShareDialogState: ShareDialogState = {
  isOpen: false,
  name: '',
  address: '',
  email: '',
  status: 'idle',
  shareUrl: null,
  error: null,
}

const isValidDateRange = (startDate: string, endDate: string) =>
  Boolean(startDate && endDate && startDate <= endDate)

const getStrategyLabel = (strategy: BalanceStrategy) => {
  switch (strategy) {
    case 'strict':
      return 'Strict: balance point + 5°F'
    case 'standard':
      return 'Standard: balance point'
    case 'loose':
      return 'Loose: balance point - 5°F'
    case 'custom':
      return 'Custom offset'
  }
}

const buildReportPdfPayload = ({
  result,
  weather,
  performancePoints,
  modelName,
  startDate,
  endDate,
  propaneLitres,
  propaneCost,
  electricityRate,
  capacityBalancePointF,
  strategy,
  strategyOffsetF,
  temperatureUnit,
}: {
  result: WeatherAwareCalculationResult
  weather: DailyWeather[]
  performancePoints: HeatingPerformancePoint[]
  modelName: string
  startDate: string
  endDate: string
  propaneLitres: number
  propaneCost: number
  electricityRate: number
  capacityBalancePointF: number
  strategy: BalanceStrategy
  strategyOffsetF: number
  temperatureUnit: TemperatureUnit
}): ReportPdfPayload => {
  const operationBands = summarizeOperationBands(result.dailyOperations, result.effectiveCutoutTempF)
  const weatherDistribution = summarizeWeatherDistribution(result.dailyOperations, result.effectiveCutoutTempF)
  const copRangeSummary = summarizeCopInterpolationRanges(result.dailyOperations, performancePoints)
  const weightedAverageCop = getWeightedAverageCopForHeatPumpLoad(result.dailyOperations)
  const heatPumpShare = result.deliveredHeatKwh > 0 ? result.totalHeatPumpHeatKwh / result.deliveredHeatKwh : 0
  const interpolationRanges = performancePoints.slice(1).map((point, index) => ({
    from: performancePoints[index],
    to: point,
  }))

  return {
    generatedAt: new Date().toISOString(),
    company: {
      name: 'Comfort Hub',
      product: 'Hybrid heating estimator',
    },
    report: {
      title: 'Propane to heat pump savings report',
      subtitle: 'Weather-aware hybrid operating-cost estimate',
      temperatureUnit,
    },
    project: {
      modelName: modelName.trim() || 'Selected heat pump',
      location: 'Ottawa, Ontario',
      analysisStartDate: startDate,
      analysisEndDate: endDate,
      weatherStartDate: weather[0]?.date ?? startDate,
      weatherEndDate: weather[weather.length - 1]?.date ?? endDate,
    },
    inputs: {
      propaneLitres,
      propaneCost,
      electricityRate,
      capacityBalancePointF,
      strategy,
      strategyLabel: getStrategyLabel(strategy),
      strategyOffsetF,
      performancePoints,
    },
    summary: {
      estimatedSavings: result.estimatedSavings,
      propaneCost,
      totalHybridCost: result.totalHybridCost,
      totalHeatPumpCost: result.totalHeatPumpCost,
      totalBackupCost: result.totalBackupCost,
      totalHeatPumpKwh: result.totalHeatPumpKwh,
      totalBackupLitres: result.totalBackupLitres,
      heatPumpShare,
      backupHeatShare: result.backupHeatShare,
    },
    breakdown: {
      deliveredHeatKwh: result.deliveredHeatKwh,
      propaneCostPerDeliveredKwh: result.propaneCostPerDeliveredKwh,
      breakEvenCop: result.breakEvenCop,
      effectiveCutoutTempF: result.effectiveCutoutTempF,
      buildingUA: result.buildingUA,
      totalHeatPumpHeatKwh: result.totalHeatPumpHeatKwh,
      totalBackupHeatKwh: result.totalBackupHeatKwh,
      averageInterpolatedCop: result.averageInterpolatedCop,
      weightedAverageCop,
      daysAnalyzed: result.daysAnalyzed,
      daysFullyAboveCutout: result.daysFullyAboveCutout,
      daysFullyBelowCutout: result.daysFullyBelowCutout,
      daysPartiallyCrossingCutout: result.daysPartiallyCrossingCutout,
      activeHeatPumpDays: result.activeHeatPumpDays,
    },
    analysis: {
      operationBands,
      weatherDistribution,
      copRangeSummary,
      interpolationRanges,
    },
    dailyOperations: result.dailyOperations.map((day) => ({
      date: day.date,
      meanTempF: day.meanTempF,
      minTempF: day.minTempF,
      maxTempF: day.maxTempF,
      heatingWeight: day.heatingWeight,
      dailyRequiredHeatKwh: day.dailyRequiredHeatKwh,
      cop: day.cop,
      fractionAboveCutout: day.fractionAboveCutout,
      fractionBelowCutout: day.fractionBelowCutout,
      heatPumpHeatKwh: day.heatPumpHeatKwh,
      backupHeatKwh: day.backupHeatKwh,
      heatPumpKwh: day.heatPumpKwh,
      backupLitres: day.backupLitres,
      backupCost: day.backupCost,
      operationMode: day.operationMode,
      context: getDailyOperationContext(day),
    })),
  }
}

function App() {
  const { signOut } = useAuth()
  const [sharedReportId] = useState(() => getSharedReportIdFromPath(window.location.pathname))
  const [propaneLitres, setPropaneLitres] = useState(defaultCustomerInputs.propaneLitres)
  const [propaneCost, setPropaneCost] = useState(defaultCustomerInputs.propaneCost)
  const [startDate, setStartDate] = useState(defaultCustomerInputs.startDate)
  const [endDate, setEndDate] = useState(defaultCustomerInputs.endDate)
  const [electricityRate, setElectricityRate] = useState(defaultCustomerInputs.electricityRate)
  const [modelName, setModelName] = useState(defaultNeepInputs.modelName)
  const [capacityBalancePointF, setCapacityBalancePointF] = useState(defaultNeepInputs.capacityBalancePointF)
  const [strategy, setStrategy] = useState<BalanceStrategy>(defaultNeepInputs.strategy)
  const [customOffsetF, setCustomOffsetF] = useState(defaultNeepInputs.customOffsetF)
  const [performanceRows, setPerformanceRows] = useState(defaultPerformanceRows)
  const [reportAttempted, setReportAttempted] = useState(false)
  const [analysisTemperatureUnit, setAnalysisTemperatureUnit] = useState<TemperatureUnit>('c')
  const [pdfDownloadState, setPdfDownloadState] = useState<PdfDownloadState>({ status: 'idle', error: null })
  const [shareDialogState, setShareDialogState] = useState<ShareDialogState>(defaultShareDialogState)
  const [sharedLoadState, setSharedLoadState] = useState<SharedLoadState>({
    status: sharedReportId ? 'loading' : 'idle',
    record: null,
    error: null,
  })
  const [weatherState, setWeatherState] = useState<WeatherState>({
    status: 'idle',
    data: [],
    error: null,
  })
  const isSharedView = Boolean(sharedReportId)

  useEffect(() => {
    if (!sharedReportId) {
      return
    }

    let ignore = false
    const reportId = sharedReportId

    async function loadReport() {
      setSharedLoadState({ status: 'loading', record: null, error: null })

      try {
        const record = await loadSharedReport(reportId)

        if (ignore) {
          return
        }

        const formState = record.form_state
        setPropaneLitres(formState.propaneLitres)
        setPropaneCost(formState.propaneCost)
        setStartDate(formState.startDate)
        setEndDate(formState.endDate)
        setElectricityRate(formState.electricityRate)
        setModelName(formState.modelName)
        setCapacityBalancePointF(formState.capacityBalancePointF)
        setStrategy(formState.strategy)
        setCustomOffsetF(formState.customOffsetF)
        setPerformanceRows(sortRowsByOutdoorTemp(formState.performanceRows))
        setAnalysisTemperatureUnit(formState.analysisTemperatureUnit)
        setWeatherState({ status: 'success', data: formState.weather, error: null })
        setReportAttempted(true)
        setSharedLoadState({ status: 'success', record, error: null })
      } catch (error) {
        if (!ignore) {
          setSharedLoadState({
            status: 'error',
            record: null,
            error: error instanceof Error ? error.message : 'Shared report could not be loaded.',
          })
        }
      }
    }

    void loadReport()

    return () => {
      ignore = true
    }
  }, [sharedReportId])

  const dateRangeError = isValidDateRange(startDate, endDate) ? null : 'Choose a valid start and end date.'

  const customerInputs = useMemo(
    () => ({
      propaneLitres: parseNumberInput(propaneLitres),
      propaneCost: parseNumberInput(propaneCost),
      electricityRate: parseNumberInput(electricityRate),
    }),
    [electricityRate, propaneCost, propaneLitres],
  )

  const neepInputs = useMemo(
    () => ({
      capacityBalancePointF: parseNumberInput(capacityBalancePointF),
      customOffsetF: parseNumberInput(customOffsetF),
    }),
    [capacityBalancePointF, customOffsetF],
  )

  const performancePoints = useMemo<HeatingPerformancePoint[]>(
    () =>
      performanceRows.map((row) => {
        const capacityBtuH = parseNumberInput(row.capacityBtuH)

        return {
          id: row.id,
          outdoorTempF: parseNumberInput(row.outdoorTempF),
          cop: parseNumberInput(row.cop),
          capacityBtuH: Number.isFinite(capacityBtuH) && capacityBtuH > 0 ? capacityBtuH : null,
        }
      }),
    [performanceRows],
  )

  const validPerformancePoints = useMemo(
    () => filterValidPerformancePoints(performancePoints),
    [performancePoints],
  )

  const strategyOffsetF = useMemo(
    () => getStrategyOffset(strategy, neepInputs.customOffsetF),
    [neepInputs.customOffsetF, strategy],
  )

  const inputValidationError = useMemo(() => {
    if (dateRangeError) {
      return dateRangeError
    }

    if (
      !Number.isFinite(customerInputs.propaneLitres) ||
      !Number.isFinite(customerInputs.propaneCost) ||
      customerInputs.propaneLitres <= 0 ||
      customerInputs.propaneCost <= 0
    ) {
      return 'Enter positive propane usage and cost.'
    }

    if (customerInputs.electricityRate < 0 || !Number.isFinite(customerInputs.electricityRate)) {
      return 'Enter a valid non-negative electricity rate.'
    }

    if (!Number.isFinite(neepInputs.capacityBalancePointF) || !Number.isFinite(strategyOffsetF)) {
      return 'Enter a valid NEEP capacity balance point.'
    }

    if (validPerformancePoints.length === 0) {
      return 'Enter at least one valid NEEP COP point.'
    }

    return null
  }, [
    customerInputs.electricityRate,
    customerInputs.propaneCost,
    customerInputs.propaneLitres,
    dateRangeError,
    neepInputs.capacityBalancePointF,
    strategyOffsetF,
    validPerformancePoints.length,
  ])

  const calculationView = useMemo<CalculationView>(() => {
    if (!reportAttempted) {
      return { result: null, error: null }
    }

    if (inputValidationError) {
      return { result: null, error: inputValidationError }
    }

    if (weatherState.status !== 'success') {
      return { result: null, error: null }
    }

    try {
      return {
        result: calculateWeatherAwareSavings({
          ...customerInputs,
          capacityBalancePointF: neepInputs.capacityBalancePointF,
          strategyOffsetF,
          performancePoints: validPerformancePoints,
          weather: weatherState.data,
        }),
        error: null,
      }
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : 'The estimate could not be calculated.',
      }
    }
  }, [
    customerInputs,
    inputValidationError,
    neepInputs.capacityBalancePointF,
    reportAttempted,
    strategyOffsetF,
    validPerformancePoints,
    weatherState,
  ])

  const result = calculationView.result
  const savingsIsPositive = result ? result.estimatedSavings >= 0 : true
  const maxCost = result ? Math.max(customerInputs.propaneCost, result.totalHybridCost) : 1
  const propaneBarWidth = `${Math.max((customerInputs.propaneCost / maxCost) * 100, 4)}%`
  const hybridBarWidth = result ? `${Math.max((result.totalHybridCost / maxCost) * 100, 4)}%` : '4%'
  const sortedPerformanceRows = sortRowsByOutdoorTemp(performanceRows)

  const clearReport = () => {
    if (isSharedView) {
      return
    }

    setReportAttempted(false)
    setPdfDownloadState({ status: 'idle', error: null })
    setWeatherState({ status: 'idle', data: [], error: null })
  }

  const handleNumberChange =
    (setter: Dispatch<SetStateAction<string>>, allowNegative = false) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      setter(sanitizeNumberInput(event.target.value, allowNegative))
      clearReport()
    }

  const updateStartDate = (value: string) => {
    setStartDate(value)
    clearReport()
  }

  const updateEndDate = (value: string) => {
    setEndDate(value)
    clearReport()
  }

  const runReport = async () => {
    setReportAttempted(true)
    setPdfDownloadState({ status: 'idle', error: null })

    if (inputValidationError) {
      setWeatherState({ status: 'idle', data: [], error: null })
      return
    }

    setWeatherState({ status: 'loading', data: [], error: null })

    try {
      const weather = await fetchOttawaHistoricalWeather(startDate, endDate)
      setWeatherState({ status: 'success', data: weather, error: null })
    } catch (error) {
      setWeatherState({
        status: 'error',
        data: [],
        error: error instanceof Error ? error.message : 'Weather data could not be loaded.',
      })
    }
  }

  const downloadReportPdf = async () => {
    if (!result || pdfDownloadState.status === 'loading') {
      return
    }

    setPdfDownloadState({ status: 'loading', error: null })

    try {
      const response = await fetch(appConfig.reportPdfFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: appConfig.supabaseAnonKey,
          Authorization: `Bearer ${appConfig.supabaseAnonKey}`,
        },
        body: JSON.stringify({
          filename: reportPdfFilename,
          report: buildReportPdfPayload({
            result,
            weather: weatherState.data,
            performancePoints: validPerformancePoints,
            modelName,
            startDate,
            endDate,
            propaneLitres: customerInputs.propaneLitres,
            propaneCost: customerInputs.propaneCost,
            electricityRate: customerInputs.electricityRate,
            capacityBalancePointF: neepInputs.capacityBalancePointF,
            strategy,
            strategyOffsetF,
            temperatureUnit: analysisTemperatureUnit,
          }),
        }),
      })

      if (!response.ok) {
        let message = 'PDF generation failed.'

        try {
          const errorBody = (await response.json()) as { error?: string }
          if (errorBody.error) {
            message = errorBody.error
          }
        } catch {
          message = `PDF generation failed with status ${response.status}.`
        }

        throw new Error(message)
      }

      const pdfBlob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(pdfBlob)
      const downloadLink = document.createElement('a')
      downloadLink.href = downloadUrl
      downloadLink.download = reportPdfFilename
      document.body.append(downloadLink)
      downloadLink.click()
      downloadLink.remove()
      window.URL.revokeObjectURL(downloadUrl)

      setPdfDownloadState({ status: 'idle', error: null })
    } catch (error) {
      setPdfDownloadState({
        status: 'error',
        error: error instanceof Error ? error.message : 'PDF generation failed.',
      })
    }
  }

  const openShareDialog = () => {
    setShareDialogState((state) => ({
      ...state,
      isOpen: true,
      status: state.status === 'success' ? state.status : 'idle',
      error: null,
    }))
  }

  const closeShareDialog = () => {
    if (shareDialogState.status === 'loading') {
      return
    }

    setShareDialogState((state) => ({ ...state, isOpen: false }))
  }

  const updateShareField =
    (field: 'name' | 'address' | 'email') =>
    (event: ChangeEvent<HTMLInputElement>) => {
      setShareDialogState((state) => ({
        ...state,
        [field]: event.target.value,
        status: state.status === 'success' ? 'idle' : state.status,
        shareUrl: state.status === 'success' ? null : state.shareUrl,
        error: null,
      }))
    }

  const submitShare = async () => {
    if (!result || weatherState.status !== 'success' || shareDialogState.status === 'loading') {
      return
    }

    const customerName = shareDialogState.name.trim()
    const customerAddress = shareDialogState.address.trim()
    const customerEmail = shareDialogState.email.trim()

    if (!customerName || !customerAddress || !customerEmail) {
      setShareDialogState((state) => ({
        ...state,
        status: 'error',
        error: 'Enter a name, address, and email before sharing.',
      }))
      return
    }

    setShareDialogState((state) => ({ ...state, status: 'loading', error: null, shareUrl: null }))

    try {
      const reportData = buildReportPdfPayload({
        result,
        weather: weatherState.data,
        performancePoints: validPerformancePoints,
        modelName,
        startDate,
        endDate,
        propaneLitres: customerInputs.propaneLitres,
        propaneCost: customerInputs.propaneCost,
        electricityRate: customerInputs.electricityRate,
        capacityBalancePointF: neepInputs.capacityBalancePointF,
        strategy,
        strategyOffsetF,
        temperatureUnit: analysisTemperatureUnit,
      })
      const formState = buildSharedFormState({
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
        weather: weatherState.data,
        analysisTemperatureUnit,
      })
      const { shareUrl } = await createSharedReport({
        customerName,
        customerAddress,
        customerEmail,
        formState,
        reportData,
      })

      setShareDialogState((state) => ({
        ...state,
        status: 'success',
        shareUrl,
        error: null,
      }))
    } catch (error) {
      setShareDialogState((state) => ({
        ...state,
        status: 'error',
        error: error instanceof Error ? error.message : 'The report could not be shared.',
      }))
    }
  }

  const preloadForm = () => {
    setPropaneLitres(preloadCustomerInputs.propaneLitres)
    setPropaneCost(preloadCustomerInputs.propaneCost)
    setStartDate(preloadCustomerInputs.startDate)
    setEndDate(preloadCustomerInputs.endDate)
    setElectricityRate(preloadCustomerInputs.electricityRate)
    setModelName(preloadNeepInputs.modelName)
    setCapacityBalancePointF(preloadNeepInputs.capacityBalancePointF)
    setStrategy(preloadNeepInputs.strategy)
    setCustomOffsetF(preloadNeepInputs.customOffsetF)
    setPerformanceRows(sortRowsByOutdoorTemp(preloadPerformanceRows))
    clearReport()
  }

  const updatePerformanceRow = (id: string, field: keyof Omit<PerformanceRowInput, 'id'>, value: string) => {
    const allowNegative = field === 'outdoorTempF'
    setPerformanceRows((rows) =>
      sortRowsByOutdoorTemp(
        rows.map((row) => (row.id === id ? { ...row, [field]: sanitizeNumberInput(value, allowNegative) } : row)),
      ),
    )
    clearReport()
  }

  const removePerformanceRow = (id: string) => {
    setPerformanceRows((rows) => sortRowsByOutdoorTemp(rows.filter((row) => row.id !== id)))
    clearReport()
  }

  if (isSharedView && sharedLoadState.status !== 'success') {
    return (
      <main className="min-h-screen bg-neutral-50 text-neutral-950">
        <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-10 sm:px-6">
          <section className="w-full rounded-lg bg-white p-6 shadow-sm ring-1 ring-neutral-200">
            <p className="text-sm font-semibold uppercase text-teal-700">Comfort Hub shared report</p>
            <h1 className="mt-2 text-3xl font-semibold">
              {sharedLoadState.status === 'error' ? 'Shared report unavailable' : 'Loading shared report'}
            </h1>
            <p className="mt-3 text-sm leading-6 text-neutral-600">
              {sharedLoadState.status === 'error'
                ? sharedLoadState.error
                : 'Loading the saved customer report.'}
            </p>
          </section>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <p className="mb-3 text-sm font-semibold uppercase text-teal-700">Comfort Hub hybrid heating estimator</p>
            <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
              Weather-aware propane to heat pump savings.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-neutral-600">
              Use real propane spend, Ottawa historical weather, and the key NEEP heating points to estimate hybrid
              operating cost.
            </p>
          </div>
          {!isSharedView && (
            <button
              className="shrink-0 self-start rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-teal-100"
              type="button"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          )}
        </header>

        <section className="grid gap-5 lg:grid-cols-2">
          <CustomerInputs
            propaneLitres={propaneLitres}
            propaneCost={propaneCost}
            startDate={startDate}
            endDate={endDate}
            electricityRate={electricityRate}
            isReadOnly={isSharedView}
            isSharedView={isSharedView}
            hasReportResult={Boolean(result)}
            pdfDownloadState={pdfDownloadState}
            onDownloadPdf={downloadReportPdf}
            onShare={openShareDialog}
            isRunning={weatherState.status === 'loading'}
            onPropaneLitresChange={handleNumberChange(setPropaneLitres)}
            onPropaneCostChange={handleNumberChange(setPropaneCost)}
            onStartDateChange={(event) => updateStartDate(event.target.value)}
            onEndDateChange={(event) => updateEndDate(event.target.value)}
            onElectricityRateChange={handleNumberChange(setElectricityRate)}
            onPreload={preloadForm}
            onRunReport={runReport}
          />

          <NeepInputs
            modelName={modelName}
            capacityBalancePointF={capacityBalancePointF}
            strategy={strategy}
            customOffsetF={customOffsetF}
            performanceRows={sortedPerformanceRows}
            isReadOnly={isSharedView}
            onModelNameChange={(event) => {
              setModelName(event.target.value)
              clearReport()
            }}
            onCapacityBalancePointChange={handleNumberChange(setCapacityBalancePointF, true)}
            onStrategyChange={(event) => {
              setStrategy(event.target.value as BalanceStrategy)
              clearReport()
            }}
            onCustomOffsetChange={handleNumberChange(setCustomOffsetF, true)}
            onPerformanceRowChange={updatePerformanceRow}
            onRemovePerformanceRow={removePerformanceRow}
          />
        </section>

        {reportAttempted && !result && (
          <ResultsSection
            result={result}
            modelName={modelName}
            propaneCost={customerInputs.propaneCost}
            weatherState={weatherState}
            calculationError={calculationView.error}
            savingsIsPositive={savingsIsPositive}
            propaneBarWidth={propaneBarWidth}
            hybridBarWidth={hybridBarWidth}
          />
        )}

        {result && (
          <div id="savings-report" className="grid gap-8">
            <ResultsSection
              result={result}
              modelName={modelName}
              propaneCost={customerInputs.propaneCost}
              weatherState={weatherState}
              calculationError={calculationView.error}
              savingsIsPositive={savingsIsPositive}
              propaneBarWidth={propaneBarWidth}
              hybridBarWidth={hybridBarWidth}
            />

            <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
              <ReasoningSection />
              <CalculationBreakdown result={result} temperatureUnit={analysisTemperatureUnit} />
            </section>

            <AdvancedWeatherAnalysis
              result={result}
              weatherState={weatherState}
              performancePoints={validPerformancePoints}
              temperatureUnit={analysisTemperatureUnit}
              onTemperatureUnitChange={setAnalysisTemperatureUnit}
            />
          </div>
        )}

        {shareDialogState.isOpen && (
          <ShareDialog
            state={shareDialogState}
            onNameChange={updateShareField('name')}
            onAddressChange={updateShareField('address')}
            onEmailChange={updateShareField('email')}
            onClose={closeShareDialog}
            onShare={submitShare}
          />
        )}
      </div>
    </main>
  )
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.59 13.51 6.83 3.98" />
      <path d="m15.41 6.51-6.82 3.98" />
    </svg>
  )
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  )
}

function ShareDialog({
  state,
  onNameChange,
  onAddressChange,
  onEmailChange,
  onClose,
  onShare,
}: {
  state: ShareDialogState
  onNameChange: (event: ChangeEvent<HTMLInputElement>) => void
  onAddressChange: (event: ChangeEvent<HTMLInputElement>) => void
  onEmailChange: (event: ChangeEvent<HTMLInputElement>) => void
  onClose: () => void
  onShare: () => void
}) {
  const [copyFeedback, setCopyFeedback] = useState(false)

  const copyShareUrl = async () => {
    if (state.shareUrl) {
      await navigator.clipboard.writeText(state.shareUrl)
      setCopyFeedback(true)
      window.setTimeout(() => setCopyFeedback(false), 2000)
    }
  }

  const shareComplete = state.status === 'success' && Boolean(state.shareUrl)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <section className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl ring-1 ring-neutral-200 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase text-teal-700">Share report</p>
            <h2 className="mt-1 text-2xl font-semibold">Customer details</h2>
          </div>
          <button
            className="rounded-md px-3 py-2 text-sm font-semibold text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-2">
            <span className="text-sm font-medium text-neutral-700">Name</span>
            <input className={inputClassName} type="text" value={state.name} onChange={onNameChange} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-neutral-700">Address</span>
            <input className={inputClassName} type="text" value={state.address} onChange={onAddressChange} />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-neutral-700">Email</span>
            <input className={inputClassName} type="email" value={state.email} onChange={onEmailChange} />
          </label>
        </div>

        {state.status === 'error' && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">{state.error}</p>
        )}

        {state.status === 'success' && state.shareUrl && (
          <div className="mt-4 rounded-lg bg-teal-50 p-3 text-sm text-teal-900">
            <p className="font-semibold">Share URL</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input className={`${inputClassName} bg-white`} readOnly value={state.shareUrl} />
              <button
                className={`inline-flex h-11 min-w-[5.5rem] items-center justify-center rounded-lg px-4 text-sm font-semibold text-white transition ${
                  copyFeedback ? 'bg-teal-900' : 'bg-teal-700 hover:bg-teal-800'
                }`}
                type="button"
                onClick={copyShareUrl}
              >
                {copyFeedback ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {!shareComplete && (
          <div className="mt-6 flex flex-col gap-3 border-t border-neutral-200 pt-5 sm:flex-row sm:justify-end">
            <button
              className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-neutral-300 bg-white px-5 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50 sm:w-auto"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-teal-700 px-5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-wait disabled:opacity-70 sm:w-auto"
              type="button"
              disabled={state.status === 'loading'}
              onClick={onShare}
            >
              {state.status === 'loading' ? 'Sharing...' : 'Share'}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

type CustomerInputsProps = {
  propaneLitres: string
  propaneCost: string
  startDate: string
  endDate: string
  electricityRate: string
  isReadOnly: boolean
  isSharedView: boolean
  hasReportResult: boolean
  pdfDownloadState: PdfDownloadState
  onDownloadPdf: () => void
  onShare: () => void
  isRunning: boolean
  onPropaneLitresChange: (event: ChangeEvent<HTMLInputElement>) => void
  onPropaneCostChange: (event: ChangeEvent<HTMLInputElement>) => void
  onStartDateChange: (event: ChangeEvent<HTMLInputElement>) => void
  onEndDateChange: (event: ChangeEvent<HTMLInputElement>) => void
  onElectricityRateChange: (event: ChangeEvent<HTMLInputElement>) => void
  onPreload: () => void
  onRunReport: () => void
}

function CustomerInputs({
  propaneLitres,
  propaneCost,
  startDate,
  endDate,
  electricityRate,
  isReadOnly,
  isSharedView,
  hasReportResult,
  pdfDownloadState,
  onDownloadPdf,
  onShare,
  isRunning,
  onPropaneLitresChange,
  onPropaneCostChange,
  onStartDateChange,
  onEndDateChange,
  onElectricityRateChange,
  onPreload,
  onRunReport,
}: CustomerInputsProps) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-neutral-200 sm:p-6">
      <SectionHeader
        eyebrow="Customer / job inputs"
        title="Propane usage period"
        body="Treat the entered propane as space-heating fuel for the selected analysis dates."
      />

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Total propane litres"
          value={propaneLitres}
          readOnly={isReadOnly}
          onChange={onPropaneLitresChange}
        />
        <MoneyField label="Total propane cost" value={propaneCost} readOnly={isReadOnly} onChange={onPropaneCostChange} />
        <DateField label="Analysis start date" value={startDate} readOnly={isReadOnly} onChange={onStartDateChange} />
        <DateField label="Analysis end date" value={endDate} readOnly={isReadOnly} onChange={onEndDateChange} />
        <MoneyField
          label="Electricity rate"
          value={electricityRate}
          suffix="/kWh"
          step="0.001"
          readOnly={isReadOnly}
          onChange={onElectricityRateChange}
        />
      </div>

      {!isReadOnly && (
        <div className="mt-6 border-t border-neutral-200 pt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-neutral-300 bg-white px-5 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-teal-100 sm:w-auto"
              type="button"
              onClick={onPreload}
            >
              Preload
            </button>
            <button
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-teal-700 px-5 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-200 disabled:cursor-wait disabled:opacity-70 sm:w-auto"
              type="button"
              disabled={isRunning}
              onClick={onRunReport}
            >
              {isRunning ? 'Running report...' : 'Run report'}
            </button>
            {hasReportResult && (
              <>
                <button
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-800 transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:cursor-wait disabled:opacity-70"
                  type="button"
                  disabled={pdfDownloadState.status === 'loading'}
                  aria-busy={pdfDownloadState.status === 'loading'}
                  aria-label={pdfDownloadState.status === 'loading' ? 'Generating PDF' : 'Download PDF'}
                  title={pdfDownloadState.status === 'loading' ? 'Generating PDF…' : 'Download PDF'}
                  onClick={onDownloadPdf}
                >
                  <DownloadIcon />
                </button>
                <button
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-800 transition hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-teal-100"
                  type="button"
                  onClick={onShare}
                  aria-label="Share report"
                  title="Share report"
                >
                  <ShareIcon />
                </button>
              </>
            )}
          </div>
          {pdfDownloadState.status === 'error' && (
            <p className="mt-3 text-sm font-medium text-red-700">{pdfDownloadState.error}</p>
          )}
        </div>
      )}

      {isSharedView && hasReportResult && (
        <div className="mt-6 border-t border-neutral-200 pt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-teal-700 px-5 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-200 disabled:cursor-wait disabled:opacity-70 sm:w-auto"
              type="button"
              disabled={pdfDownloadState.status === 'loading'}
              aria-busy={pdfDownloadState.status === 'loading'}
              onClick={onDownloadPdf}
            >
              {pdfDownloadState.status === 'loading' ? 'Generating PDF...' : 'Download PDF'}
            </button>
          </div>
          {pdfDownloadState.status === 'error' && (
            <p className="mt-3 text-sm font-medium text-red-700">{pdfDownloadState.error}</p>
          )}
        </div>
      )}
    </section>
  )
}

type NeepInputsProps = {
  modelName: string
  capacityBalancePointF: string
  strategy: BalanceStrategy
  customOffsetF: string
  performanceRows: PerformanceRowInput[]
  isReadOnly: boolean
  onModelNameChange: (event: ChangeEvent<HTMLInputElement>) => void
  onCapacityBalancePointChange: (event: ChangeEvent<HTMLInputElement>) => void
  onStrategyChange: (event: ChangeEvent<HTMLSelectElement>) => void
  onCustomOffsetChange: (event: ChangeEvent<HTMLInputElement>) => void
  onPerformanceRowChange: (id: string, field: keyof Omit<PerformanceRowInput, 'id'>, value: string) => void
  onRemovePerformanceRow: (id: string) => void
}

function NeepInputs({
  modelName,
  capacityBalancePointF,
  strategy,
  customOffsetF,
  performanceRows,
  isReadOnly,
  onModelNameChange,
  onCapacityBalancePointChange,
  onStrategyChange,
  onCustomOffsetChange,
  onPerformanceRowChange,
  onRemovePerformanceRow,
}: NeepInputsProps) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-neutral-200 sm:p-6">
      <SectionHeader
        eyebrow="NEEP heat pump inputs"
        title="Heating performance"
        body="Enter the NEEP heating points that matter for this estimate: balance point, COP, and capacity."
      />

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 sm:col-span-2">
          <span className="text-sm font-medium text-neutral-700">Heat pump model name</span>
          <input
            className={inputClassName}
            type="text"
            value={modelName}
            readOnly={isReadOnly}
            onChange={onModelNameChange}
          />
        </label>

        <NumberField
          label={(() => {
            const parsed = Number(capacityBalancePointF)
            if (!Number.isFinite(parsed)) return 'Capacity balance point'
            const celsius = ((parsed - 32) * 5) / 9
            return `Capacity balance point (${celsius.toFixed(1)}°C)`
          })()}
          value={capacityBalancePointF}
          suffix="°F"
          allowNegative
          readOnly={isReadOnly}
          onChange={onCapacityBalancePointChange}
        />

        <label className="grid gap-2">
          <span className="text-sm font-medium text-neutral-700">Balance point strategy</span>
          <select className={inputClassName} value={strategy} disabled={isReadOnly} onChange={onStrategyChange}>
            <option value="strict">Strict: balance point + 5°F</option>
            <option value="standard">Standard: balance point</option>
            <option value="loose">Loose: balance point - 5°F</option>
            <option value="custom">Custom offset</option>
          </select>
        </label>

        {strategy === 'custom' && (
          <NumberField
            label="Custom offset"
            value={customOffsetF}
            suffix="°F"
            allowNegative
            readOnly={isReadOnly}
            onChange={onCustomOffsetChange}
          />
        )}
      </div>

      <div className="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px] border-separate border-spacing-y-2 text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-2 font-semibold">Outdoor temp</th>
                <th className="px-2 font-semibold">COP</th>
                <th className="px-2 font-semibold">Heating capacity</th>
                <th className="px-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {performanceRows.map((row) => (
                <tr key={row.id}>
                  <td className="px-2">
                    <NumberTableInput
                      ariaLabel="Outdoor temp Fahrenheit"
                      value={row.outdoorTempF}
                      suffix="°F"
                      allowNegative
                      readOnly={isReadOnly}
                      onChange={(event) =>
                        onPerformanceRowChange(row.id, 'outdoorTempF', event.target.value)
                      }
                    />
                  </td>
                  <td className="px-2">
                    <NumberTableInput
                      ariaLabel="COP"
                      value={row.cop}
                      readOnly={isReadOnly}
                      onChange={(event) => onPerformanceRowChange(row.id, 'cop', event.target.value)}
                    />
                  </td>
                  <td className="px-2">
                    <NumberTableInput
                      ariaLabel="Heating capacity Btu per hour"
                      value={row.capacityBtuH}
                      suffix="Btu/h"
                      readOnly={isReadOnly}
                      onChange={(event) =>
                        onPerformanceRowChange(row.id, 'capacityBtuH', event.target.value)
                      }
                    />
                  </td>
                  <td className="px-2 text-right">
                    {!isReadOnly && (
                      <button
                        className="rounded-md px-2 py-2 text-sm font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
                        type="button"
                        disabled={performanceRows.length <= 1}
                        onClick={() => onRemovePerformanceRow(row.id)}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

type ResultsSectionProps = {
  result: WeatherAwareCalculationResult | null
  modelName: string
  propaneCost: number
  weatherState: WeatherState
  calculationError: string | null
  savingsIsPositive: boolean
  propaneBarWidth: string
  hybridBarWidth: string
}

function ResultsSection({
  result,
  modelName,
  propaneCost,
  weatherState,
  calculationError,
  savingsIsPositive,
  propaneBarWidth,
  hybridBarWidth,
}: ResultsSectionProps) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-neutral-200 sm:p-6">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Weather-aware hybrid estimate</h2>
        </div>
        <p className="rounded-md bg-teal-50 px-3 py-2 text-sm font-medium text-teal-800">
          Using Ottawa historical weather
        </p>
      </div>

      {weatherState.status === 'loading' && (
        <StatusMessage tone="neutral" message="Loading Ottawa historical weather for this date range..." />
      )}

      {weatherState.status === 'error' && <StatusMessage tone="error" message={weatherState.error} />}

      {!result && weatherState.status !== 'loading' && weatherState.status !== 'error' && calculationError && (
        <StatusMessage tone="error" message={calculationError} />
      )}

      {result && (
        <div className="grid gap-6">
          <div>
            <p className="text-sm font-medium text-neutral-500">Estimated annual savings</p>
            <p
              className={`mt-2 text-5xl font-semibold leading-none sm:text-6xl ${
                savingsIsPositive ? 'text-teal-700' : 'text-red-700'
              }`}
            >
              {formatCurrency(result.estimatedSavings)}
            </p>
            <p className="mt-3 text-sm leading-6 text-neutral-600">
              Compared with the entered propane spend for {modelName || 'the selected heat pump'}.
            </p>
          </div>

          <div className="grid gap-4 border-t border-neutral-200 pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <ResultMetric label="Estimated hybrid heating cost" value={formatCurrency(result.totalHybridCost)} />
            <ResultMetric label="Current propane cost" value={formatCurrency(propaneCost)} />
            <ResultMetric
              label="Heat pump electricity cost"
              value={formatCurrency(result.totalHeatPumpCost)}
            />
            <ResultMetric label="Backup propane cost" value={formatCurrency(result.totalBackupCost)} />
          </div>

          <div className="grid gap-4">
            <CostBar label="Current propane" value={formatCurrency(propaneCost)} width={propaneBarWidth} dark />
            <CostBar label="Estimated hybrid" value={formatCurrency(result.totalHybridCost)} width={hybridBarWidth} />
          </div>
        </div>
      )}
    </section>
  )
}

function ReasoningSection() {
  return (
    <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-neutral-200 sm:p-6">
      <h2 className="text-xl font-semibold">How the estimate works</h2>
      <div className="mt-4 grid gap-3 text-sm leading-6 text-neutral-700">
        <p>
          First, the propane litres are converted into the amount of useful heat that reached the
          home, using the fixed 95% furnace efficiency.
        </p>
        <p>
          Next, Ottawa historical weather is used to spread that heat across the selected dates.
          Colder days get more of the heating load and milder days get less.
        </p>
        <p>
          For each day, the tool evaluates heat pump efficiency at three temperature points across the
          daily range — minimum, mean, and maximum — weighted by heating intensity at each point.
        </p>
        <p>
          The balance point and selected strategy set the compressor lockout temperature. Above it,
          the tool compares the heat pump&apos;s NEEP capacity against the building&apos;s derived
          heating load to determine how much of the load the heat pump can cover versus how much
          needs propane backup.
        </p>
        <p>
          Finally, heat pump electricity cost and backup propane cost are added together, then
          compared with the original propane bill.
        </p>
      </div>
    </section>
  )
}

function CalculationBreakdown({
  result,
  temperatureUnit,
}: {
  result: WeatherAwareCalculationResult
  temperatureUnit: TemperatureUnit
}) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-neutral-200 sm:p-6">
      <h2 className="text-xl font-semibold">Calculation breakdown</h2>
      <dl className="mt-5 grid gap-x-6 divide-y divide-neutral-200 text-sm sm:grid-cols-2 sm:divide-y-0">
        <BreakdownItem label="Delivered heat" value={`${formatNumber(result.deliveredHeatKwh)} kWh`} />
        <BreakdownItem
          label="Propane cost per delivered kWh"
          value={`${formatCurrency(result.propaneCostPerDeliveredKwh, 3)}/kWh`}
        />
        <BreakdownItem
          label="Effective cutout temperature"
          value={formatTemperature(result.effectiveCutoutTempF, temperatureUnit)}
        />
        <BreakdownItem label="Total heat pump kWh" value={`${formatNumber(result.totalHeatPumpKwh)} kWh`} />
        <BreakdownItem label="Total backup litres" value={`${formatNumber(result.totalBackupLitres)} L`} />
        <BreakdownItem label="Total heat pump cost" value={formatCurrency(result.totalHeatPumpCost)} />
        <BreakdownItem label="Total backup propane cost" value={formatCurrency(result.totalBackupCost)} />
        <BreakdownItem label="Total hybrid cost" value={formatCurrency(result.totalHybridCost)} />
        <BreakdownItem label="Estimated savings" value={formatCurrency(result.estimatedSavings)} />
        <BreakdownItem label="Break-even COP" value={formatNumber(result.breakEvenCop, 2)} />
      </dl>
    </section>
  )
}

const isWarmSeasonDate = (date: string) => {
  const month = Number(date.slice(5, 7))
  return month >= 6 && month <= 9
}

const getDailyOperationContext = (day: DailyOperation) => {
  if (day.operationMode === 'backup') {
    return 'Backup heat only'
  }

  if (day.operationMode === 'partial') {
    return day.fractionBelowCutout >= 0.5 ? 'Heat pump needs backup' : 'Heat pump may need backup'
  }

  if (day.maxTempF >= 80) {
    return 'Cooling likely'
  }

  if (day.maxTempF >= 75) {
    return 'Cooling optional or system off'
  }

  if (day.meanTempF >= 60 && day.meanTempF <= 72 && isWarmSeasonDate(day.date)) {
    return day.meanTempF >= 65 ? 'System off' : 'Heat pump optional or system off'
  }

  if (day.meanTempF >= 65) {
    return 'System off'
  }

  if (day.meanTempF >= 60) {
    return 'Heat pump optional or system off'
  }

  return 'Heat pump only'
}

const toCelsius = (fahrenheit: number) => ((fahrenheit - 32) * 5) / 9

const formatTemperature = (valueF: number | null, unit: TemperatureUnit, fractionDigits = 1) => {
  if (valueF === null || !Number.isFinite(valueF)) {
    return '—'
  }

  const value = unit === 'c' ? toCelsius(valueF) : valueF
  return `${formatNumber(value, fractionDigits)}°${unit.toUpperCase()}`
}

const formatTemperatureDelta = (deltaF: number, unit: TemperatureUnit, fractionDigits = 1) => {
  const value = unit === 'c' ? (deltaF * 5) / 9 : deltaF
  return `${formatNumber(value, fractionDigits)}°${unit.toUpperCase()}`
}

const getOperationBandLabel = (id: string, unit: TemperatureUnit) => {
  switch (id) {
    case 'near':
      return `Near cutout: ${formatTemperatureDelta(0, unit)} to ${formatTemperatureDelta(5, unit)} above`
    case 'moderate':
      return `Moderate heat pump zone: ${formatTemperatureDelta(5, unit)} to ${formatTemperatureDelta(
        15,
        unit,
      )} above`
    case 'mild':
      return `Warm / low-heating zone: ${formatTemperatureDelta(15, unit)}+ above`
    default:
      return null
  }
}

const getCopRangeLabel = (
  range: {
    type: 'clamp-cold' | 'clamp-warm' | 'interpolate' | 'single-point' | 'none'
    lowerTempF: number | null
    upperTempF: number | null
  },
  unit: TemperatureUnit,
) => {
  if (range.type === 'none') {
    return 'No valid COP points'
  }

  if (range.type === 'single-point') {
    return `Single point at ${formatTemperature(range.lowerTempF, unit)}`
  }

  if (range.type === 'clamp-cold') {
    return `Clamped at ${formatTemperature(range.lowerTempF, unit)}`
  }

  if (range.type === 'clamp-warm') {
    return `Clamped at ${formatTemperature(range.lowerTempF, unit)}`
  }

  return `${formatTemperature(range.lowerTempF, unit)} to ${formatTemperature(range.upperTempF, unit)}`
}

function AdvancedWeatherAnalysis({
  result,
  weatherState,
  performancePoints,
  temperatureUnit,
  onTemperatureUnitChange,
}: {
  result: WeatherAwareCalculationResult
  weatherState: WeatherState
  performancePoints: HeatingPerformancePoint[]
  temperatureUnit: TemperatureUnit
  onTemperatureUnitChange: (unit: TemperatureUnit) => void
}) {
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(true)
  const [isDailyDetailOpen, setIsDailyDetailOpen] = useState(true)
  const firstDate = weatherState.data[0]?.date
  const lastDate = weatherState.data[weatherState.data.length - 1]?.date
  const operationBands = useMemo(
    () => summarizeOperationBands(result.dailyOperations, result.effectiveCutoutTempF),
    [result.dailyOperations, result.effectiveCutoutTempF],
  )
  const weatherDistribution = useMemo(
    () => summarizeWeatherDistribution(result.dailyOperations, result.effectiveCutoutTempF),
    [result.dailyOperations, result.effectiveCutoutTempF],
  )
  const copRangeSummary = useMemo(
    () => summarizeCopInterpolationRanges(result.dailyOperations, performancePoints),
    [performancePoints, result.dailyOperations],
  )
  const weightedAverageCop = useMemo(
    () => getWeightedAverageCopForHeatPumpLoad(result.dailyOperations),
    [result.dailyOperations],
  )
  const heatPumpShare = result.deliveredHeatKwh > 0 ? result.totalHeatPumpHeatKwh / result.deliveredHeatKwh : 0
  const interpolationRanges = performancePoints.slice(1).map((point, index) => ({
    from: performancePoints[index],
    to: point,
  }))

  return (
    <details
      className="rounded-lg bg-white shadow-sm ring-1 ring-neutral-200"
      open={isAnalysisOpen}
      onToggle={(event) => setIsAnalysisOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none p-5 marker:hidden sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase text-teal-700">Advanced analysis</p>
            <h2 className="mt-1 text-xl font-semibold">Advanced weather + operation analysis</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
              Detailed view of how Ottawa weather, cutout temperature, and COP interpolation shape
              the estimate.
            </p>
          </div>
          <span className="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-700">
            {isAnalysisOpen ? 'Hide detail' : 'Open detail'}
          </span>
        </div>
      </summary>

      <div className="border-t border-neutral-200 p-5 sm:p-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-neutral-600">
            Ottawa daily mean, minimum, and maximum temperatures
            {firstDate && lastDate ? ` from ${firstDate} to ${lastDate}` : ''}.
          </p>
          <div className="inline-flex rounded-lg bg-neutral-100 p-1">
            <button
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                temperatureUnit === 'f' ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-600'
              }`}
              type="button"
              onClick={() => onTemperatureUnitChange('f')}
            >
              °F
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                temperatureUnit === 'c' ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-600'
              }`}
              type="button"
              onClick={() => onTemperatureUnitChange('c')}
            >
              °C
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CompactMetric label="Days analyzed" value={formatNumber(result.daysAnalyzed)} />
          <CompactMetric
            label="Effective cutout"
            value={formatTemperature(result.effectiveCutoutTempF, temperatureUnit)}
          />
          <CompactMetric label="Fully above cutout" value={formatNumber(result.daysFullyAboveCutout)} />
          <CompactMetric label="Partly crossing cutout" value={formatNumber(result.daysPartiallyCrossingCutout)} />
          <CompactMetric label="Fully below cutout" value={formatNumber(result.daysFullyBelowCutout)} />
          <CompactMetric label="Average active COP" value={formatNumber(result.averageInterpolatedCop, 2)} />
          <CompactMetric label="Heat pump heat share" value={formatPercent(heatPumpShare, 1)} />
          <CompactMetric label="Backup propane share" value={formatPercent(result.backupHeatShare, 1)} />
        </div>

        <div className="mt-8 grid gap-6">
          <section>
            <h3 className="text-lg font-semibold">Temperature zones</h3>
            <p className="mt-1 text-sm leading-6 text-neutral-600">
              Days are grouped by how they sit relative to the effective cutout temperature.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="py-3 pr-4 font-semibold">Band</th>
                    <th className="py-3 pr-4 font-semibold">Days</th>
                    <th className="py-3 pr-4 font-semibold">% of days</th>
                    <th className="py-3 pr-4 font-semibold">Avg mean</th>
                    <th className="py-3 pr-4 font-semibold">Avg min</th>
                    <th className="py-3 pr-4 font-semibold">Avg max</th>
                    <th className="py-3 pr-4 font-semibold">Avg COP</th>
                    <th className="py-3 font-semibold">Interpretation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {operationBands.map((band) => (
                    <tr key={band.id}>
                      <td className="py-3 pr-4 font-medium text-neutral-950">
                        {getOperationBandLabel(band.id, temperatureUnit) ?? band.label}
                      </td>
                      <td className="py-3 pr-4">{formatNumber(band.dayCount)}</td>
                      <td className="py-3 pr-4">{formatPercent(band.dayShare, 1)}</td>
                      <td className="py-3 pr-4">{formatTemperature(band.averageMeanTempF, temperatureUnit)}</td>
                      <td className="py-3 pr-4">{formatTemperature(band.averageMinTempF, temperatureUnit)}</td>
                      <td className="py-3 pr-4">{formatTemperature(band.averageMaxTempF, temperatureUnit)}</td>
                      <td className="py-3 pr-4">
                        {band.averageCop === null ? '—' : formatNumber(band.averageCop, 2)}
                      </td>
                      <td className="py-3 text-neutral-600">{band.interpretation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
            <div className="rounded-lg bg-neutral-50 p-4">
              <h3 className="text-lg font-semibold">COP curve + interpolation</h3>
              <p className="mt-1 text-sm leading-6 text-neutral-600">
                The report uses the entered NEEP points, clamps outside the entered range, and uses
                linear interpolation between points. Warm-weather days are labeled as cooling or
                likely-off conditions so they do not read like heating operation.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {performancePoints.map((point) => (
                  <div key={point.id} className="rounded-lg bg-white p-3 ring-1 ring-neutral-200">
                    <p className="text-sm text-neutral-500">{formatTemperature(point.outdoorTempF, temperatureUnit)}</p>
                    <p className="mt-1 text-xl font-semibold">COP {formatNumber(point.cop, 2)}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3">
                {interpolationRanges.map((range) => (
                  <div
                    key={`${range.from.id}-${range.to.id}`}
                    className="flex flex-col gap-1 rounded-lg bg-white p-3 text-sm ring-1 ring-neutral-200 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="font-medium">
                      {formatTemperature(range.from.outdoorTempF, temperatureUnit)} to{' '}
                      {formatTemperature(range.to.outdoorTempF, temperatureUnit)}
                    </span>
                    <span className="text-neutral-600">
                      COP {formatNumber(range.from.cop, 2)} to {formatNumber(range.to.cop, 2)}
                    </span>
                  </div>
                ))}
              </div>

              <p className="mt-4 text-sm leading-6 text-neutral-600">
                Below the coldest entered point, COP is clamped to the coldest COP. Above the
                warmest entered point, COP is clamped to the warmest COP. Between points, COP moves
                linearly with outdoor temperature.
              </p>
            </div>

            <div className="rounded-lg bg-neutral-50 p-4">
              <h3 className="text-lg font-semibold">Weather distribution</h3>
              <dl className="mt-4 grid gap-x-5 divide-y divide-neutral-200 text-sm sm:grid-cols-2 sm:divide-y-0">
                <BreakdownItem
                  label="Coldest daily minimum"
                  value={formatTemperature(weatherDistribution.coldestDailyMinimumF, temperatureUnit)}
                />
                <BreakdownItem
                  label="Warmest daily maximum"
                  value={formatTemperature(weatherDistribution.warmestDailyMaximumF, temperatureUnit)}
                />
                <BreakdownItem
                  label="Average daily mean"
                  value={formatTemperature(weatherDistribution.averageDailyMeanF, temperatureUnit)}
                />
                <BreakdownItem
                  label={`Mean below ${formatTemperature(5, temperatureUnit)}`}
                  value={formatNumber(weatherDistribution.meanBelow5F)}
                />
                <BreakdownItem
                  label={`Mean below ${formatTemperature(17, temperatureUnit)}`}
                  value={formatNumber(weatherDistribution.meanBelow17F)}
                />
                <BreakdownItem
                  label={`Mean below ${formatTemperature(47, temperatureUnit)}`}
                  value={formatNumber(weatherDistribution.meanBelow47F)}
                />
                <BreakdownItem
                  label={`Mean above ${formatTemperature(47, temperatureUnit)}`}
                  value={formatNumber(weatherDistribution.meanAbove47F)}
                />
                <BreakdownItem
                  label={`Within ±${formatTemperatureDelta(5, temperatureUnit)} of cutout`}
                  value={formatNumber(weatherDistribution.daysNearCutout)}
                />
                <BreakdownItem label="Load-weighted COP" value={formatNumber(weightedAverageCop, 2)} />
              </dl>
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="rounded-lg bg-neutral-50 p-4">
              <h3 className="text-lg font-semibold">How the operation logic is applied</h3>
              <div className="mt-3 grid gap-3 text-sm leading-6 text-neutral-700">
                <p>Warm and shoulder days are labeled as system off, cooling optional, or heat pump optional.</p>
                <p>Heating-season days above the cutout are shown as heat pump only.</p>
                <p>Days fully below cutout are shown as backup heat only.</p>
                <p>Days crossing the cutout are shown as heat pump may need backup or heat pump needs backup.</p>
                <p>COP is estimated from the entered NEEP temperature/COP points.</p>
                <p>Colder days get more heating load because the tool uses heating-degree weighting.</p>
              </div>
            </div>

            <div className="rounded-lg bg-neutral-50 p-4">
              <h3 className="text-lg font-semibold">COP interpolation range counts</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {copRangeSummary.map((range) => (
                  <div key={range.id} className="rounded-lg bg-white p-3 ring-1 ring-neutral-200">
                    <p className="font-medium">{getCopRangeLabel(range, temperatureUnit)}</p>
                    <p className="mt-1 text-sm text-neutral-600">
                      {formatNumber(range.dayCount)} days · {formatNumber(range.heatPumpHeatKwh)} kWh served by heat pump
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <details
            className="rounded-lg bg-neutral-50 p-4"
            open={isDailyDetailOpen}
            onToggle={(event) => setIsDailyDetailOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer text-sm font-semibold text-neutral-800">
              {isDailyDetailOpen ? 'Hide daily weather detail' : 'Show daily weather detail'}
            </summary>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="py-3 pr-4 font-semibold">Date</th>
                    <th className="py-3 pr-4 font-semibold">Mean</th>
                    <th className="py-3 pr-4 font-semibold">Min</th>
                    <th className="py-3 pr-4 font-semibold">Max</th>
                    <th className="py-3 pr-4 font-semibold">Heating / cooling context</th>
                    <th className="py-3 pr-4 text-center font-semibold">COP</th>
                    <th className="py-3 pr-4 text-center font-semibold">Heat pump share</th>
                    <th className="py-3 text-center font-semibold">Backup share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {result.dailyOperations.map((day) => (
                    <tr key={day.date}>
                      <td className="py-3 pr-4 font-medium">{day.date}</td>
                      <td className="py-3 pr-4">{formatTemperature(day.meanTempF, temperatureUnit)}</td>
                      <td className="py-3 pr-4">{formatTemperature(day.minTempF, temperatureUnit)}</td>
                      <td className="py-3 pr-4">{formatTemperature(day.maxTempF, temperatureUnit)}</td>
                      <td className="py-3 pr-4">
                        {getDailyOperationContext(day)}
                      </td>
                      <td className="py-3 pr-4 text-center">{formatNumber(day.cop, 2)}</td>
                      <td className="py-3 pr-4 text-center">{formatPercent(day.fractionAboveCutout, 0)}</td>
                      <td className="py-3 text-center">{formatPercent(day.fractionBelowCutout, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </div>
    </details>
  )
}

const inputClassName =
  'h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-base outline-none transition focus:border-teal-700 focus:ring-2 focus:ring-teal-100'

function SectionHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div>
      <p className="text-sm font-semibold uppercase text-teal-700">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-neutral-600">{body}</p>
    </div>
  )
}

function NumberField({
  label,
  value,
  suffix,
  step = 'any',
  allowNegative = false,
  readOnly = false,
  onChange,
}: {
  label: string
  value: string
  suffix?: string
  step?: string
  allowNegative?: boolean
  readOnly?: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      <div className="relative">
        <input
          className={`${inputClassName} ${suffix ? 'pr-20' : ''}`}
          inputMode="decimal"
          min={allowNegative ? undefined : '0'}
          readOnly={readOnly}
          step={step}
          type="number"
          value={value}
          onChange={onChange}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">
            {suffix}
          </span>
        )}
      </div>
    </label>
  )
}

function MoneyField({
  label,
  value,
  suffix,
  step = 'any',
  readOnly = false,
  onChange,
}: {
  label: string
  value: string
  suffix?: string
  step?: string
  readOnly?: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500">
          $
        </span>
        <input
          className={`${inputClassName} px-7 ${suffix ? 'pr-16' : ''}`}
          inputMode="decimal"
          min="0"
          readOnly={readOnly}
          step={step}
          type="number"
          value={value}
          onChange={onChange}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">
            {suffix}
          </span>
        )}
      </div>
    </label>
  )
}

function DateField({
  label,
  value,
  readOnly = false,
  onChange,
}: {
  label: string
  value: string
  readOnly?: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      <input className={inputClassName} type="date" value={value} readOnly={readOnly} onChange={onChange} />
    </label>
  )
}

function NumberTableInput({
  ariaLabel,
  value,
  suffix,
  allowNegative = false,
  readOnly = false,
  onChange,
}: {
  ariaLabel: string
  value: string
  suffix?: string
  allowNegative?: boolean
  readOnly?: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="relative">
      <input
        aria-label={ariaLabel}
        className={`${inputClassName} h-10 ${suffix ? 'pr-16' : ''}`}
        inputMode="decimal"
        min={allowNegative ? undefined : '0'}
        readOnly={readOnly}
        type="number"
        value={value}
        onChange={onChange}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500">
          {suffix}
        </span>
      )}
    </div>
  )
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-neutral-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  )
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-neutral-950">{value}</p>
    </div>
  )
}

function CostBar({
  label,
  value,
  width,
  dark = false,
}: {
  label: string
  value: string
  width: string
  dark?: boolean
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-neutral-600">{value}</span>
      </div>
      <div className="h-3.5 overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-3.5 rounded-full ${dark ? 'bg-neutral-800' : 'bg-teal-600'}`} style={{ width }} />
      </div>
    </div>
  )
}

function StatusMessage({ tone, message }: { tone: 'neutral' | 'error'; message: string }) {
  const className =
    tone === 'error'
      ? 'rounded-lg bg-red-50 p-4 text-sm leading-6 text-red-800'
      : 'rounded-lg bg-neutral-50 p-4 text-sm leading-6 text-neutral-700'

  return <p className={className}>{message}</p>
}

function BreakdownItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1.5 py-3 sm:border-t sm:border-neutral-200">
      <dt className="text-neutral-600">{label}</dt>
      <dd className="font-semibold text-neutral-950">{value}</dd>
    </div>
  )
}

export default App
