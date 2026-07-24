"use client";

import { Button } from "@/components/core/Button";
import { Input } from "@/components/core/Input";
import { completeOnboarding } from "./actions";

interface RegionOption {
  id: string;
  name: string;
}

const BANDS = ["4.0", "4.5", "5.0", "5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0"];

export default function OnboardingForm({
  regions,
  error,
  defaultName,
}: {
  regions: RegionOption[];
  error: string | null;
  defaultName: string;
}) {
  return (
    <div style={S.screen}>
      <div style={S.card}>
        <div style={S.eyebrow}>Welcome to bando</div>
        <h1 style={S.h1}>Let&apos;s set up your prep</h1>
        <p style={S.lead}>
          Twenty seconds. This sets your band target and puts you on the right league.
        </p>

        {error && <div style={S.error}>{error}</div>}

        <form action={completeOnboarding} style={S.form}>
          <label style={S.field}>
            <span style={S.label}>Display name</span>
            <Input
              name="display_name"
              defaultValue={defaultName}
              placeholder="How you appear on the leaderboard"
              maxLength={40}
              required
            />
          </label>

          <label style={S.field}>
            <span style={S.label}>
              Region <span style={S.opt}>· optional</span>
            </span>
            <select name="region_id" defaultValue="" style={S.select}>
              <option value="">Prefer not to say</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>

          <label style={S.field}>
            <span style={S.label}>Target band</span>
            <select name="target_band" defaultValue="7.0" style={S.select} required>
              {BANDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>

          <div style={{ marginTop: 8 }}>
            <Button type="submit" size="lg" fullWidth trailingIcon="arrow-right">
              Start practising
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  screen: {
    minHeight: "100dvh",
    background: "var(--bg-base)",
    display: "grid",
    placeItems: "center",
    padding: "32px 18px",
  },
  card: {
    width: "100%",
    maxWidth: 460,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-xl)",
    boxShadow: "var(--shadow-lg)",
    padding: "34px 32px 36px",
  },
  eyebrow: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-xs)",
    fontWeight: 800,
    letterSpacing: "var(--tracking-caps)",
    textTransform: "uppercase",
    color: "var(--brand)",
  },
  h1: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-3xl)",
    fontWeight: 800,
    letterSpacing: "var(--tracking-tight)",
    color: "var(--text-primary)",
    margin: "8px 0 6px",
  },
  lead: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-base)",
    color: "var(--text-muted)",
    margin: "0 0 24px",
    lineHeight: 1.5,
  },
  error: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    color: "var(--error-text)",
    background: "var(--error-subtle)",
    border: "1px solid var(--error)",
    borderRadius: "var(--radius-md)",
    padding: "10px 14px",
    marginBottom: 18,
  },
  form: { display: "flex", flexDirection: "column", gap: 18 },
  field: { display: "flex", flexDirection: "column", gap: 7 },
  label: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-sm)",
    fontWeight: 700,
    color: "var(--text-secondary)",
  },
  opt: { fontWeight: 500, color: "var(--text-muted)" },
  select: {
    height: 50,
    padding: "0 14px",
    background: "var(--surface-raised)",
    border: "2px solid var(--border)",
    borderRadius: "var(--radius-md)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-base)",
    color: "var(--text-primary)",
    cursor: "pointer",
    appearance: "none",
  },
};
