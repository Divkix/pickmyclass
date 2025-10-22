/**
 * Hyperdrive Database Utility
 *
 * This module provides a connection to Supabase PostgreSQL via Cloudflare Hyperdrive.
 *
 * IMPORTANT:
 * - Use this for direct database queries in Cloudflare Workers (cron jobs, API routes)
 * - DO NOT use for Supabase Auth/Storage operations (use Supabase client instead)
 * - Hyperdrive provides connection pooling and lower latency from Workers
 */

import { Pool, PoolClient, QueryResult } from 'pg';

/**
 * Cloudflare Workers environment with Hyperdrive binding
 */
export interface HyperdriveEnv {
  HYPERDRIVE: Hyperdrive;
}

/**
 * Hyperdrive binding type (provided by Cloudflare)
 */
export interface Hyperdrive {
  connectionString: string;
}

/**
 * Create a connection pool to the database via Hyperdrive
 *
 * @param hyperdrive - The Hyperdrive binding from Workers environment
 * @returns PostgreSQL connection pool
 *
 * @example
 * ```typescript
 * // In a Cloudflare Worker API route
 * export async function GET(request: Request, { env }: { env: HyperdriveEnv }) {
 *   const pool = createHyperdrivePool(env.HYPERDRIVE);
 *   const result = await pool.query('SELECT * FROM users LIMIT 10');
 *   return Response.json(result.rows);
 * }
 * ```
 */
export function createHyperdrivePool(hyperdrive: Hyperdrive): Pool {
  return new Pool({
    connectionString: hyperdrive.connectionString,
    // Cloudflare Workers have a limit of 6 concurrent connections
    // Set max to 5 to leave room for other connections
    max: 5,
  });
}

/**
 * Execute a query using Hyperdrive
 *
 * @param hyperdrive - The Hyperdrive binding from Workers environment
 * @param text - SQL query text
 * @param params - Query parameters (optional)
 * @returns Query result
 *
 * @example
 * ```typescript
 * const result = await queryHyperdrive(
 *   env.HYPERDRIVE,
 *   'SELECT * FROM class_watches WHERE user_id = $1',
 *   [userId]
 * );
 * ```
 */
export async function queryHyperdrive(
  hyperdrive: Hyperdrive,
  text: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any[]
): Promise<QueryResult> {
  const pool = createHyperdrivePool(hyperdrive);
  try {
    return await pool.query(text, params);
  } finally {
    await pool.end();
  }
}

/**
 * Execute multiple queries in a transaction
 *
 * @param hyperdrive - The Hyperdrive binding from Workers environment
 * @param callback - Function that receives a client and executes queries
 * @returns Result from the callback
 *
 * @example
 * ```typescript
 * await transactionHyperdrive(env.HYPERDRIVE, async (client) => {
 *   await client.query('INSERT INTO class_watches ...');
 *   await client.query('UPDATE class_states ...');
 * });
 * ```
 */
export async function transactionHyperdrive<T>(
  hyperdrive: Hyperdrive,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = createHyperdrivePool(hyperdrive);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Type definitions for common database queries
 */

export interface ClassWatch {
  id: string;
  user_id: string;
  term: string;
  subject: string;
  catalog_nbr: string;
  class_nbr: string;
  created_at: Date;
}

export interface ClassState {
  id: string;
  term: string;
  subject: string;
  catalog_nbr: string;
  class_nbr: string;
  instructor_name: string;
  seats_available: number;
  seats_capacity: number;
  last_checked_at: Date;
  last_changed_at: Date;
}

export interface NotificationSent {
  id: string;
  class_watch_id: string;
  notification_type: 'seat_available' | 'instructor_assigned';
  sent_at: Date;
}
