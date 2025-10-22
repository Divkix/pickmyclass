'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Button } from './ui/button'
import { Alert } from './ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Lock, Search } from 'lucide-react'

interface AddClassWatchProps {
  onAdd: (watch: { term: string; subject: string; catalog_nbr: string; class_nbr: string }) => Promise<void>
}

interface FetchedClassDetails {
  subject: string
  catalog_nbr: string
  title: string
}

export function AddClassWatch({ onAdd }: AddClassWatchProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchedDetails, setFetchedDetails] = useState<FetchedClassDetails | null>(null)

  const [university] = useState('asu')
  const [term, setTerm] = useState('')
  const [classNbr, setClassNbr] = useState('')

  const handleFetchDetails = async () => {
    if (!term || !classNbr) {
      setError('Please select a term and enter a section number first')
      return
    }

    if (classNbr.length !== 5 || !/^\d{5}$/.test(classNbr)) {
      setError('Section number must be exactly 5 digits')
      return
    }

    setError(null)
    setIsFetching(true)

    try {
      const response = await fetch('/api/fetch-class-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term, class_nbr: classNbr }),
      })

      if (!response.ok) {
        throw new Error('Failed to fetch class details')
      }

      const data = await response.json()
      setFetchedDetails(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch class details')
      setFetchedDetails(null)
    } finally {
      setIsFetching(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!fetchedDetails) {
      setError('Please fetch class details before adding the watch')
      return
    }

    setIsSubmitting(true)

    try {
      await onAdd({
        term,
        subject: fetchedDetails.subject,
        catalog_nbr: fetchedDetails.catalog_nbr,
        class_nbr: classNbr,
      })
      // Reset form on success
      setTerm('')
      setClassNbr('')
      setFetchedDetails(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add class watch')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add New Class Watch</CardTitle>
        <CardDescription>
          Enter the class details to start monitoring for seat availability and instructor assignments.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert className="bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800">
              {error}
            </Alert>
          )}

          {/* University Dropdown (Disabled) */}
          <div className="space-y-2">
            <Label htmlFor="university">University *</Label>
            <div className="relative">
              <Select value={university} disabled>
                <SelectTrigger id="university">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asu">Arizona State University (ASU)</SelectItem>
                </SelectContent>
              </Select>
              <Lock className="absolute right-9 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">More universities coming soon</p>
          </div>

          {/* Term Dropdown */}
          <div className="space-y-2">
            <Label htmlFor="term">Term *</Label>
            <Select value={term} onValueChange={setTerm} required>
              <SelectTrigger id="term">
                <SelectValue placeholder="Select term" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2261">Spring 2026 (2261)</SelectItem>
                <SelectItem value="2264">Summer 2026 (2264)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">Select the term to monitor</p>
          </div>

          {/* Section Number */}
          <div className="space-y-2">
            <Label htmlFor="section_number">Section Number *</Label>
            <Input
              id="section_number"
              placeholder="12431"
              value={classNbr}
              onChange={(e) => {
                setClassNbr(e.target.value)
                setFetchedDetails(null) // Clear fetched details when section number changes
              }}
              required
              maxLength={5}
              pattern="\d{5}"
              title="Must be a 5-digit section number"
            />
            <p className="text-xs text-zinc-600 dark:text-zinc-400">5-digit section number</p>
          </div>

          {/* Fetch Details Button */}
          <Button
            type="button"
            variant="outline"
            onClick={handleFetchDetails}
            disabled={isFetching || !term || !classNbr}
            className="w-full gap-2"
          >
            <Search className="h-4 w-4" />
            {isFetching ? 'Fetching...' : 'Fetch Class Details'}
          </Button>

          {/* Fetched Details (Read-only) */}
          {fetchedDetails && (
            <div className="space-y-3 p-4 rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Class Details:</p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400">Subject:</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{fetchedDetails.subject}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400">Catalog Number:</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{fetchedDetails.catalog_nbr}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400">Title:</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{fetchedDetails.title}</span>
                </div>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <Button type="submit" disabled={isSubmitting || !fetchedDetails} className="w-full">
            {isSubmitting ? 'Adding...' : 'Add Watch'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
