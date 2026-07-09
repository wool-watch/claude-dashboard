"use client";

import { useEffect, useState } from "react";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

const DEFAULT_REFRESH_MS = 60_000;

/**
 * fetch フック。refreshIntervalMs 間隔で自動再取得する（既定60秒）。
 * 再取得は成功時のみ data を差し替え、loading は初回のみ true にして
 * スケルトンの点滅を防ぐ。0 以下で自動更新を無効化。
 */
export function useApi<T>(
  url: string,
  refreshIntervalMs: number = DEFAULT_REFRESH_MS,
): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    const controller = new AbortController();

    const load = async (isRefresh: boolean): Promise<void> => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        const body: unknown = await res.json();
        if (!res.ok) {
          const message =
            typeof body === "object" && body !== null && "error" in body
              ? String((body as { error: unknown }).error)
              : `HTTP ${res.status}`;
          throw new Error(message);
        }
        setState({ data: body as T, error: null, loading: false });
      } catch (e: unknown) {
        if (controller.signal.aborted) return;
        // 自動更新の失敗は表示中のデータを保持し、次回の更新に任せる
        if (isRefresh) return;
        setState({
          data: null,
          error: e instanceof Error ? e.message : String(e),
          loading: false,
        });
      }
    };

    setState({ data: null, error: null, loading: true });
    void load(false);

    if (refreshIntervalMs <= 0) return () => controller.abort();
    const timer = setInterval(() => void load(true), refreshIntervalMs);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [url, refreshIntervalMs]);

  return state;
}
