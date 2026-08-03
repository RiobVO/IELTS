/**
 * Supabase Storage for Speaking audio. SERVER-ONLY (service-role client, bypasses
 * RLS). Bucket `speaking-audio` is PRIVATE (voice = biometrics): the owner-scoped
 * storage policy (scripts/setup-speaking-storage.ts) is the access barrier; downloads
 * here use service-role. Path convention: `${userId}/${submissionId}.${ext}`.
 */
import { createServiceClient } from "@/lib/supabase/service";

export const SPEAKING_BUCKET = "speaking-audio";

/** Signed PUT so the browser uploads directly to the private bucket (short TTL). */
export async function signedUploadUrl(path: string): Promise<{ url: string; token: string }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(SPEAKING_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("could not sign upload URL");
  return { url: data.signedUrl, token: data.token };
}

/**
 * Short-lived signed GET URL so the OWNER can replay their take on the result page
 * (the bucket is private; the result read is already owner-scoped). Returns null if
 * the object is gone (retention-reaped) so the caller simply renders no player —
 * never a 500. Default TTL 1h covers a result session; a reload re-signs.
 */
export async function signedPlaybackUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(SPEAKING_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Real object size (bytes) — the cost-guard truth, not the client's claim. */
export async function audioSize(path: string): Promise<number | null> {
  const supabase = createServiceClient();
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await supabase.storage.from(SPEAKING_BUCKET).list(folder, { search: name });
  if (error) throw error;
  const meta = data?.find((o) => o.name === name);
  return (meta?.metadata?.size as number | undefined) ?? null;
}

/** Download owner-path (service-role) → base64 + MIME for the Gemini inline part. */
export async function downloadAudio(path: string): Promise<{ data: string; mimeType: string }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(SPEAKING_BUCKET).download(path);
  if (error || !data) throw error ?? new Error(`audio not found: ${path}`);
  const buf = Buffer.from(await data.arrayBuffer());
  return { data: buf.toString("base64"), mimeType: data.type || "audio/webm" };
}

/** Remove the object (idempotent — removing a missing key is not an error). */
export async function deleteAudio(path: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.storage.from(SPEAKING_BUCKET).remove([path]);
  if (error) throw error;
}
