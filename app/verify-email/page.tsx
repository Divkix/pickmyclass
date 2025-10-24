'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

export const dynamic = 'force-dynamic'

export default function VerifyEmailPage() {
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string>('')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const getUserEmail = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.email) {
        setUserEmail(user.email)
      }
    }
    getUserEmail()
  }, [supabase])

  const handleResendVerification = async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user?.email) {
        setError('No email found. Please sign in again.')
        setLoading(false)
        return
      }

      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: user.email,
      })

      if (resendError) {
        setError(resendError.message)
      } else {
        setSuccess('Verification email sent! Please check your inbox.')
      }
    } catch (err) {
      setError('Failed to resend verification email')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl">Verify Your Email</CardTitle>
            <CardDescription>
              Please check your email to verify your account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-4 text-sm text-blue-800 dark:text-blue-300">
              <p className="font-medium mb-2">
                We sent a verification email to:
              </p>
              <p className="font-mono text-xs break-all">
                {userEmail || 'your email address'}
              </p>
              <p className="mt-4">
                Click the link in the email to verify your account and start monitoring classes.
              </p>
            </div>

            {success && (
              <Alert className="bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/50">
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <Button
                onClick={handleResendVerification}
                disabled={loading}
                variant="outline"
                className="w-full"
              >
                {loading ? 'Sending...' : 'Resend Verification Email'}
              </Button>

              <Button
                onClick={handleSignOut}
                variant="ghost"
                className="w-full"
              >
                Sign Out
              </Button>
            </div>

            <div className="text-center text-sm text-muted-foreground">
              <p>
                Didn&apos;t receive the email? Check your spam folder or click the button above to resend.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
