export type DailyWeather = {
  date: string
  meanTempF: number
  minTempF: number
  maxTempF: number
}

type OpenMeteoArchiveResponse = {
  daily?: {
    time?: unknown
    temperature_2m_mean?: unknown
    temperature_2m_min?: unknown
    temperature_2m_max?: unknown
  }
}

const ottawaWeatherConfig = {
  latitude: '45.4215',
  longitude: '-75.6972',
  timezone: 'America/Toronto',
}

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

export async function fetchOttawaHistoricalWeather(
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<DailyWeather[]> {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive')

  url.searchParams.set('latitude', ottawaWeatherConfig.latitude)
  url.searchParams.set('longitude', ottawaWeatherConfig.longitude)
  url.searchParams.set('start_date', startDate)
  url.searchParams.set('end_date', endDate)
  url.searchParams.set('daily', 'temperature_2m_mean,temperature_2m_min,temperature_2m_max')
  url.searchParams.set('temperature_unit', 'fahrenheit')
  url.searchParams.set('timezone', ottawaWeatherConfig.timezone)

  const response = await fetch(url, { signal })

  if (!response.ok) {
    throw new Error('Weather data could not be loaded for that date range.')
  }

  const data = (await response.json()) as OpenMeteoArchiveResponse
  return mapOpenMeteoDailyWeather(data)
}

export function mapOpenMeteoDailyWeather(data: OpenMeteoArchiveResponse): DailyWeather[] {
  const time = data.daily?.time
  const mean = data.daily?.temperature_2m_mean
  const min = data.daily?.temperature_2m_min
  const max = data.daily?.temperature_2m_max

  if (!isStringArray(time) || !isNumberArray(mean) || !isNumberArray(min) || !isNumberArray(max)) {
    throw new Error('Weather data came back in an unexpected format.')
  }

  const lengthsMatch = time.length === mean.length && time.length === min.length && time.length === max.length

  if (!lengthsMatch || time.length === 0) {
    throw new Error('Weather data was incomplete for that date range.')
  }

  return time.map((date, index) => ({
    date,
    meanTempF: mean[index],
    minTempF: min[index],
    maxTempF: max[index],
  }))
}
