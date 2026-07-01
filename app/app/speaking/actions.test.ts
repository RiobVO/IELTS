import { describe, it, expect, vi, beforeEach } from "vitest";

// Co-located test for the Speaking create action. We mock @/db (env-validating
// import), the store, storage, events, auth and @/env; canEvaluate / effectiveTier
// stay real (pure). featureEnabled is a controllable vi.fn so we can prove the
// create→evaluate desync is closed (no upload/insert when the trigger can't fire).
const {
  getUser, getProfile, counts, insertUploading, trigger, signedUpload, logEvent, dbSelect, loadTask,
  readOwn, markDeleted, markDeleteFailed, deleteAudioFn,
} = vi.hoisted(() => ({
    getUser: vi.fn(),
    getProfile: vi.fn(),
    counts: vi.fn(),
    insertUploading: vi.fn(),
    trigger: vi.fn(),
    signedUpload: vi.fn(),
    logEvent: vi.fn(),
    dbSelect: vi.fn(),
    loadTask: vi.fn(),
    readOwn: vi.fn(),
    markDeleted: vi.fn(),
    markDeleteFailed: vi.fn(),
    deleteAudioFn: vi.fn(),
  }));
const featureEnabled = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ getUser, getProfile }));
vi.mock("@/lib/speaking/store", () => ({
  insertUploadingSubmission: insertUploading,
  triggerEvaluate: trigger,
  completedCounts: counts,
  loadSpeakingTaskForSubmissionGate: loadTask,
  markUploaded: vi.fn(),
  readOwnSubmission: readOwn,
  markFailed: vi.fn(),
  markAudioDeleted: markDeleted,
  markAudioDeleteFailed: markDeleteFailed,
}));
vi.mock("@/lib/speaking/storage", () => ({ signedUploadUrl: signedUpload, audioSize: vi.fn(), deleteAudio: deleteAudioFn }));
vi.mock("@/lib/speaking/events", () => ({ logAudioEvent: logEvent }));
// db.update is chainable so deleteSpeakingRecording's intent + transcript-wipe updates resolve.
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => dbSelect(...a),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
}));
vi.mock("@/env", () => ({ speakingFeatureEnabled: featureEnabled }));

import { createSpeakingSubmission, deleteSpeakingRecording } from "./actions";

const selectChain = (rows: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(rows) }) });
const TASK = "11111111-1111-1111-1111-111111111111"; // a well-formed task id

beforeEach(() => {
  [getUser, getProfile, counts, insertUploading, trigger, signedUpload, logEvent, dbSelect, featureEnabled, loadTask,
    readOwn, markDeleted, markDeleteFailed, deleteAudioFn].forEach(
    (m) => m.mockReset(),
  );
  featureEnabled.mockReturnValue(true); // default fully configured; #5 case overrides
  loadTask.mockResolvedValue({ status: "published", tierRequired: "basic" }); // default: open task; #3 cases override
});

