/**
 * Chart theme: the only place (with src/index.css) where raw chart hex lives.
 *
 * Categorical slots are assigned in this fixed order and never cycled or
 * reordered. Fold anything beyond 6 series into "Other". Slots 5–6 fall below
 * 3:1 on white, so charts that use them must also show direct labels.
 */
export const CHART_SERIES_LIGHT = ["#13804E", "#2A78D6", "#EB6834", "#6250D6", "#7CC23A", "#E87BA4"] as const;
export const CHART_SERIES_DARK = ["#2FA86A", "#3987E5", "#D95926", "#9085E9", "#5FA22A", "#D55181"] as const;

/** Single-hue forest ramp for magnitude (heatmaps), light → dark. */
export const CHART_FOREST_RAMP = ["#E3F2E9", "#A7D9BB", "#5FB386", "#13804E", "#00381F"] as const;

/** Reserved status colors — never used as a chart series. */
export const STATUS_HEX = {
  success: "#0CA30C",
  warning: "#D98A00",
  danger: "#D03B3B",
  info: "#2A78D6",
} as const;

export function isDarkMode(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export function chartSeries(): readonly string[] {
  return isDarkMode() ? CHART_SERIES_DARK : CHART_SERIES_LIGHT;
}

/** Shared Recharts props: recessive grid, ink-400 axis text, no axis lines. */
export const chartAxis = {
  tick: { fontSize: 12, fill: "hsl(var(--ink-400))" },
  axisLine: false,
  tickLine: false,
} as const;

export const chartGrid = {
  stroke: "hsl(var(--border))",
  strokeDasharray: "0",
  vertical: false,
} as const;

export const chartTooltip = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid hsl(var(--border))",
    background: "hsl(var(--popover))",
    color: "hsl(var(--popover-foreground))",
    fontSize: 12,
  },
  cursor: { fill: "hsl(var(--muted))", opacity: 0.6 },
} as const;
