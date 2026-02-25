import { createClient } from '@supabase/supabase-js';

function mustGetEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main() {
  const supabaseUrl = mustGetEnv('NEXT_PUBLIC_SUPABASE_URL');
  const supabaseKey = mustGetEnv('SUPABASE_SERVICE_ROLE_KEY');
  const runId = mustGetEnv('DUMMY_RUN_ID');
  const pattern = `dummy_${runId}_%`;

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { count: beforeCount, error: beforeError } = await supabase
    .from('votes')
    .select('*', { count: 'exact', head: true })
    .ilike('guest_token', pattern);

  if (beforeError) {
    throw new Error(`count before failed: ${beforeError.message}`);
  }

  const safeBeforeCount = beforeCount ?? 0;
  console.log(
    `[rollback-dummy-votes] runId=${runId} matchPattern=${pattern} before=${safeBeforeCount}`,
  );

  if (safeBeforeCount === 0) {
    console.log('[rollback-dummy-votes] nothing to delete');
    return;
  }

  const { error: deleteError } = await supabase
    .from('votes')
    .delete()
    .ilike('guest_token', pattern);

  if (deleteError) {
    throw new Error(`delete failed: ${deleteError.message}`);
  }

  const { count: afterCount, error: afterError } = await supabase
    .from('votes')
    .select('*', { count: 'exact', head: true })
    .ilike('guest_token', pattern);

  if (afterError) {
    throw new Error(`count after failed: ${afterError.message}`);
  }

  const safeAfterCount = afterCount ?? 0;
  console.log(
    `[rollback-dummy-votes] completed runId=${runId} deleted=${safeBeforeCount - safeAfterCount} remaining=${safeAfterCount}`,
  );
}

main().catch((error) => {
  console.error('[rollback-dummy-votes] failed:', error);
  process.exit(1);
});
