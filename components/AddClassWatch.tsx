'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Button } from './ui/button'
import { Alert } from './ui/alert'

interface AddClassWatchProps {
  onAdd: (watch: { term: string; subject: string; catalog_nbr: string; class_nbr: string }) => Promise<void>
}

export function AddClassWatch({ onAdd }: AddClassWatchProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    term: '',
    subject: '',
    catalog_nbr: '',
    class_nbr: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await onAdd(formData)
      // Reset form on success
      setFormData({ term: '', subject: '', catalog_nbr: '', class_nbr: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add class watch')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleChange = (field: keyof typeof formData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }))
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="section_number">Section Number *</Label>
              <Input
                id="section_number"
                placeholder="12431"
                value={formData.class_nbr}
                onChange={handleChange('class_nbr')}
                required
                maxLength={5}
                pattern="\d{5}"
                title="Must be a 5-digit section number"
              />
              <p className="text-xs text-zinc-600 dark:text-zinc-400">5-digit section number</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="term">Term *</Label>
              <Input
                id="term"
                placeholder="2261"
                value={formData.term}
                onChange={handleChange('term')}
                required
                maxLength={4}
                pattern="\d{4}"
                title="Must be a 4-digit term code"
              />
              <p className="text-xs text-zinc-600 dark:text-zinc-400">4-digit term code (e.g., 2261)</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="subject">Subject *</Label>
              <Input
                id="subject"
                placeholder="CSE"
                value={formData.subject}
                onChange={handleChange('subject')}
                required
                maxLength={10}
              />
              <p className="text-xs text-zinc-600 dark:text-zinc-400">e.g., CSE, MAT, ENG</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="catalog_nbr">Catalog Number *</Label>
              <Input
                id="catalog_nbr"
                placeholder="240"
                value={formData.catalog_nbr}
                onChange={handleChange('catalog_nbr')}
                required
                maxLength={10}
              />
              <p className="text-xs text-zinc-600 dark:text-zinc-400">Course number (e.g., 240)</p>
            </div>
          </div>

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Adding...' : 'Add Watch'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
