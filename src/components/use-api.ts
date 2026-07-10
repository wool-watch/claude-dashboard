"use client";

import { useEffect, useState } from "react";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
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

    void load(false);

    if (refreshIntervalMs <= 0) return () => controller.abort();
    const timer = setInterval(() => void load(true), refreshIntervalMs);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [url, refreshIntervalMs]);

  // URL が変わった直後は前 URL の結果を無視し、初回ロード扱いにする
  const current = result !== null && result.url === url ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: current === null,
  };
}
