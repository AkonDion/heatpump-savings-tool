import type { DailyWeather } from './weather'

export const propaneKwhPerLitre = 25.3 / 3.6
export const furnaceEfficiency = 0.95
export const heatingBaseTempF = 65
export const kwhToMmbtu = 0.003412141633
export const btuPerKwh = 3412.14

export type BalanceStrategy = 'strict' | 'standard' | 'loose' | 'custom'

export type HeatingPerformancePoint = {
  id: string
  outdoorTempF: number
  cop: number
  capacityBtuH: number | null
}

export type WeatherWeightedDay = DailyWeather & {
  heatingWeight: number
}

export type DailyOperation = WeatherWeightedDay & {
  dailyRequiredHeatKwh: number
  cop: number
  fractionAboveCutout: number
  fractionBelowCutout: number
  heatPumpHeatKwh: number
  backupHeatKwh: number
  heatPumpKwh: number
  backupLitres: number
  backupCost: number
  operationMode: 'heat-pump' | 'backup' | 'partial'
}

export type WeatherAwareCalculationInput = {
  propaneLitres: number
  propaneCost: number
  electricityRate: number
  capacityBalancePointF: number
  strategyOffsetF: number
  performancePoints: HeatingPerformancePoint[]
  weather: DailyWeather[]
}

export type WeatherAwareCalculationResult = {
  deliveredHeatKwh: number
  propaneCostPerDeliveredKwh: number
  breakEvenCop: number
  effectiveCutoutTempF: number
  buildingUA: number
  totalHeatPumpHeatKwh: number
  totalHeatPumpKwh: number
  totalHeatPumpCost: number
  totalBackupHeatKwh: number
  totalBackupLitres: number
  totalBackupCost: number
  totalHybridCost: number
  estimatedSavings: number
  backupHeatShare: number
  daysAnalyzed: number
  daysFullyAboveCutout: number
  daysFullyBelowCutout: number
  daysPartiallyCrossingCutout: number
  activeHeatPumpDays: number
  averageInterpolatedCop: number
  dailyOperations: DailyOperation[]
}

export type OperationBandId = 'fully-below' | 'crossing' | 'near' | 'moderate' | 'mild'

export type OperationBandSummary = {
  id: OperationBandId
  label: string
  interpretation: string
  dayCount: number
  dayShare: number
  averageMeanTempF: number | null
  averageMinTempF: number | null
  averageMaxTempF: number | null
  averageCop: number | null
}

export type WeatherDistributionSummary = {
  coldestDailyMinimumF: number
  warmestDailyMaximumF: number
  averageDailyMeanF: number
  meanBelow5F: number
  meanBelow17F: number
  meanBelow47F: number
  meanAbove47F: number
  daysNearCutout: number
}

export type CopInterpolationRangeSummary = {
  id: string
  type: 'clamp-cold' | 'clamp-warm' | 'interpolate' | 'single-point' | 'none'
  lowerTempF: number | null
  upperTempF: number | null
  dayCount: number
  heatPumpHeatKwh: number
}

export const balanceStrategyOffsets: Record<Exclude<BalanceStrategy, 'custom'>, number> = {
  strict: 5,
  standard: 0,
  loose: -5,
}

export const getStrategyOffset = (strategy: BalanceStrategy, customOffsetF: number) =>
  strategy === 'custom' ? customOffsetF : balanceStrategyOffsets[strategy]

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export const sortPerformancePoints = (points: HeatingPerformancePoint[]) =>
  [...points].sort((a, b) => a.outdoorTempF - b.outdoorTempF)

export const filterValidPerformancePoints = (points: HeatingPerformancePoint[]) =>
  sortPerformancePoints(
    points.filter(
      (point) =>
        Number.isFinite(point.outdoorTempF) &&
        Number.isFinite(point.cop) &&
        point.cop > 0,
    ),
  )

