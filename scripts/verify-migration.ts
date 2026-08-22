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

import pg from 'pg';

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

async function getRowCount(client: pg.Client, table: string): Promise<number> {
  const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return result.rows[0].count;
}

async function getChecksum(client: pg.Client, table: string, columns: string[]): Promise<string> {
  const colList = columns.join(', ');
  const result = await client.query(
    `SELECT md5(string_agg(md5(${colList}::text), '' ORDER BY ${colList})) AS checksum FROM ${table}`
  );
  return result.rows[0].checksum || 'empty';
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
  const sourceClient = new pg.Client({ connectionString: source });
  const targetClient = new pg.Client({ connectionString: target });

  try {
    await sourceClient.connect();
    await targetClient.connect();

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
    const seqResult = await targetClient.query(`
      SELECT sequencename, last_value FROM pg_sequences
      WHERE schemaname = 'public'
      ORDER BY sequencename
    `);
    for (const row of seqResult.rows) {
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
