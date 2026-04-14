import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { appConfig } from './config'

const loginInputClassName =
  'h-10 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm text-white outline-none placeholder:text-zinc-500 transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20'

type AuthContextValue = {
  session: Session | null
  ready: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    void supabase.auth.getSession().then(({ data: { session: initial } }) => {
      if (!cancelled) {
        setSession(initial)
        setReady(true)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const value = useMemo(() => ({ session, ready, signOut }), [session, ready, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}

export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const configured = Boolean(appConfig.supabaseUrl && appConfig.supabaseAnonKey)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!configured) {
      setError('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
      return
    }

    setSubmitting(true)
    try {
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signError) {
        setError(signError.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950">
      <div className="mx-auto flex min-h-screen w-full max-w-sm items-center px-6 py-12">
        <section className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
          <div className="mb-8 flex flex-col items-center text-center">
            <img src="/logo.png" alt="Comfort Hub" className="h-9 w-auto" />
            <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white">Welcome back</h1>
            <p className="mt-1.5 text-sm text-zinc-400">Sign in to continue</p>
          </div>

          <form className="grid gap-4" onSubmit={(e) => void onSubmit(e)}>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-zinc-300">Email</span>
              <input
                className={loginInputClassName}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-zinc-300">Password</span>
              <input
                className={loginInputClassName}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-400">{error}</p>
            )}
            <button
              className="mt-1 inline-flex h-10 w-full items-center justify-center rounded-lg bg-white text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100 focus:outline-none disabled:cursor-wait disabled:opacity-60"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}