export function interpolateValueByTemperature<T extends { outdoorTempF: number }>(
  points: T[],
  outdoorTempF: number,
  getValue: (point: T) => number,
): number | null {
  const sortedPoints = [...points]
    .filter((point) => Number.isFinite(point.outdoorTempF) && Number.isFinite(getValue(point)))
    .sort((a, b) => a.outdoorTempF - b.outdoorTempF)

  if (sortedPoints.length === 0) {
    return null
  }

  if (sortedPoints.length === 1 || outdoorTempF <= sortedPoints[0].outdoorTempF) {
    return getValue(sortedPoints[0])
  }

  const warmestPoint = sortedPoints[sortedPoints.length - 1]

  if (outdoorTempF >= warmestPoint.outdoorTempF) {
    return getValue(warmestPoint)
  }

  const upperIndex = sortedPoints.findIndex((point) => point.outdoorTempF >= outdoorTempF)
  const lowerPoint = sortedPoints[upperIndex - 1]
  const upperPoint = sortedPoints[upperIndex]
  const temperatureRange = upperPoint.outdoorTempF - lowerPoint.outdoorTempF

  if (temperatureRange === 0) {
    return getValue(upperPoint)
  }

  const ratio = (outdoorTempF - lowerPoint.outdoorTempF) / temperatureRange
  return getValue(lowerPoint) + ratio * (getValue(upperPoint) - getValue(lowerPoint))
}

export const interpolateCop = (points: HeatingPerformancePoint[], outdoorTempF: number) =>
  interpolateValueByTemperature(filterValidPerformancePoints(points), outdoorTempF, (point) => point.cop)

export const interpolateCapacity = (points: HeatingPerformancePoint[], outdoorTempF: number) =>
  interpolateValueByTemperature(
    filterValidPerformancePoints(points).filter(
      (point): point is HeatingPerformancePoint & { capacityBtuH: number } =>
        point.capacityBtuH !== null && Number.isFinite(point.capacityBtuH) && point.capacityBtuH > 0,
    ),
    outdoorTempF,
    (point) => point.capacityBtuH,
  )

export const getWeightedAverageCopForHeatPumpLoad = (dailyOperations: DailyOperation[]) => {
  const heatPumpHeatKwh = dailyOperations.reduce((sum, day) => sum + day.heatPumpHeatKwh, 0)
  const heatPumpKwh = dailyOperations.reduce((sum, day) => sum + day.heatPumpKwh, 0)

  return heatPumpKwh > 0 ? heatPumpHeatKwh / heatPumpKwh : 0
}

export function classifyOperationBand(day: DailyOperation, effectiveCutoutTempF: number): OperationBandId {
  if (day.operationMode === 'backup') {
    return 'fully-below'
  }

  if (day.operationMode === 'partial') {
    return 'crossing'
  }

  const degreesAboveCutout = day.meanTempF - effectiveCutoutTempF

  if (degreesAboveCutout < 5) {
    return 'near'
  }

  if (degreesAboveCutout < 15) {
    return 'moderate'
  }

  return 'mild'
}

const operationBandDefinitions: Record<
  OperationBandId,
  Pick<OperationBandSummary, 'id' | 'label' | 'interpretation'>
> = {
  'fully-below': {
    id: 'fully-below',
    label: 'Fully below cutout',
    interpretation: 'Backup heat only',
  },
  crossing: {
    id: 'crossing',
    label: 'Partially crossing cutout',
    interpretation: 'Heat pump may need backup',
  },
  near: {
    id: 'near',
    label: 'Near cutout',
    interpretation: 'Heat pump may need backup',
  },
  moderate: {
    id: 'moderate',
    label: 'Moderate heat pump zone',
    interpretation: 'Heat pump only',
  },
  mild: {
    id: 'mild',
    label: 'Warm / low-heating zone',
    interpretation: 'Heat pump optional or system off',
  },
}

const average = (values: number[]) =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null

export function summarizeOperationBands(
  dailyOperations: DailyOperation[],
  effectiveCutoutTempF: number,
): OperationBandSummary[] {
  const daysAnalyzed = dailyOperations.length

  return Object.values(operationBandDefinitions).map((band) => {
    const days = dailyOperations.filter((day) => classifyOperationBand(day, effectiveCutoutTempF) === band.id)

    return {
      ...band,
      dayCount: days.length,
      dayShare: daysAnalyzed > 0 ? days.length / daysAnalyzed : 0,
      averageMeanTempF: average(days.map((day) => day.meanTempF)),
      averageMinTempF: average(days.map((day) => day.minTempF)),
      averageMaxTempF: average(days.map((day) => day.maxTempF)),
      averageCop: average(days.filter((day) => day.heatPumpHeatKwh > 0).map((day) => day.cop)),
    }
  })
}

