# Workers KV Setup Guide

This document explains how to set up Cloudflare Workers KV for the PickMyClass cron job.

## What is Workers KV?

Workers KV is Cloudflare's edge key-value storage that provides:
- **Fast reads** at the edge (10-50ms vs 100-200ms for PostgreSQL)
- **Global distribution** across Cloudflare's network
- **FREE tier**: 1GB storage, 100k reads/day, 1k writes/day

## Current Implementation

We use KV as a **cache layer** with PostgreSQL as the source of truth:

### 1. Class State Caching
- **Key format**: `class_state:{class_nbr}`
- **TTL**: 1 hour (matches cron frequency)
- **Purpose**: Cache current state of monitored class sections
- **Flow**:
  1. Read from KV first (fast)
  2. If miss, read from PostgreSQL and populate KV
  3. On update, write to both PostgreSQL + KV

### 2. Notification Deduplication
- **Key format**: `notif:{watch_id}:{type}`
- **TTL**: 24 hours
- **Purpose**: Track which notifications have been sent
- **Flow**:
  1. Check KV before sending email
  2. Record in both PostgreSQL + KV after sending

## Production Setup

### Step 1: Create KV Namespace

```bash
# Create production KV namespace
wrangler kv namespace create "KV"

# Create preview KV namespace (for testing)
wrangler kv namespace create "KV" --preview
```

You'll get output like:
```
🌀 Creating namespace with title "pickmyclass-KV"
✅ Success!
Add the following to your wrangler.jsonc:
{ binding = "KV", id = "abc123def456" }

🌀 Creating namespace with title "pickmyclass-KV_preview"
✅ Success!
Add the following to your wrangler.jsonc:
{ binding = "KV", preview_id = "xyz789abc123" }
```

### Step 2: Update wrangler.jsonc

Replace the placeholder IDs in `wrangler.jsonc`:

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "abc123def456",              // ← Replace with your production ID
      "preview_id": "xyz789abc123"       // ← Replace with your preview ID
    }
  ]
}
```

### Step 3: Deploy

```bash
bun run deploy
```

The cron job will now use KV for caching!

## Performance Gains

### Before KV
- **Class state reads**: ~100-200ms per query (Hyperdrive → PostgreSQL)
- **Notification checks**: ~100-200ms per query
- **Total DB queries per cron**: ~300 queries for 100 sections

### After KV
- **Class state reads**: ~10-50ms (edge KV)
- **Notification checks**: ~10-50ms (edge KV)
- **Total DB queries per cron**: ~30 queries (90% reduction)

**Expected speedup**: 5-10x faster cron execution

## Fallback Behavior

If KV is unavailable, the system gracefully falls back to PostgreSQL:

```typescript
// lib/cache/kv.ts handles fallback automatically
const state = await getClassState(kv, class_nbr)
// ↑ If kv is undefined, falls back to PostgreSQL
```

This ensures the system works even if:
- KV namespace is not configured
- KV is experiencing issues
- Running locally without KV

## Monitoring

Check KV usage in Cloudflare Dashboard:
1. Go to Workers & Pages → KV
2. Select your namespace
3. View metrics: reads, writes, storage

## Costs

| Tier | Storage | Reads/day | Writes/day | Cost |
|------|---------|-----------|------------|------|
| **Free** | 1GB | 100k | 1k | $0 |
| Paid | Unlimited | 10M+ | Unlimited | $0.50/GB + $0.50/M reads |

**Current usage** (estimated for 100 sections):
- Storage: ~1MB (well within free tier)
- Reads: ~7,200/day (24 crons × 300 reads)
- Writes: ~240/day (24 crons × 10 writes)

✅ **FREE tier is more than enough**

## Troubleshooting

### Issue: KV namespace not found
```
Error: KV namespace with id "abc123" not found
```

**Solution**: Update `wrangler.jsonc` with correct IDs from Step 1

### Issue: KV reads not working locally
```
[KV] KV namespace not available, falling back to PostgreSQL
```

**Solution**: This is expected in dev mode. Use `wrangler dev` for local KV testing:
```bash
# Instead of bun run dev
wrangler dev
```

## Next Steps: Phase 2 (Cloudflare Queues)

After KV is working, consider adding Queues for async email sending:
- Offload email sending to background queue
- Cron completes 10-50x faster
- Built-in retry logic

See `docs/QUEUES_SETUP.md` (coming soon)
