# Supabase Auth Configuration Guide

This document provides step-by-step instructions for configuring Supabase Auth security features for PickMyClass.

## Table of Contents

- [Email Verification Setup](#email-verification-setup)
- [Session Timeout Configuration](#session-timeout-configuration)
- [Rate Limiting (Built-in vs Custom)](#rate-limiting-built-in-vs-custom)
- [Additional Security Settings](#additional-security-settings)

---

## Email Verification Setup

**Purpose**: Require users to verify their email address before they can add class watches.

### Steps:

1. **Access Supabase Dashboard**
   - Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
   - Select your PickMyClass project

2. **Navigate to Authentication Settings**
   - Click on "Authentication" in the left sidebar
   - Click on "Providers" tab

3. **Configure Email Provider**
   - Find "Email" in the providers list
   - Click to expand settings
   - Toggle **"Confirm email"** to **ON**
   - Click **"Save"**

4. **Email Template Customization (Optional)**
   - Go to "Authentication" → "Email Templates"
   - Customize the "Confirm signup" email template
   - Variables available:
     - `{{ .ConfirmationURL }}` - The verification link
     - `{{ .Token }}` - The verification token
     - `{{ .SiteURL }}` - Your site URL

### Behavior After Configuration:

- New signups receive a verification email
- Users cannot access `/dashboard` or `/api/class-watches` until verified
- Unverified users are redirected to `/verify-email` page
- Verification link format: `https://your-site.com/auth/confirm?token=...`

### Testing:

```bash
# 1. Register a new account at /register
# 2. Check email inbox for verification link
# 3. Click verification link
# 4. Should redirect to /dashboard after verification
```

---

## Session Timeout Configuration

**Purpose**: Set reasonable session lifetimes to balance security and user experience.

### Recommended Settings:

- **JWT Expiry**: 7 days (604,800 seconds)
- **Refresh Token Lifetime**: 30 days
- **Refresh Token Reuse Interval**: 10 seconds

### Steps:

1. **Access Supabase Dashboard**
   - Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
   - Select your PickMyClass project

2. **Navigate to Security Settings**
   - Click on "Authentication" in the left sidebar
   - Click on "Settings" tab
   - Scroll to "Security and Protection" section

3. **Configure JWT Expiry**
   - Find **"JWT expiry limit"**
   - Set to **604800** (7 days in seconds)
   - This controls how long access tokens are valid

4. **Configure Refresh Token Settings**
   - Find **"Refresh token reuse interval"**
   - Set to **10** seconds
   - This prevents refresh token reuse attacks

5. **Additional Session Settings**
   - **"Refresh token rotation"**: Keep **enabled** (default)
   - **"Secure refresh token cookie"**: Keep **enabled** for production

6. **Save Changes**
   - Click **"Save"** at the bottom of the page

### Session Flow:

```
User Login
  ↓
JWT issued (valid 7 days)
  ↓
Access protected resources
  ↓
JWT expires after 7 days
  ↓
Refresh token used (valid 30 days)
  ↓
New JWT issued
  ↓
Refresh token rotated (old one invalidated)
```

### Testing Session Expiry:

```typescript
// Manually expire session for testing
const supabase = createClient()
await supabase.auth.signOut()

// Check session status
const { data: { session } } = await supabase.auth.getSession()
console.log('Session expires at:', session?.expires_at)
```

---

## Rate Limiting (Built-in vs Custom)

### Supabase Built-in Rate Limiting

**Status**: Supabase provides rate limiting at the API level, but **NOT** for authentication attempts specifically.

**What Supabase Provides**:
- API request rate limiting (per IP)
- Default limits vary by plan:
  - **Free tier**: 200 requests/second
  - **Pro tier**: 500 requests/second
  - **Enterprise**: Custom limits

**What Supabase DOES NOT Provide**:
- Per-email failed login attempt tracking
- Account lockout after X failed attempts
- Granular control over auth-specific rate limits

### Custom Implementation: Failed Login Tracking

Since Supabase doesn't provide account-level lockout, we implemented a custom solution:

**Implementation Details**:
- **Table**: `failed_login_attempts`
- **Lockout Threshold**: 5 failed attempts
- **Lockout Duration**: 15 minutes
- **Tracking**: Per email address (case-insensitive)

**Database Schema**:
```sql
CREATE TABLE failed_login_attempts (
  email TEXT PRIMARY KEY,
  attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Features**:
- Increments counter on failed login
- Locks account for 15 minutes after 5 failures
- Clears counter on successful login
- Auto-expires lockout after duration
- Shows remaining attempts to user (last 3 attempts)

**API Endpoints**:
- `POST /api/auth/check-lockout` - Check if email is locked
- `POST /api/auth/increment-failed-attempts` - Increment failure counter
- `POST /api/auth/clear-failed-attempts` - Clear counter on success

**User Experience**:
```
Attempt 1-2: "Invalid login credentials"
Attempt 3-5: "Invalid login credentials (2 attempts remaining)"
Attempt 6+:  "Account locked for 15 minutes"
```

### Why Custom Implementation?

1. **Supabase Limitations**: No native account lockout feature
2. **Security Best Practice**: Prevent brute force attacks
3. **User Feedback**: Show remaining attempts for transparency
4. **Compliance**: Meet security requirements for production apps

---

## Additional Security Settings

### Enable Two-Factor Authentication (Future Enhancement)

Supabase supports TOTP (Time-based One-Time Password) MFA:

1. Go to "Authentication" → "Settings"
2. Find "Multi-Factor Authentication (MFA)"
3. Enable **"Phone Auth"** or **"TOTP"**
4. Users can enable MFA in their account settings

### Password Requirements

**Current Settings** (enforced client-side):
- Minimum 8 characters
- Password strength score ≥ 3/4 (zxcvbn)
- No dictionary words or common patterns

**Supabase Password Policy**:
1. Go to "Authentication" → "Settings"
2. Find "Password Policy"
3. Configure:
   - **Minimum length**: 8 characters (default)
   - **Require uppercase**: Optional
   - **Require lowercase**: Optional
   - **Require numbers**: Optional
   - **Require symbols**: Optional

**Note**: We use client-side zxcvbn validation for better UX.

### Email Allowlist/Blocklist

Restrict signups to specific email domains:

1. Go to "Authentication" → "Settings"
2. Find "Email Allowlist" or "Email Blocklist"
3. Add domains (e.g., `@asu.edu` for university-only access)

### OAuth Configuration

**Currently Enabled**: Google OAuth

**Settings**:
1. Go to "Authentication" → "Providers"
2. Click on "Google"
3. Configure:
   - **Client ID**: From Google Cloud Console
   - **Client Secret**: From Google Cloud Console
   - **Redirect URL**: `https://your-project.supabase.co/auth/v1/callback`
   - **Scopes**: `email`, `profile` (default)

### Site URL Configuration

**Important**: Set your production URL to prevent redirect attacks.

1. Go to "Authentication" → "Settings"
2. Find "Site URL"
3. Set to your production domain (e.g., `https://pickmyclass.app`)
4. Add additional redirect URLs if needed

### Email Rate Limiting

Supabase has built-in email rate limiting:

- **Verification emails**: 1 per hour per email
- **Password reset**: 1 per hour per email
- **Magic links**: 1 per hour per email

**Override** (if needed):
- Contact Supabase support to adjust limits
- Use custom SMTP provider for higher limits

---

## Environment Variables Checklist

Ensure these are set in your deployment:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Email (Resend)
RESEND_API_KEY=re_xxx
NOTIFICATION_FROM_EMAIL=notifications@yourdomain.com

# Scraper (if applicable)
SCRAPER_URL=https://scraper.yourdomain.com
SCRAPER_SECRET_TOKEN=your-secret-token
```

---

## Testing Checklist

- [ ] Email verification email sent on signup
- [ ] Unverified users redirected to `/verify-email`
- [ ] Verification link confirms email
- [ ] Verified users can access `/dashboard`
- [ ] Failed login increments attempt counter
- [ ] 5 failed attempts locks account for 15 minutes
- [ ] Successful login clears attempt counter
- [ ] Session expires after 7 days
- [ ] Refresh token rotates properly
- [ ] Google OAuth works end-to-end

---

## Troubleshooting

### Email Verification Not Sending

1. Check "Authentication" → "Email Templates" for errors
2. Verify SMTP settings in "Project Settings" → "Email"
3. Check spam folder
4. Test with different email provider (Gmail, Outlook)

### Session Not Persisting

1. Check cookies are enabled in browser
2. Verify `NEXT_PUBLIC_SUPABASE_URL` is correct
3. Check browser console for CORS errors
4. Ensure `createServerClient` is used on server routes

### Failed Login Counter Not Resetting

1. Check `SUPABASE_SERVICE_ROLE_KEY` is set
2. Verify migration ran: `bunx supabase db push`
3. Check API routes are deployed: `/api/auth/*`
4. Test lockout functions directly in Supabase SQL editor

---

## Summary

**Implemented Security Features**:
- ✅ Email verification required on signup
- ✅ Session timeout: 7-day JWT, 30-day refresh token
- ✅ Custom failed login tracking (5 attempts = 15-min lockout)
- ✅ Password strength enforcement (zxcvbn score ≥ 3)
- ✅ Google OAuth integration
- ✅ Security headers (CSP, X-Frame-Options, etc.)
- ✅ Account soft-delete/disable functionality

**Configuration Time**: ~10 minutes

**Maintenance**: Minimal - Supabase handles token rotation, email delivery, and session management automatically.