export function summarizeWeatherDistribution(
  dailyOperations: DailyOperation[],
  effectiveCutoutTempF: number,
): WeatherDistributionSummary {
  const meanTemps = dailyOperations.map((day) => day.meanTempF)
  const minTemps = dailyOperations.map((day) => day.minTempF)
  const maxTemps = dailyOperations.map((day) => day.maxTempF)

  return {
    coldestDailyMinimumF: Math.min(...minTemps),
    warmestDailyMaximumF: Math.max(...maxTemps),
    averageDailyMeanF: average(meanTemps) ?? 0,
    meanBelow5F: dailyOperations.filter((day) => day.meanTempF < 5).length,
    meanBelow17F: dailyOperations.filter((day) => day.meanTempF < 17).length,
    meanBelow47F: dailyOperations.filter((day) => day.meanTempF < 47).length,
    meanAbove47F: dailyOperations.filter((day) => day.meanTempF > 47).length,
    daysNearCutout: countDaysNearCutout(dailyOperations, effectiveCutoutTempF),
  }
}

export const countDaysNearCutout = (dailyOperations: DailyOperation[], effectiveCutoutTempF: number) =>
  dailyOperations.filter((day) => Math.abs(day.meanTempF - effectiveCutoutTempF) <= 5).length

export function getCopInterpolationRange(
  points: HeatingPerformancePoint[],
  outdoorTempF: number,
): Pick<CopInterpolationRangeSummary, 'id' | 'type' | 'lowerTempF' | 'upperTempF'> {
  const validPoints = filterValidPerformancePoints(points)

  if (validPoints.length === 0) {
    return {
      id: 'none',
      type: 'none',
      lowerTempF: null,
      upperTempF: null,
    }
  }

  if (validPoints.length === 1) {
    return {
      id: `single-${validPoints[0].outdoorTempF}`,
      type: 'single-point',
      lowerTempF: validPoints[0].outdoorTempF,
      upperTempF: null,
    }
  }

  if (outdoorTempF <= validPoints[0].outdoorTempF) {
    return {
      id: `cold-${validPoints[0].outdoorTempF}`,
      type: 'clamp-cold',
      lowerTempF: validPoints[0].outdoorTempF,
      upperTempF: null,
    }
  }

  const warmestPoint = validPoints[validPoints.length - 1]

  if (outdoorTempF >= warmestPoint.outdoorTempF) {
    return {
      id: `warm-${warmestPoint.outdoorTempF}`,
      type: 'clamp-warm',
      lowerTempF: warmestPoint.outdoorTempF,
      upperTempF: null,
    }
  }

  const upperIndex = validPoints.findIndex((point) => point.outdoorTempF >= outdoorTempF)
  const lowerPoint = validPoints[upperIndex - 1]
  const upperPoint = validPoints[upperIndex]

  return {
    id: `range-${lowerPoint.outdoorTempF}-${upperPoint.outdoorTempF}`,
    type: 'interpolate',
    lowerTempF: lowerPoint.outdoorTempF,
    upperTempF: upperPoint.outdoorTempF,
  }
}

export function summarizeCopInterpolationRanges(
  dailyOperations: DailyOperation[],
  points: HeatingPerformancePoint[],
): CopInterpolationRangeSummary[] {
  const summaryByLabel = new Map<string, CopInterpolationRangeSummary>()

  for (const day of dailyOperations) {
    const range = getCopInterpolationRange(points, day.meanTempF)
    const existing = summaryByLabel.get(range.id)

    if (existing) {
      existing.dayCount += 1
      existing.heatPumpHeatKwh += day.heatPumpHeatKwh
    } else {
      summaryByLabel.set(range.id, {
        ...range,
        dayCount: 1,
        heatPumpHeatKwh: day.heatPumpHeatKwh,
      })
    }
  }

  return [...summaryByLabel.values()]
}

