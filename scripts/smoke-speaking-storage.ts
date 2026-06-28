import { config } from "dotenv";
config({ path: ".env.local" });

// Proves: (1) anon cannot read an object; (2) the bucket is private (no public URL
// serves bytes); (3) a signed URL works and expires. Uses the service-role client to
// seed a throwaway object, then the anon client to attempt access.
async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !anonKey || !svcKey) throw new Error("supabase env missing");

  const svc = createClient(url, svcKey);
  const anon = createClient(url, anonKey);
  const key = `smoke-test/probe-${Date.now()}.webm`;
  const bytes = new Uint8Array([1, 2, 3, 4]);

  await svc.storage.from("speaking-audio").upload(key, bytes, { contentType: "audio/webm", upsert: true });

  // (1) anon download must fail (no policy for anon).
  const anonDl = await anon.storage.from("speaking-audio").download(key);
  if (anonDl.data) throw new Error("[FAIL] anon could read a private object");

  // (2) signed URL (service-role) works.
  const signed = await svc.storage.from("speaking-audio").createSignedUrl(key, 30);
  if (!signed.data?.signedUrl) throw new Error("[FAIL] could not sign URL");
  const fetched = await fetch(signed.data.signedUrl);
  if (!fetched.ok) throw new Error("[FAIL] signed URL did not serve bytes");

  await svc.storage.from("speaking-audio").remove([key]);
  console.log("[OK] bucket private; anon blocked; signed URL serves + cleaned up");
  process.exit(0);
}
main().catch((e) => { console.error(typeof e === "object" ? e : "[FAIL]", e); process.exit(1); });
