"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState =
  | "idle" | "recording" | "stopped"
  | "unsupported" | "denied" | "no_device" | "busy" | "error";

export interface RecordedClip { blob: Blob; ext: "webm" | "m4a"; url: string; seconds: number }

const PICK: { mime: string; ext: "webm" | "m4a" }[] = [
  { mime: "audio/webm;codecs=opus", ext: "webm" },
  { mime: "audio/mp4;codecs=mp4a.40.2", ext: "m4a" },
];

function supportedType(): { mime: string; ext: "webm" | "m4a" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  return PICK.find((p) => MediaRecorder.isTypeSupported(p.mime)) ?? null;
}

/**
 * Browser audio recorder for Part 2. Handles the four common failure modes
 * (unsupported / permission-denied / no-device / device-busy), auto-stops at
 * maxSeconds, exposes a local playback URL, and reports peak amplitude so the UI
 * can block an all-silence submit before spending the user's preview.
 */
export function useSpeakingRecorder(maxSeconds: number) {
  const [state, setState] = useState<RecorderState>(typeof MediaRecorder === "undefined" || !supportedType() ? "unsupported" : "idle");
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [peak, setPeak] = useState(0); // 0..1 max amplitude seen while recording

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const startMsRef = useRef(0);

  const cleanup = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
  }, []);

  const start = useCallback(async () => {
    const pick = supportedType();
    if (!pick) { setState("unsupported"); return; }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as DOMException).name;
      setState(name === "NotAllowedError" ? "denied" : name === "NotFoundError" ? "no_device" : name === "NotReadableError" ? "busy" : "error");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    setClip(null); setPeak(0); setSeconds(0);

    // Peak meter via AnalyserNode (silence guard).
    const ac = new AudioContext();
    const an = ac.createAnalyser(); an.fftSize = 512;
    ac.createMediaStreamSource(stream).connect(an);
    analyserRef.current = an;
    const buf = new Uint8Array(an.fftSize);

    const rec = new MediaRecorder(stream, { mimeType: pick.mime });
    recRef.current = rec;
    rec.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data); };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: pick.mime });
      const url = URL.createObjectURL(blob);
      setClip({ blob, ext: pick.ext, url, seconds: Math.round((Date.now() - startMsRef.current) / 1000) });
      setState("stopped");
      cleanup();
      ac.close();
    };
    startMsRef.current = Date.now();
    rec.start();
    setState("recording");
    tickRef.current = setInterval(() => {
      const s = Math.round((Date.now() - startMsRef.current) / 1000);
      setSeconds(s);
      an.getByteTimeDomainData(buf);
      let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128) / 128);
      setPeak((p) => Math.max(p, m));
      if (s >= maxSeconds) rec.stop();
    }, 250);
  }, [maxSeconds, cleanup]);

  const stop = useCallback(() => { if (recRef.current?.state === "recording") recRef.current.stop(); }, []);
  const reset = useCallback(() => {
    if (clip) URL.revokeObjectURL(clip.url);
    setClip(null); setPeak(0); setSeconds(0); setState("idle");
  }, [clip]);

  useEffect(() => () => { cleanup(); if (clip) URL.revokeObjectURL(clip.url); }, [cleanup, clip]);

  return { state, seconds, clip, peak, start, stop, reset };
}
