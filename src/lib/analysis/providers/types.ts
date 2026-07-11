/** プロバイダ横断の実行オプション（スキーマ・プロンプトは呼出側が決める） */
export interface ProviderRunOptions {
  model: string;
  jsonSchema: object;
  /** CLI にフラグが無いプロバイダではユーザープロンプト先頭に結合される */
  systemPrompt: string;
  /** abort で実行を中断し AnalysisError("aborted") にする */
  signal?: AbortSignal;
}

/** プロバイダ実行の結果。result のスキーマ検証は呼出側の責務 */
export interface ProviderRunOutcome {
  result: unknown;
  /** コストを返せるのは claude のみ。他プロバイダは常に null */
  costUSD: number | null;
}