describe("createSpeakingSubmission", () => {
  it("creates an uploading submission + signed url for an allowed ultra user", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    getProfile.mockResolvedValue({ recording_consent_at: new Date(), tier: "ultra", premium_until: null });
    counts.mockResolvedValue({ lifetime: 0, today: 0 });
    insertUploading.mockResolvedValue("sub1");
    dbSelect.mockReturnValue(selectChain([{ audioPath: "u1/sub1.webm" }]));
    signedUpload.mockResolvedValue({ url: "http://upload" });
    expect(await createSpeakingSubmission(TASK, "webm")).toEqual({ submissionId: "sub1", uploadUrl: "http://upload" });
  });

  it("blocks when the feature is not fully configured (origin/secret missing) without insertUploading", async () => {
    featureEnabled.mockReturnValue(false); // model+key present but no origin/secret → trigger would no-op
    getUser.mockResolvedValue({ id: "u1" });
    getProfile.mockResolvedValue({ recording_consent_at: new Date(), tier: "ultra", premium_until: null });
    counts.mockResolvedValue({ lifetime: 0, today: 0 });
    expect(await createSpeakingSubmission("t1", "webm")).toEqual({ error: "not_configured" });
    expect(insertUploading).not.toHaveBeenCalled();
  });

  it("rejects a draft cue-card even for a sub-tier preview user (#3 holds)", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    getProfile.mockResolvedValue({ recording_consent_at: new Date(), tier: "premium", premium_until: null });
    counts.mockResolvedValue({ lifetime: 0, today: 0 });
    loadTask.mockResolvedValue({ status: "draft", tierRequired: "ultra" });
    expect(await createSpeakingSubmission(TASK, "webm")).toEqual({ error: "unavailable" });
    expect(insertUploading).not.toHaveBeenCalled();
  });

  // #D: Speaking is Ultra-only (SPEAKING_MIN_TIER=ultra); free/premium get one preview
  // (canEvaluate gates it above). The per-task tier_required must NOT block that preview —
  // only at-tier (ultra) users are checked against it.
  it("allows a basic preview on an ultra cue-card (#D — preview revived)", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    getProfile.mockResolvedValue({ recording_consent_at: new Date(), tier: "basic", premium_until: null });
    counts.mockResolvedValue({ lifetime: 0, today: 0 });
    insertUploading.mockResolvedValue("sub1");
    dbSelect.mockReturnValue(selectChain([{ audioPath: "u1/sub1.webm" }]));
    signedUpload.mockResolvedValue({ url: "http://upload" });
    loadTask.mockResolvedValue({ status: "published", tierRequired: "ultra" });
    expect(await createSpeakingSubmission(TASK, "webm")).toEqual({ submissionId: "sub1", uploadUrl: "http://upload" });
    expect(insertUploading).toHaveBeenCalled();
  });

  it("allows a premium preview on an ultra cue-card (#D — preview revived)", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    getProfile.mockResolvedValue({ recording_consent_at: new Date(), tier: "premium", premium_until: null });
    counts.mockResolvedValue({ lifetime: 0, today: 0 });
    insertUploading.mockResolvedValue("sub1");
    dbSelect.mockReturnValue(selectChain([{ audioPath: "u1/sub1.webm" }]));
    signedUpload.mockResolvedValue({ url: "http://upload" });
    loadTask.mockResolvedValue({ status: "published", tierRequired: "ultra" });
    expect(await createSpeakingSubmission(TASK, "webm")).toEqual({ submissionId: "sub1", uploadUrl: "http://upload" });
    expect(insertUploading).toHaveBeenCalled();
  });

  it("allows an ultra user on an ultra cue-card (#D)", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    getProfile.mockResolvedValue({ recording_consent_at: new Date(), tier: "ultra", premium_until: null });
    counts.mockResolvedValue({ lifetime: 0, today: 0 });
    insertUploading.mockResolvedValue("sub1");
    dbSelect.mockReturnValue(selectChain([{ audioPath: "u1/sub1.webm" }]));
    signedUpload.mockResolvedValue({ url: "http://upload" });
    loadTask.mockResolvedValue({ status: "published", tierRequired: "ultra" });
    expect(await createSpeakingSubmission(TASK, "webm")).toEqual({ submissionId: "sub1", uploadUrl: "http://upload" });
  });

  it("rejects a malformed taskId before any task read (#3)", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    getProfile.mockResolvedValue({ recording_consent_at: new Date(), tier: "ultra", premium_until: null });
    counts.mockResolvedValue({ lifetime: 0, today: 0 });
    expect(await createSpeakingSubmission("not-a-uuid", "webm")).toEqual({ error: "unavailable" });
    expect(loadTask).not.toHaveBeenCalled();
    expect(insertUploading).not.toHaveBeenCalled();
  });
});

// #2: удаление аудио (биометрия) не должно молча "получаться". Раньше пустой catch
// глотал ошибку remove и строка помечалась deleted → объект оставался в приватном
// бакете навсегда, а система рапортовала ok:true. Теперь mark-after-remove.
describe("deleteSpeakingRecording (#2)", () => {
  it("НЕ помечает deleted и возвращает ok:false, когда remove объекта упал", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    readOwn.mockResolvedValue({ status: "completed", updatedAt: new Date() });
    dbSelect.mockReturnValue(selectChain([{ audioPath: "u1/sub1.webm" }]));
    deleteAudioFn.mockRejectedValue(new Error("storage down"));
    expect(await deleteSpeakingRecording("sub1")).toEqual({ ok: false });
    expect(markDeleted).not.toHaveBeenCalled();
    expect(markDeleteFailed).toHaveBeenCalledWith("sub1", expect.stringContaining("storage down"));
  });

  it("помечает deleted и возвращает ok:true, когда remove успешен", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    readOwn.mockResolvedValue({ status: "completed", updatedAt: new Date() });
    dbSelect.mockReturnValue(selectChain([{ audioPath: "u1/sub1.webm" }]));
    deleteAudioFn.mockResolvedValue(undefined);
    expect(await deleteSpeakingRecording("sub1")).toEqual({ ok: true });
    expect(markDeleted).toHaveBeenCalledWith("sub1", "u1", "user");
    expect(markDeleteFailed).not.toHaveBeenCalled();
  });
});
