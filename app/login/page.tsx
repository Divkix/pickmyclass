'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    // Check if user just registered
    if (searchParams.get('registered') === 'true') {
      setSuccess('Account created successfully! Please sign in.')
    }
    // Check if password was reset
    if (searchParams.get('password_reset') === 'true') {
      setSuccess('Password reset successfully! Please sign in with your new password.')
    }
  }, [searchParams])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    // Validation
    if (!email || !password) {
      setError('Email and password are required')
      setLoading(false)
      return
    }

    try {
      const supabase = createClient()
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        setError(signInError.message)
        setLoading(false)
        return
      }

      if (data.user) {
        // Successfully logged in
        router.push('/')
        router.refresh()
      }
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white px-8 py-12 shadow-lg dark:bg-zinc-900">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Sign In
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Welcome back! Please sign in to continue
          </p>
        </div>

        <form onSubmit={handleLogin} className="mt-8 space-y-6">
          <div className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-zinc-950 dark:text-zinc-50"
              >
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 placeholder-zinc-400 shadow-sm focus:border-zinc-950 focus:outline-none focus:ring-1 focus:ring-zinc-950 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder-zinc-500 dark:focus:border-zinc-50 dark:focus:ring-zinc-50"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-zinc-950 dark:text-zinc-50"
                >
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-sm font-medium text-zinc-950 hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-300"
                >
                  Forgot password?
                </Link>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 placeholder-zinc-400 shadow-sm focus:border-zinc-950 focus:outline-none focus:ring-1 focus:ring-zinc-950 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder-zinc-500 dark:focus:border-zinc-50 dark:focus:ring-zinc-50"
                placeholder="••••••••"
              />
            </div>
          </div>

          {success && (
            <div className="rounded-md bg-green-50 p-3 dark:bg-green-900/20">
              <p className="text-sm text-green-800 dark:text-green-400">{success}</p>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 p-3 dark:bg-red-900/20">
              <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full justify-center rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 dark:focus:ring-zinc-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <div className="text-center text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">
              Don&apos;t have an account?{' '}
            </span>
            <Link
              href="/register"
              className="font-medium text-zinc-950 hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-300"
            >
              Sign up
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
        <div className="w-full max-w-md space-y-8 rounded-lg bg-white px-8 py-12 shadow-lg dark:bg-zinc-900">
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
              Loading...
            </h1>
          </div>
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
