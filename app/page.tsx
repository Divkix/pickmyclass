'use client'

import { useAuth } from '@/lib/contexts/AuthContext'
import AuthButton from '@/components/AuthButton'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function Home() {
  const { user, loading } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <h1 className="text-xl font-bold text-foreground">
          PickMyClass
        </h1>
        <AuthButton />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl space-y-8 text-center">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="mx-auto h-12 w-64" />
              <Skeleton className="mx-auto h-6 w-96" />
            </div>
          ) : user ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-4xl font-bold tracking-tight text-foreground">
                  Welcome back!
                </h2>
                <p className="text-lg text-muted-foreground">
                  You&apos;re signed in as <span className="font-medium text-foreground">{user.email}</span>
                </p>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl">Get Started</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    Your class selection dashboard will appear here. Start building your schedule and managing your classes.
                  </CardDescription>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-4xl font-bold tracking-tight text-foreground">
                  Welcome to PickMyClass
                </h2>
                <p className="text-lg text-muted-foreground">
                  Your smart class selection assistant
                </p>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl">Get Started Today</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <CardDescription className="text-base">
                    Sign up now to start planning your perfect class schedule
                  </CardDescription>
                  <AuthButton />
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
