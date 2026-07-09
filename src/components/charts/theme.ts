import type { CSSProperties } from "react";

/**
 * Recharts の Tooltip はデフォルトで白背景の固定インラインスタイルを持ち
 * ダークモードでテーマが反映されない。globals.css の CSS 変数を適用して
 * 両モードに追従させる。背景は「持ち上がった面」（ダークでは一段明るい
 * サーフェス + シャドウ）にするのがダッシュボードのベストプラクティス。
 */
export const CHART_TOOLTIP_PROPS = {
  contentStyle: {
    backgroundColor: "var(--surface-elevated)",
    color: "var(--foreground)",
    border: "1px solid rgba(127,127,127,0.35)",
    borderRadius: 6,
    fontSize: 12,
    boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
  } satisfies CSSProperties,
  labelStyle: { color: "var(--foreground)" } satisfies CSSProperties,
};

/** Bar 系チャートのホバーハイライト。両モードで控えめに見える中間グレー */
export const CHART_CURSOR = { fill: "rgba(127,127,127,0.15)" };

/** カテゴリカルパレット（Pie 等）。CSS 変数経由でモード別に解決される */
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
] as const;

/** 軸テキストは低コントラストのソフトな色に */
export const CHART_AXIS_TICK = { fontSize: 11, fill: "var(--chart-axis)" };

/** グリッド・軸線は背景に対して subtle に */
export const CHART_GRID = "var(--chart-grid)";

/** ヒートマップの5段階色（index = heatLevel）。ライト/ダーク両対応 */
export const HEAT_LEVEL_CLASSES = [
  "bg-black/[.06] dark:bg-white/[.08]",
  "bg-emerald-300 dark:bg-emerald-900",
  "bg-emerald-400 dark:bg-emerald-700",
  "bg-emerald-600 dark:bg-emerald-500",
  "bg-emerald-800 dark:bg-emerald-300",
] as const;
