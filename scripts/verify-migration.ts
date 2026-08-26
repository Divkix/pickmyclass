#!/usr/bin/env tsx
/**
 * Migration verification script — row counts + checksums between Supabase source
 * and PlanetScale target.
 *
 * Usage:
 *   tsx scripts/verify-migration.ts \
 *     --source="postgres://...supabase..." \
 *     --target="postgres://...planetscale..."
 *
 * Exits 0 if all counts match, 1 otherwise.
 */

import postgres from 'postgres';

type SqlClient = postgres.Sql;

interface Args {
  source: string;
  target: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const source = args.find((a) => a.startsWith('--source='))?.split('=')[1];
  const target = args.find((a) => a.startsWith('--target='))?.split('=')[1];
  if (!source || !target) {
    console.error(
      'Usage: tsx scripts/verify-migration.ts --source=postgres://... --target=postgres://...'
    );
    process.exit(1);
  }
  return { source, target };
}

async function getRowCount(client: SqlClient, table: string): Promise<number> {
  const rows = await client.unsafe<Array<{ count: number }>>(
    `SELECT COUNT(*)::int AS count FROM ${table}`
  );
  return rows[0].count;
}

async function getChecksum(client: SqlClient, table: string, columns: string[]): Promise<string> {
  const colList = columns.join(', ');
  const rows = await client.unsafe<Array<{ checksum: string | null }>>(
    `SELECT md5(string_agg(md5(${colList}::text), '' ORDER BY ${colList})) AS checksum FROM ${table}`
  );
  return rows[0].checksum || 'empty';
}

const TABLES: Array<{ name: string; checksumColumns: string[] }> = [
  {
    name: 'class_states',
    checksumColumns: ['id', 'class_nbr', 'term', 'seats_available', 'instructor_name'],
  },
  { name: 'class_watches', checksumColumns: ['id', 'user_id', 'class_nbr', 'term'] },
  {
    name: 'notifications_sent',
    checksumColumns: ['id', 'class_watch_id', 'notification_type', 'is_active'],
  },
  {
    name: 'user_profiles',
    checksumColumns: ['user_id', 'is_admin', 'is_disabled', 'notifications_enabled'],
  },
  { name: 'failed_login_attempts', checksumColumns: ['email', 'attempts'] },
];

async function main() {
  const { source, target } = parseArgs();
  // Standalone Node tooling: raw postgres.js clients over the provided
  // connection strings — no Hyperdrive/env handle involved.
  const sourceClient = postgres(source);
  const targetClient = postgres(target);

  try {
    console.log('Verifying migration: Supabase → PlanetScale\n');
    console.log('Table                    | Source Count | Target Count | Match | Checksum Match');
    console.log('-------------------------|--------------|--------------|-------|---------------');

    let allMatch = true;

    for (const { name, checksumColumns } of TABLES) {
      const sourceCount = await getRowCount(sourceClient, name);
      const targetCount = await getRowCount(targetClient, name);
      const countMatch = sourceCount === targetCount;

      const sourceChecksum = await getChecksum(sourceClient, name, checksumColumns);
      const targetChecksum = await getChecksum(targetClient, name, checksumColumns);
      const checksumMatch = sourceChecksum === targetChecksum;

      if (!countMatch || !checksumMatch) allMatch = false;

      console.log(
        `${name.padEnd(24)}| ${String(sourceCount).padStart(12)} | ${String(targetCount).padStart(12)} | ${countMatch ? '  ✓   ' : '  ✗   '} | ${checksumMatch ? '    ✓    ' : '    ✗    '}`
      );

      if (!checksumMatch) {
        console.log(`  Source checksum: ${sourceChecksum}`);
        console.log(`  Target checksum: ${targetChecksum}`);
      }
    }

    // Verify sequences are advanced
    console.log('\nSequence check:');
    const seqRows = await targetClient.unsafe<
      Array<{ sequencename: string; last_value: number | bigint | null }>
    >(`
      SELECT sequencename, last_value FROM pg_sequences
      WHERE schemaname = 'public'
      ORDER BY sequencename
    `);
    for (const row of seqRows) {
      console.log(`  ${row.sequencename}: last_value = ${row.last_value}`);
    }

    console.log(`\n${allMatch ? '✅ All counts and checksums match!' : '❌ Mismatches detected!'}`);
    process.exit(allMatch ? 0 : 1);
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

main().catch((error) => {
  console.error('Verification failed:', error);
  process.exit(1);
});
