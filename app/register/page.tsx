'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

export const dynamic = 'force-dynamic'

/**
 * Simple client-side password strength checker
 * Returns score 0-4 based on password characteristics
 */
function calculatePasswordStrength(password: string): {
  score: number
  feedback: { warning?: string; suggestions?: string[] }
} {
  if (!password) return { score: 0, feedback: {} }

  let score = 0
  const feedback: string[] = []

  // Length check
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  else if (password.length < 8) feedback.push('Use at least 8 characters')

  // Character variety checks
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  else feedback.push('Use both uppercase and lowercase letters')

  if (/\d/.test(password)) score++
  else feedback.push('Add numbers')

  if (/[^a-zA-Z0-9]/.test(password)) score++
  else feedback.push('Add special characters')

  // Cap at 4
  score = Math.min(score, 4)

  return {
    score,
    feedback: { suggestions: feedback.length > 0 ? feedback : undefined },
  }
}

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [ageVerified, setAgeVerified] = useState(false)
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [passwordStrength, setPasswordStrength] = useState<{
    score: number
    feedback: { warning?: string; suggestions?: string[] }
  } | null>(null)
  const router = useRouter()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <div className="flex flex-1 items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <CardTitle className="text-3xl">Loading...</CardTitle>
            </CardHeader>
          </Card>
        </div>
      </div>
    )
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pwd = e.target.value
    setPassword(pwd)

    // Calculate password strength
    if (pwd.length > 0) {
      setPasswordStrength(calculatePasswordStrength(pwd))
    } else {
      setPasswordStrength(null)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    // Validation
    if (!email || !password || !confirmPassword) {
      setError('All fields are required')
      setLoading(false)
      return
    }

    if (!ageVerified) {
      setError('You must be 18 years or older to use this service')
      setLoading(false)
      return
    }

    if (!agreedToTerms) {
      setError('You must agree to the Terms of Service and Privacy Policy')
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      setLoading(false)
      return
    }

    // Enforce minimum password strength (score 3 or higher)
    if (passwordStrength && passwordStrength.score < 3) {
      setError('Password is too weak. Please use a stronger password.')
      setLoading(false)
      return
    }

    try {
      const supabase = createClient()
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      })

      if (signUpError) {
        setError(signUpError.message)
        setLoading(false)
        return
      }

      if (data.user) {
        // Check if email confirmation is required
        if (data.user.identities?.length === 0) {
          setError('This email is already registered. Please sign in.')
        } else {
          // Update user profile with age verification and terms agreement
          const { error: profileError } = await supabase
            .from('user_profiles')
            .update({
              age_verified_at: new Date().toISOString(),
              agreed_to_terms_at: new Date().toISOString(),
            })
            .eq('user_id', data.user.id)

          if (profileError) {
            console.error('Error updating profile:', profileError)
            // Don't fail registration if profile update fails
          }

          // Redirect to verification page
          // The middleware will handle the redirect if email is not confirmed
          router.push('/verify-email')
        }
      }
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignUp = async () => {
    // Validate checkboxes before initiating OAuth
    if (!ageVerified) {
      setError('You must be 18 years or older to use this service')
      return
    }

    if (!agreedToTerms) {
      setError('You must agree to the Terms of Service and Privacy Policy')
      return
    }

    try {
      setError(null)
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (error) {
        setError(error.message)
      }
    } catch (err) {
      setError('Failed to initiate Google sign-up')
      console.error(err)
    }
  }

  // Check if form is valid and password is strong enough
  const isFormValid = email && password && confirmPassword && ageVerified && agreedToTerms &&
    password === confirmPassword && password.length >= 8 &&
    passwordStrength && passwordStrength.score >= 3

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">Create Account</CardTitle>
          <CardDescription>
            Sign up to get started
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRegister} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={handlePasswordChange}
                  placeholder="••••••••"
                />
                {password && passwordStrength && (
                  <div className="space-y-2">
                    {/* Strength bar */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            passwordStrength.score <= 1
                              ? 'bg-red-500'
                              : passwordStrength.score === 2
                                ? 'bg-yellow-500'
                                : passwordStrength.score === 3
                                  ? 'bg-blue-500'
                                  : 'bg-green-500'
                          }`}
                          style={{ width: `${(passwordStrength.score / 4) * 100}%` }}
                        />
                      </div>
                      <span
                        className={`text-sm font-medium ${
                          passwordStrength.score <= 1
                            ? 'text-red-600 dark:text-red-400'
                            : passwordStrength.score === 2
                              ? 'text-yellow-600 dark:text-yellow-400'
                              : passwordStrength.score === 3
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-green-600 dark:text-green-400'
                        }`}
                      >
                        {passwordStrength.score <= 1
                          ? 'Weak'
                          : passwordStrength.score === 2
                            ? 'Fair'
                            : passwordStrength.score === 3
                              ? 'Good'
                              : 'Strong'}
                      </span>
                    </div>

                    {/* Feedback messages */}
                    {passwordStrength.feedback.suggestions &&
                      passwordStrength.feedback.suggestions.length > 0 && (
                        <ul className="text-xs text-zinc-600 dark:text-zinc-400 list-disc list-inside space-y-0.5">
                          {passwordStrength.feedback.suggestions.map((suggestion, idx) => (
                            <li key={idx}>{suggestion}</li>
                          ))}
                        </ul>
                      )}
                  </div>
                )}
                {password && (!passwordStrength || passwordStrength.score < 3) && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Minimum password strength: Good (score 3/4)
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              <div className="space-y-4 pt-2">
                <div className="flex items-start space-x-2">
                  <input
                    id="ageVerified"
                    type="checkbox"
                    checked={ageVerified}
                    onChange={(e) => setAgeVerified(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-input"
                    required
                  />
                  <Label htmlFor="ageVerified" className="text-sm font-normal cursor-pointer">
                    I am 18 years or older and a resident of the United States
                  </Label>
                </div>

                <div className="flex items-start space-x-2">
                  <input
                    id="agreedToTerms"
                    type="checkbox"
                    checked={agreedToTerms}
                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-input"
                    required
                  />
                  <Label htmlFor="agreedToTerms" className="text-sm font-normal cursor-pointer">
                    I agree to the{' '}
                    <Link
                      href="/legal/terms"
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                      target="_blank"
                    >
                      Terms of Service
                    </Link>{' '}
                    and{' '}
                    <Link
                      href="/legal/privacy"
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                      target="_blank"
                    >
                      Privacy Policy
                    </Link>
                  </Label>
                </div>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={loading || !isFormValid} className="w-full">
              {loading ? 'Creating account...' : 'Create account'}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Or continue with
                </span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleSignUp}
              className="w-full"
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Sign up with Google
            </Button>

            <div className="text-center text-sm">
              <span className="text-muted-foreground">
                Already have an account?{' '}
              </span>
              <Link
                href="/login"
                className="font-medium text-foreground hover:text-muted-foreground"
              >
                Sign in
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
