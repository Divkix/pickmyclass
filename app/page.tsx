import Link from 'next/link'
import { Header } from '@/components/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="border-b border-border bg-gradient-to-b from-background to-muted/20 px-6 py-24">
          <div className="mx-auto max-w-4xl space-y-8 text-center">
            <div className="space-y-4">
              <h1 className="text-5xl font-bold tracking-tight text-foreground sm:text-6xl">
                Never Miss a Seat in Your Classes
              </h1>
              <p className="mx-auto max-w-2xl text-xl text-muted-foreground">
                Get instant email notifications when seats become available or instructors are assigned to your waitlisted ASU classes.
              </p>
            </div>
            <div className="flex justify-center gap-4">
              <Link href="/register">
                <Button size="lg" className="text-base">
                  Get Started Free
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="text-base">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="border-b border-border px-6 py-16">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-12 text-center text-3xl font-bold text-foreground">
              Stop Refreshing. Start Getting Notified.
            </h2>
            <div className="grid gap-8 md:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-xl">Seat Monitoring</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    Automatic checks every 30 minutes. Get notified the moment a seat opens in your full class.
                  </CardDescription>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-xl">Instructor Tracking</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    Know immediately when "Staff" sections get assigned to specific professors.
                  </CardDescription>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-xl">Real-Time Updates</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    Dashboard updates live with current seat counts and instructor info as data changes.
                  </CardDescription>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="px-6 py-16">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-12 text-center text-3xl font-bold text-foreground">
              How It Works
            </h2>
            <div className="space-y-8">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                  1
                </div>
                <div>
                  <h3 className="mb-2 text-xl font-semibold text-foreground">Add Your Classes</h3>
                  <p className="text-muted-foreground">
                    Search for ASU classes by section number and add them to your watchlist.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                  2
                </div>
                <div>
                  <h3 className="mb-2 text-xl font-semibold text-foreground">We Monitor for You</h3>
                  <p className="text-muted-foreground">
                    Our system checks ASU's class search every 30 minutes for seat availability and instructor changes.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                  3
                </div>
                <div>
                  <h3 className="mb-2 text-xl font-semibold text-foreground">Get Notified Instantly</h3>
                  <p className="text-muted-foreground">
                    Receive an email notification the moment a seat opens up or an instructor is assigned. Register before it's too late.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-12 text-center">
              <Link href="/register">
                <Button size="lg" className="text-base">
                  Start Watching Your Classes
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
