"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** 即時再取得。自動更新と同様に loading を立てず、成功時のみ差し替える */
  refetch: () => void;
}

/** 取得結果と、それがどの URL のものかの対応 */
interface FetchResult<T> {
  url: string;
  data: T | null;
  error: string | null;
}

const DEFAULT_REFRESH_MS = 60_000;

/**
 * fetch フック。refreshIntervalMs 間隔で自動再取得する（既定60秒）。
 * 再取得は成功時のみ data を差し替え、loading は初回のみ true にして
 * スケルトンの点滅を防ぐ。0 以下で自動更新を無効化。
 * loading は「現在の URL に対する取得結果がまだ無い」ことから導出する
 * （effect 内で同期的に state をリセットしない）。
 */
export function useApi<T>(
  url: string,
  refreshIntervalMs: number = DEFAULT_REFRESH_MS,
): ApiState<T> {
  const [result, setResult] = useState<FetchResult<T> | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const lastUrlRef = useRef<string | null>(null);
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    // refetch 起因の再実行は refresh 扱い（URL が変わった場合は初回ロード扱い）
    const isRefetch = refreshKey > 0 && lastUrlRef.current === url;
    lastUrlRef.current = url;

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
        setResult({ url, data: body as T, error: null });
      } catch (e: unknown) {
        if (controller.signal.aborted) return;
        // 自動更新の失敗は表示中のデータを保持し、次回の更新に任せる
        if (isRefresh) return;
        setResult({
          url,
          data: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };

    void load(isRefetch);

    if (refreshIntervalMs <= 0) return () => controller.abort();
    const timer = setInterval(() => void load(true), refreshIntervalMs);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [url, refreshIntervalMs, refreshKey]);

  // URL が変わった直後は前 URL の結果を無視し、初回ロード扱いにする
  const current = result !== null && result.url === url ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: current === null,
    refetch,
  };
}