export const addHeatingWeights = (weather: DailyWeather[]): WeatherWeightedDay[] =>
  weather.map((day) => ({
    ...day,
    heatingWeight: Math.max(0, heatingBaseTempF - day.meanTempF),
  }))

export function getCutoutSplit(day: DailyWeather, effectiveCutoutTempF: number) {
  if (day.maxTempF <= effectiveCutoutTempF) {
    return {
      fractionBelowCutout: 1,
      fractionAboveCutout: 0,
      operationMode: 'backup' as const,
    }
  }

  if (day.minTempF >= effectiveCutoutTempF) {
    return {
      fractionBelowCutout: 0,
      fractionAboveCutout: 1,
      operationMode: 'heat-pump' as const,
    }
  }

  const temperatureRange = day.maxTempF - day.minTempF
  const fractionBelowCutout =
    temperatureRange > 0 ? clamp((effectiveCutoutTempF - day.minTempF) / temperatureRange, 0, 1) : 0

  return {
    fractionBelowCutout,
    fractionAboveCutout: 1 - fractionBelowCutout,
    operationMode: 'partial' as const,
  }
}

export function deriveBuildingUA(deliveredHeatKwh: number, totalHeatingWeight: number): number {
  return (deliveredHeatKwh * btuPerKwh) / (totalHeatingWeight * 24)
}

const diurnalWeights = [0.25, 0.5, 0.25] as const

function evaluateDailyHeatPumpPerformance(
  day: WeatherWeightedDay,
  buildingUA: number,
  effectiveCutoutTempF: number,
  performancePoints: HeatingPerformancePoint[],
  hasCapacityData: boolean,
): { hpHeatFraction: number; effectiveCop: number; operationMode: 'heat-pump' | 'backup' | 'partial' } {
  if (day.heatingWeight <= 0) {
    return { hpHeatFraction: 1, effectiveCop: 0, operationMode: 'heat-pump' }
  }

  const temps = [day.minTempF, day.meanTempF, day.maxTempF]

  let weightedHpLoad = 0
  let weightedHpElec = 0
  let weightedTotalLoad = 0

  for (let i = 0; i < 3; i++) {
    const temp = temps[i]
    const w = diurnalWeights[i]
    const loadIntensity = Math.max(0, heatingBaseTempF - temp)

    if (loadIntensity <= 0) continue
    weightedTotalLoad += w * loadIntensity

    if (temp < effectiveCutoutTempF) continue

    const cop = interpolateCop(performancePoints, temp) ?? 0

    let coverage = 1
    if (hasCapacityData) {
      const buildingLoadBtuh = buildingUA * loadIntensity
      const hpCapacityBtuh = interpolateCapacity(performancePoints, temp)
      if (hpCapacityBtuh !== null && buildingLoadBtuh > 0) {
        coverage = Math.min(1, hpCapacityBtuh / buildingLoadBtuh)
      }
    }

    weightedHpLoad += w * coverage * loadIntensity
    if (cop > 0) {
      weightedHpElec += w * coverage * loadIntensity / cop
    }
  }

  const hpHeatFraction = weightedTotalLoad > 0 ? clamp(weightedHpLoad / weightedTotalLoad, 0, 1) : 0
  const effectiveCop = weightedHpElec > 0 ? weightedHpLoad / weightedHpElec : 0

  const operationMode: 'heat-pump' | 'backup' | 'partial' =
    hpHeatFraction > 0.999 ? 'heat-pump' : hpHeatFraction < 0.001 ? 'backup' : 'partial'

  return { hpHeatFraction, effectiveCop, operationMode }
}

