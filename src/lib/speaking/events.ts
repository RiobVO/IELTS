import { db } from "@/db";
import { speakingAudioEvent } from "@/db/schema";

type Kind =
  | "consent_given" | "uploaded" | "sent_to_provider"
  | "delete_requested" | "deleted_user" | "deleted_retention" | "deleted_account" | "consent_revoked";

/** Append a biometric audit event. Best-effort: never throws into the caller path. */
export async function logAudioEvent(
  userId: string | null,
  submissionId: string | null,
  event: Kind,
): Promise<void> {
  try {
    await db.insert(speakingAudioEvent).values({ userId, submissionId, event });
  } catch (e) {
    console.error("logAudioEvent failed", event, submissionId, e);
  }
}
