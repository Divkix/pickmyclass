'use client'

import { useAuth } from '@/lib/contexts/AuthContext'
import AuthButton from '@/components/AuthButton'

export default function Home() {
  const { user, loading } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-bold text-zinc-950 dark:text-zinc-50">
          PickMyClass
        </h1>
        <AuthButton />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl space-y-8 text-center">
          {loading ? (
            <div className="space-y-4">
              <div className="mx-auto h-12 w-64 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
              <div className="mx-auto h-6 w-96 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
            </div>
          ) : user ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-4xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                  Welcome back!
                </h2>
                <p className="text-lg text-zinc-600 dark:text-zinc-400">
                  You&apos;re signed in as <span className="font-medium text-zinc-950 dark:text-zinc-50">{user.email}</span>
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-4 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
                  Get Started
                </h3>
                <p className="text-zinc-600 dark:text-zinc-400">
                  Your class selection dashboard will appear here. Start building your schedule and managing your classes.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-4xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                  Welcome to PickMyClass
                </h2>
                <p className="text-lg text-zinc-600 dark:text-zinc-400">
                  Your smart class selection assistant
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-4 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
                  Get Started Today
                </h3>
                <p className="mb-6 text-zinc-600 dark:text-zinc-400">
                  Sign up now to start planning your perfect class schedule
                </p>
                <AuthButton />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