export function calculateWeatherAwareSavings({
  propaneLitres,
  propaneCost,
  electricityRate,
  capacityBalancePointF,
  strategyOffsetF,
  performancePoints,
  weather,
}: WeatherAwareCalculationInput): WeatherAwareCalculationResult {
  const deliveredHeatKwh = propaneLitres * propaneKwhPerLitre * furnaceEfficiency
  const propaneCostPerDeliveredKwh = propaneCost / deliveredHeatKwh
  const breakEvenCop = electricityRate / propaneCostPerDeliveredKwh
  const effectiveCutoutTempF = capacityBalancePointF + strategyOffsetF
  const propaneCostPerLitre = propaneCost / propaneLitres
  const weightedDays = addHeatingWeights(weather)
  const totalHeatingWeight = weightedDays.reduce((sum, day) => sum + day.heatingWeight, 0)

  if (totalHeatingWeight <= 0) {
    throw new Error('There are no heating-degree days in this date range.')
  }

  const validPerformancePoints = filterValidPerformancePoints(performancePoints)

  if (validPerformancePoints.length === 0) {
    throw new Error('Enter at least one valid NEEP COP point.')
  }

  const buildingUA = deriveBuildingUA(deliveredHeatKwh, totalHeatingWeight)
  const hasCapacityData = validPerformancePoints.some(
    (p) => p.capacityBtuH !== null && Number.isFinite(p.capacityBtuH) && p.capacityBtuH > 0,
  )

  const dailyOperations = weightedDays.map((day) => {
    const dailyRequiredHeatKwh = deliveredHeatKwh * (day.heatingWeight / totalHeatingWeight)
    const { hpHeatFraction, effectiveCop, operationMode } = evaluateDailyHeatPumpPerformance(
      day,
      buildingUA,
      effectiveCutoutTempF,
      validPerformancePoints,
      hasCapacityData,
    )
    const heatPumpHeatKwh = dailyRequiredHeatKwh * hpHeatFraction
    const backupHeatKwh = dailyRequiredHeatKwh * (1 - hpHeatFraction)
    const heatPumpKwh = effectiveCop > 0 ? heatPumpHeatKwh / effectiveCop : 0
    const backupLitres = backupHeatKwh / (propaneKwhPerLitre * furnaceEfficiency)
    const backupCost = backupLitres * propaneCostPerLitre

    return {
      ...day,
      dailyRequiredHeatKwh,
      cop: effectiveCop,
      fractionAboveCutout: hpHeatFraction,
      fractionBelowCutout: 1 - hpHeatFraction,
      heatPumpHeatKwh,
      backupHeatKwh,
      heatPumpKwh,
      backupLitres,
      backupCost,
      operationMode,
    }
  })

  const totalHeatPumpKwh = dailyOperations.reduce((sum, day) => sum + day.heatPumpKwh, 0)
  const totalHeatPumpHeatKwh = dailyOperations.reduce((sum, day) => sum + day.heatPumpHeatKwh, 0)
  const totalBackupHeatKwh = dailyOperations.reduce((sum, day) => sum + day.backupHeatKwh, 0)
  const totalBackupLitres = dailyOperations.reduce((sum, day) => sum + day.backupLitres, 0)
  const totalBackupCost = dailyOperations.reduce((sum, day) => sum + day.backupCost, 0)
  const totalHeatPumpCost = totalHeatPumpKwh * electricityRate
  const totalHybridCost = totalHeatPumpCost + totalBackupCost
  const activeHeatPumpDays = dailyOperations.filter((day) => day.heatPumpHeatKwh > 0).length
  const averageInterpolatedCop = totalHeatPumpKwh > 0 ? totalHeatPumpHeatKwh / totalHeatPumpKwh : 0

  return {
    deliveredHeatKwh,
    propaneCostPerDeliveredKwh,
    breakEvenCop,
    effectiveCutoutTempF,
    buildingUA,
    totalHeatPumpHeatKwh,
    totalHeatPumpKwh,
    totalHeatPumpCost,
    totalBackupHeatKwh,
    totalBackupLitres,
    totalBackupCost,
    totalHybridCost,
    estimatedSavings: propaneCost - totalHybridCost,
    backupHeatShare: deliveredHeatKwh > 0 ? totalBackupHeatKwh / deliveredHeatKwh : 0,
    daysAnalyzed: dailyOperations.length,
    daysFullyAboveCutout: dailyOperations.filter((day) => day.operationMode === 'heat-pump').length,
    daysFullyBelowCutout: dailyOperations.filter((day) => day.operationMode === 'backup').length,
    daysPartiallyCrossingCutout: dailyOperations.filter((day) => day.operationMode === 'partial').length,
    activeHeatPumpDays,
    averageInterpolatedCop,
    dailyOperations,
  }
}
