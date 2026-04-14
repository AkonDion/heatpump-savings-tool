import { useState } from 'react'
import App from './App'
import { LoginScreen, useAuth } from './auth'
import { getSharedReportIdFromPath } from './sharing'

export function Boot() {
  const [sharedBypass] = useState(() => Boolean(getSharedReportIdFromPath(window.location.pathname)))
  const { session, ready } = useAuth()

  if (!sharedBypass && !ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 text-neutral-950">
        <p className="text-sm text-neutral-600">Loading…</p>
      </div>
    )
  }

  if (!sharedBypass && !session) {
    return <LoginScreen />
  }

  return <App />
}
