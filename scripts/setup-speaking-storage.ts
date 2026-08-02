import { config } from "dotenv";
config({ path: ".env.local" });

// Idempotent: private `speaking-audio` bucket + owner-scoped `storage.objects` policy.
// Storage lives in Supabase's `storage` schema (NOT emulated by local docker) — so this
// runs against REAL Supabase via DIRECT_URL, NOT the Postgres verify gate. Uses the
// project's driver (postgres.js — see scripts/migrate.ts); node-postgres/`pg` is not a dep.
async function main() {
  const postgres = (await import("postgres")).default;
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL missing");
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  try {
    // Private bucket, 10 MB cap, only the two formats MediaRecorder emits.
    await sql.unsafe(`
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('speaking-audio', 'speaking-audio', false, 10485760,
              array['audio/webm','audio/mp4'])
      on conflict (id) do update
        set public = false, file_size_limit = 10485760,
            allowed_mime_types = array['audio/webm','audio/mp4'];
    `);

    // Owner-scoped: a user may read/write ONLY objects under their own uid folder
    // (path = `${uid}/...`). evaluate downloads via the service-role client (bypasses
    // RLS). anon has no policy → no access.
    await sql.unsafe(`drop policy if exists speaking_audio_owner_all on storage.objects;`);
    await sql.unsafe(`
      create policy speaking_audio_owner_all on storage.objects
        for all to authenticated
        using (bucket_id = 'speaking-audio'
               and (storage.foldername(name))[1] = auth.uid()::text)
        with check (bucket_id = 'speaking-audio'
               and (storage.foldername(name))[1] = auth.uid()::text);
    `);

    console.log("[OK] speaking-audio bucket + owner policy set");
  } finally {
    await sql.end();
  }
  process.exit(0);
}
main().catch((e) => { console.error("[FAIL]", e); process.exit(1); });
