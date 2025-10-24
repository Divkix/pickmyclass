# PickMyClass Deployment Checklist

Use this checklist to deploy PickMyClass to production.

---

## ✅ Pre-Deployment Setup (30 minutes)

### 1. Generate Secrets (5 minutes)

```bash
# Generate CRON_SECRET
openssl rand -hex 32

# Note: Save this output somewhere secure!
```

### 2. Sentry Setup (3 minutes)

- [ ] Go to https://sentry.io/signup/
- [ ] Create account (free tier: 5,000 errors/month)
- [ ] Create new project → Select "Next.js"
- [ ] Copy DSN (looks like `https://abc123@o123.ingest.sentry.io/456`)
- [ ] Save for later: `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`

### 3. Resend Setup (10 minutes)

#### 3a. Create Account & Get API Key
- [ ] Sign up at https://resend.com (free tier: 100 emails/day)
- [ ] Verify your email
- [ ] Go to [API Keys](https://resend.com/api-keys)
- [ ] Create API key named "PickMyClass Production"
- [ ] Copy key → Save as `RESEND_API_KEY`

#### 3b. Domain Verification (Choose One)

**Development (Quick Start)**
- [ ] Use `onboarding@resend.dev` as sender
- [ ] Set `NOTIFICATION_FROM_EMAIL=onboarding@resend.dev`
- [ ] Skip to webhook setup

**Production (Recommended)**
- [ ] Go to [Domains](https://resend.com/domains)
- [ ] Click "Add Domain" → Enter your domain
- [ ] Add DNS records to your domain provider:
  - [ ] MX record
  - [ ] TXT record (SPF)
  - [ ] CNAME record (DKIM)
- [ ] Wait for verification (~5 minutes)
- [ ] Set `NOTIFICATION_FROM_EMAIL=notifications@yourdomain.com`

#### 3c. Webhook Configuration
- [ ] Go to [Webhooks](https://resend.com/webhooks)
- [ ] Click "Add Webhook"
- [ ] Set endpoint: `https://yourdomain.com/api/webhooks/resend`
- [ ] Subscribe to events:
  - [x] `email.bounced`
  - [x] `email.complained`
  - [x] `email.delivered` (optional)
- [ ] Click "Create Webhook"
- [ ] Copy signing secret (starts with `whsec_...`)
- [ ] Save as `RESEND_WEBHOOK_SECRET`

### 4. Supabase Configuration (5 minutes)

#### 4a. Enable Email Verification
- [ ] Go to Supabase Dashboard → Your Project
- [ ] Navigate: Authentication → Providers → Email
- [ ] Toggle "Confirm email" to **ON**
- [ ] Click Save

#### 4b. Configure Session Timeout
- [ ] Navigate: Authentication → Settings → Security and Protection
- [ ] Set "JWT expiry limit" to `604800` (7 days)
- [ ] Set "Refresh token reuse interval" to `10`
- [ ] Ensure "Secure refresh token cookie" is enabled
- [ ] Click Save

---

## 🚀 Deployment to Cloudflare Workers (15 minutes)

### 5. Push Code to GitHub

```bash
git push origin main
```

### 6. Authenticate with Cloudflare

```bash
wrangler login
```

### 7. Set Environment Variables in Cloudflare

**Method 1: Dashboard (Recommended)**

Go to Workers & Pages → Your Worker → Settings → Variables

Add these as **encrypted secrets**:

```
NEXT_PUBLIC_SUPABASE_URL=<from Supabase dashboard>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from Supabase dashboard>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard>
SCRAPER_URL=https://scraper.yourdomain.com
SCRAPER_SECRET_TOKEN=<from scraper .env>
RESEND_API_KEY=<from step 3a>
RESEND_WEBHOOK_SECRET=<from step 3c>
CRON_SECRET=<from step 1>
SENTRY_DSN=<from step 2>
NEXT_PUBLIC_SENTRY_DSN=<from step 2>
```

**Method 2: CLI (Alternative)**

```bash
wrangler secret put NEXT_PUBLIC_SUPABASE_URL
wrangler secret put NEXT_PUBLIC_SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SCRAPER_URL
wrangler secret put SCRAPER_SECRET_TOKEN
wrangler secret put RESEND_API_KEY
wrangler secret put RESEND_WEBHOOK_SECRET
wrangler secret put CRON_SECRET
wrangler secret put SENTRY_DSN
wrangler secret put NEXT_PUBLIC_SENTRY_DSN
```

**Checklist:**
- [ ] NEXT_PUBLIC_SUPABASE_URL
- [ ] NEXT_PUBLIC_SUPABASE_ANON_KEY
- [ ] SUPABASE_SERVICE_ROLE_KEY
- [ ] SCRAPER_URL
- [ ] SCRAPER_SECRET_TOKEN
- [ ] RESEND_API_KEY
- [ ] RESEND_WEBHOOK_SECRET
- [ ] CRON_SECRET
- [ ] SENTRY_DSN
- [ ] NEXT_PUBLIC_SENTRY_DSN

### 8. Update wrangler.jsonc

Edit the `vars` section with your production values:

```jsonc
"vars": {
  "MAX_WATCHES_PER_USER": "10",
  "SCRAPER_BATCH_SIZE": "3",
  "NOTIFICATION_FROM_EMAIL": "notifications@yourdomain.com", // Or onboarding@resend.dev
  "NEXT_PUBLIC_SITE_URL": "https://yourdomain.com"
}
```

### 9. Deploy

```bash
bun run deploy
```

Your app will be live at: `https://pickmyclass.workers.dev` (or your custom domain)

---

## 🧪 Post-Deployment Testing (10 minutes)

### Test 1: Registration & Email Verification
- [ ] Register new account at `/register`
- [ ] Check email for verification link
- [ ] Try accessing `/dashboard` (should redirect to `/verify-email`)
- [ ] Click verification link
- [ ] Access `/dashboard` (should work now)

### Test 2: Add Class Watch
- [ ] Add a class watch with valid section number
- [ ] Verify watch appears in dashboard
- [ ] Check Supabase database for new row

### Test 3: Rate Limiting
```bash
# Run from terminal
for i in {1..65}; do curl https://yourdomain.com/api/class-watches -H "Authorization: Bearer <token>"; done
```
- [ ] After 60 requests, should get 429 status

### Test 4: Max Watches Limit
- [ ] Add 10 class watches via dashboard
- [ ] Try adding 11th watch
- [ ] Should see "Maximum watches limit reached (10)" error

### Test 5: Failed Login Lockout
- [ ] Try logging in with wrong password 5 times
- [ ] Should see "Account locked for 15 minutes" message

### Test 6: Unsubscribe Link
- [ ] Wait for a notification email (or trigger manually)
- [ ] Click "Unsubscribe" link at bottom of email
- [ ] Verify notifications are disabled in settings

### Test 7: Sentry Error Tracking
- [ ] Trigger an intentional error (e.g., invalid API request)
- [ ] Check Sentry dashboard for captured error
- [ ] Verify user context is attached

### Test 8: Cron Job
- [ ] Wait for next :00 or :30 minute mark
- [ ] Check Cloudflare Workers logs for cron execution
- [ ] Verify no errors in Sentry
- [ ] Check Supabase for updated `last_checked_at` timestamps

---

## 📊 Monitoring Setup (5 minutes)

### Sentry Alerts
- [ ] Go to Sentry → Alerts → Create Alert
- [ ] Set up alert for:
  - Error rate > 10 errors/hour
  - Cron job failures (tag: `component:cron-job`)
- [ ] Configure notification channel (email/Slack/Discord)

### Resend Monitoring
- [ ] Check [Resend Dashboard](https://resend.com/emails) daily for first week
- [ ] Monitor:
  - Delivery rate (target: >95%)
  - Bounce rate (target: <5%)
  - Spam complaints (target: <0.1%)

### Cloudflare Logs
- [ ] Go to Workers & Pages → Your Worker → Logs
- [ ] Enable "Tail" to see live logs
- [ ] Check for any errors or warnings

---

## 🎯 Production Readiness Checklist

### Security
- [x] Rate limiting enabled (60 GET, 10 POST/min)
- [x] Max watches limit (10 per user)
- [x] Email verification required
- [x] Account lockout after 5 failed attempts
- [x] Password strength enforcement (score 3/4)
- [x] CRON_SECRET authentication
- [x] Security headers (CSP, X-Frame-Options, etc.)
- [x] XSS prevention in emails (DOMPurify)
- [x] SQL injection audit passed
- [x] Zod input validation on all routes

### Email Compliance
- [x] Unsubscribe link in all emails
- [x] List-Unsubscribe header (RFC 2369)
- [x] Bounce handling webhook
- [x] Spam complaint handling webhook
- [ ] Domain verified in Resend (or using test domain)

### Monitoring
- [x] Sentry error tracking
- [x] Cron job failure alerting
- [ ] Sentry alerts configured
- [x] Cloudflare observability enabled

### Configuration
- [ ] All environment variables set in Cloudflare
- [ ] Email verification enabled in Supabase
- [ ] Session timeout configured (7 days JWT)
- [ ] Resend webhooks configured
- [ ] Sentry DSN set

### Testing
- [ ] Registration flow tested
- [ ] Email notifications working
- [ ] Unsubscribe link tested
- [ ] Rate limiting verified
- [ ] Max watches limit verified
- [ ] Failed login lockout tested
- [ ] Cron job running successfully

---

## 🆘 Troubleshooting

### "CRON_SECRET not set" Error
→ Add `CRON_SECRET` as encrypted secret in Cloudflare Dashboard

### Email Verification Not Working
→ Check Supabase Auth settings: Authentication → Providers → Email → "Confirm email" enabled

### Webhooks Failing (401 Unauthorized)
→ Verify `RESEND_WEBHOOK_SECRET` matches the signing secret in Resend dashboard

### Rate Limiting Too Strict
→ Adjust limits in `lib/rate-limit.ts` and redeploy

### High Bounce Rate
→ Check email addresses are valid, consider implementing email validation library

### Cron Job Not Running
→ Check Cloudflare Workers logs, verify `triggers.crons` in `wrangler.jsonc`

---

## 📈 Post-Launch Monitoring (First Week)

### Daily Tasks
- [ ] Check Sentry for new errors
- [ ] Monitor Resend delivery/bounce rates
- [ ] Review Cloudflare Workers metrics
- [ ] Check database growth (class_watches, class_states tables)

### Weekly Tasks
- [ ] Review user feedback/support requests
- [ ] Analyze cron job performance (Sentry traces)
- [ ] Check email open rates (if tracking enabled)
- [ ] Monitor database size and query performance

---

## 🎉 You're Ready to Launch!

Once all items are checked, you're production-ready with enterprise-grade security and monitoring.

**Estimated Total Time:** ~60 minutes

**Support:**
- Check Sentry for real-time error alerts
- Review Cloudflare logs for Worker issues
- Monitor Resend for email deliverability

Good luck! 🚀
