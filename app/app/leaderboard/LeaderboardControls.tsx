"use client";

import { useRouter } from "next/navigation";

interface Option {
  value: string;
  label: string;
}

export default function LeaderboardControls({
  period,
  scope,
  periodOptions,
  scopeOptions,
}: {
  period: string;
  scope: string;
  periodOptions: Option[];
  scopeOptions: Option[];
}) {
  const router = useRouter();

  function go(nextPeriod: string, nextScope: string) {
    router.push(
      `/app/leaderboard?period=${encodeURIComponent(nextPeriod)}&scope=${encodeURIComponent(nextScope)}`,
    );
  }

  return (
    <>
      <div style={S.filterRow}>
        {periodOptions.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            active={period === o.value}
            onClick={() => go(o.value, scope)}
          />
        ))}
      </div>
      {scopeOptions.length > 1 && (
        <div style={S.filterRow}>
          {scopeOptions.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              active={scope === o.value}
              subtle
              onClick={() => go(period, o.value)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function Chip({
  label,
  active,
  subtle,
  onClick,
}: {
  label: string;
  active: boolean;
  subtle?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...S.chip,
        ...(subtle ? S.chipSubtle : {}),
        ...(active ? S.chipActive : {}),
      }}
    >
      {label}
    </button>
  );
}

const S: Record<string, React.CSSProperties> = {
  filterRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: ".5rem",
    margin: "0 0 .75rem",
  },
  chip: {
    padding: ".4rem .8rem",
    borderRadius: 999,
    border: "1px solid #e3e3e8",
    background: "#fff",
    color: "#333",
    fontSize: ".85rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  chipSubtle: { fontWeight: 500, fontSize: ".8rem", color: "#555" },
  chipActive: { background: "#6C5CE7", color: "#fff", borderColor: "#6C5CE7" },
};
