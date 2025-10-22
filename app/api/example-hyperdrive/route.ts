/**
 * Example API Route using Hyperdrive
 *
 * This demonstrates how to use Cloudflare Hyperdrive to query
 * your Supabase PostgreSQL database directly from a Worker.
 *
 * DELETE THIS FILE once you've implemented your actual cron job.
 */

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { queryHyperdrive } from '@/lib/db/hyperdrive';

// No need to set runtime = 'edge' - OpenNext deploys everything to Cloudflare Workers automatically
// With nodejs_compat flag enabled, pg works perfectly in Workers

export async function GET() {
  try {
    // Access Hyperdrive binding from Cloudflare context
    const { env } = getCloudflareContext();

    if (!env.HYPERDRIVE) {
      return Response.json(
        {
          error: 'Hyperdrive not configured',
          message: 'Make sure you have added the Hyperdrive binding to wrangler.jsonc',
        },
        { status: 500 }
      );
    }

    // Example query: Get current timestamp from database
    const result = await queryHyperdrive(
      env.HYPERDRIVE,
      'SELECT NOW() as current_time, version() as db_version'
    );

    return Response.json({
      success: true,
      data: result.rows[0],
      message: 'Successfully connected to database via Hyperdrive',
    });
  } catch (error) {
    console.error('Hyperdrive query error:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
