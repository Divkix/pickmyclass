import { describe, it, expect } from 'vitest'
import {
  SeatAvailableEmailTemplate,
  InstructorAssignedEmailTemplate,
} from '@/lib/email/templates'
import type { ClassInfo } from '@/lib/email/resend'

describe('Email Templates', () => {
  const mockClassInfo: ClassInfo = {
    class_nbr: '12431',
    term: '2261',
    subject: 'CSE',
    catalog_nbr: '110',
    title: 'Principles of Programming',
    instructor_name: 'John Smith',
    seats_available: 5,
    seats_capacity: 150,
    location: 'BYENG M1-14',
    meeting_times: 'MW 10:30 AM - 11:45 AM',
  }

  describe('SeatAvailableEmailTemplate', () => {
    it('should generate valid HTML email', () => {
      const html = SeatAvailableEmailTemplate(mockClassInfo)

      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('<html>')
      expect(html).toContain('</html>')
    })

    it('should include class information', () => {
      const html = SeatAvailableEmailTemplate(mockClassInfo)

      expect(html).toContain('CSE 110')
      expect(html).toContain('Principles of Programming')
      expect(html).toContain('Section 12431')
      expect(html).toContain('John Smith')
      expect(html).toContain('BYENG M1-14')
      expect(html).toContain('MW 10:30 AM - 11:45 AM')
    })

    it('should include seats available information', () => {
      const html = SeatAvailableEmailTemplate(mockClassInfo)

      expect(html).toContain('5')
      expect(html).toContain('150')
    })

    it('should include ASU catalog link', () => {
      const html = SeatAvailableEmailTemplate(mockClassInfo)

      expect(html).toContain('https://catalog.apps.asu.edu/catalog/classes/classlist')
      expect(html).toContain('keywords=12431')
      expect(html).toContain('term=2261')
    })

    it('should sanitize XSS in class title', () => {
      const xssClassInfo = {
        ...mockClassInfo,
        title: '<script>alert("xss")</script>',
      }

      const html = SeatAvailableEmailTemplate(xssClassInfo)

      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
      expect(html).toContain('alert(&quot;xss&quot;)')
    })

    it('should sanitize XSS in instructor name', () => {
      const xssClassInfo = {
        ...mockClassInfo,
        instructor_name: '<img src=x onerror=alert(1)>',
      }

      const html = SeatAvailableEmailTemplate(xssClassInfo)

      expect(html).not.toContain('<img')
      expect(html).toContain('&lt;img')
    })

    it('should sanitize XSS in location', () => {
      const xssClassInfo = {
        ...mockClassInfo,
        location: '"><script>alert("xss")</script>',
      }

      const html = SeatAvailableEmailTemplate(xssClassInfo)

      expect(html).not.toContain('<script>')
      expect(html).toContain('&quot;&gt;&lt;script&gt;')
    })

    it('should validate term format for URL', () => {
      const invalidTermInfo = {
        ...mockClassInfo,
        term: '2261<script>',
      }

      const html = SeatAvailableEmailTemplate(invalidTermInfo)

      // Should strip non-numeric characters
      expect(html).toContain('term=2261')
      expect(html).not.toContain('<script>')
    })

    it('should validate class_nbr format for URL', () => {
      const invalidClassNbrInfo = {
        ...mockClassInfo,
        class_nbr: '12431<script>',
      }

      const html = SeatAvailableEmailTemplate(invalidClassNbrInfo)

      // Should strip non-numeric characters
      expect(html).toContain('keywords=12431')
      expect(html).not.toContain('<script>')
    })

    it('should handle missing location gracefully', () => {
      const noLocationInfo = {
        ...mockClassInfo,
        location: null,
      }

      const html = SeatAvailableEmailTemplate(noLocationInfo)

      expect(html).toContain('CSE 110')
      // Should not crash or show "null"
      expect(html).not.toContain('null')
    })

    it('should handle missing meeting times gracefully', () => {
      const noTimesInfo = {
        ...mockClassInfo,
        meeting_times: null,
      }

      const html = SeatAvailableEmailTemplate(noTimesInfo)

      expect(html).toContain('CSE 110')
      expect(html).not.toContain('null')
    })

    it('should include unsubscribe link when provided', () => {
      const unsubscribeUrl = 'https://pickmyclass.app/unsubscribe?token=abc123'
      const html = SeatAvailableEmailTemplate(mockClassInfo, unsubscribeUrl)

      expect(html).toContain('Unsubscribe')
      expect(html).toContain(unsubscribeUrl)
    })

    it('should sanitize unsubscribe URL', () => {
      const xssUnsubscribeUrl = 'https://pickmyclass.app/unsubscribe?token="><script>alert(1)</script>'
      const html = SeatAvailableEmailTemplate(mockClassInfo, xssUnsubscribeUrl)

      expect(html).not.toContain('<script>')
      expect(html).toContain('&quot;&gt;&lt;script&gt;')
    })

    it('should not include unsubscribe link when not provided', () => {
      const html = SeatAvailableEmailTemplate(mockClassInfo)

      expect(html).not.toContain('Unsubscribe')
    })
  })

  describe('InstructorAssignedEmailTemplate', () => {
    const staffClassInfo = {
      ...mockClassInfo,
      instructor_name: 'Staff',
    }

    const instructorInfo = {
      previous_instructor: 'Staff',
      new_instructor: 'Jane Doe',
    }

    it('should generate valid HTML email', () => {
      const html = InstructorAssignedEmailTemplate(staffClassInfo, instructorInfo)

      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('<html>')
      expect(html).toContain('</html>')
    })

    it('should include class information', () => {
      const html = InstructorAssignedEmailTemplate(staffClassInfo, instructorInfo)

      expect(html).toContain('CSE 110')
      expect(html).toContain('Principles of Programming')
      expect(html).toContain('Section 12431')
    })

    it('should show instructor change', () => {
      const html = InstructorAssignedEmailTemplate(staffClassInfo, instructorInfo)

      expect(html).toContain('Staff')
      expect(html).toContain('Jane Doe')
    })

    it('should include ASU catalog link', () => {
      const html = InstructorAssignedEmailTemplate(staffClassInfo, instructorInfo)

      expect(html).toContain('https://catalog.apps.asu.edu/catalog/classes/classlist')
      expect(html).toContain('keywords=12431')
      expect(html).toContain('term=2261')
    })

    it('should sanitize XSS in instructor names', () => {
      const xssInstructorInfo = {
        previous_instructor: '<script>alert(1)</script>',
        new_instructor: '<img src=x onerror=alert(1)>',
      }

      const html = InstructorAssignedEmailTemplate(staffClassInfo, xssInstructorInfo)

      expect(html).not.toContain('<script>')
      expect(html).not.toContain('<img')
      expect(html).toContain('&lt;script&gt;')
      expect(html).toContain('&lt;img')
    })

    it('should include unsubscribe link when provided', () => {
      const unsubscribeUrl = 'https://pickmyclass.app/unsubscribe?token=xyz789'
      const html = InstructorAssignedEmailTemplate(staffClassInfo, instructorInfo, unsubscribeUrl)

      expect(html).toContain('Unsubscribe')
      expect(html).toContain(unsubscribeUrl)
    })
  })

  describe('Email accessibility and formatting', () => {
    it('should have proper viewport meta tag', () => {
      const html = SeatAvailableEmailTemplate(mockClassInfo)

      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">')
    })

    it('should have UTF-8 charset', () => {
      const html = SeatAvailableEmailTemplate(mockClassInfo)

      expect(html).toContain('<meta charset="utf-8">')
    })

    it('should have descriptive title', () => {
      const html = SeatAvailableEmailTemplate(mockClassInfo)

      expect(html).toContain('<title>Seat Available - CSE 110</title>')
    })

    it('should use inline styles for email client compatibility', () => {
      const html = SeatAvailableEmailTemplate(mockClassInfo)

      // Should have inline styles, not <style> tags
      expect(html).toContain('style="')
      expect(html).not.toContain('<style>')
    })
  })
})
