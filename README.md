# Claude Code 使用状況ダッシュボード

`~/.claude/projects/**/*.jsonl`（Claude Code のローカルセッションログ）を集計し、
チャット（ターン）毎・セッション毎のトークン使用量・推定コスト・操作時間を閲覧できる
ローカル専用 Web ダッシュボード。DB なし・認証なし・外部送信なし。

Claude Code に加えて **Codex CLI**（`~/.codex/sessions` のロールアウト）と
**Gemini CLI**（`~/.gemini/tmp/<hash>/chats` のチャット記録）のセッションも取り込み、
一覧・詳細・集計・AI振り返り・アーカイブの対象にできます（設定モーダルでソース別に
有効/無効を切替可能）。Gemini CLI の記録は CLI 側の既定で30日後に自動削除されるため、
本ダッシュボードのアーカイブが実質的なバックアップになります。

## 起動

```bash
npm install
npm run dev        # http://localhost:3947
```

ポートを変えたい場合: `npx next dev -p <port>`

サーバーはデフォルトで `127.0.0.1` のみにバインドします（認証がないため）。
LAN 内の他端末から使いたい場合は `-H` オプションを変更してください。

セキュリティ: 全リクエストで Host ヘッダを検証し、ループバック
（`127.0.0.1` / `localhost` / `[::1]`）以外を 403 で拒否します（DNSリバインディング対策、
`src/proxy.ts`）。`-H` で LAN 公開する場合は `src/lib/api/host.ts` の許可リストに
ホスト名の追加が必要です。

## 主な画面

| パス | 内容 |
|---|---|
| `/` | サマリーカード（総コスト・トークン・セッション/ターン・操作時間 + 今日/今週/今月）、時系列チャート（時/日/週/月切替）、モデル別・ツール別統計 |
| `/projects` | プロジェクト別一覧 |
| `/sessions` | セッション一覧（`?project=` でフィルタ、ソート可） |
| `/sessions/[id]` | セッション詳細（ターン別タイムライン: プロンプト・モデル・ツール・トークン内訳・コスト・所要時間） |

## 設定（環境変数）

| 変数 | 既定値 | 説明 |
|---|---|---|
| `CLAUDE_DATA_DIR` | `~/.claude/projects` | ログディレクトリの上書き |
| `CODEX_DATA_DIR` | `~/.codex/sessions` | Codex CLI のロールアウト（セッション）ディレクトリ |
| `CODEX_ARCHIVED_DIR` | `~/.codex/archived_sessions` | Codex CLI がアーカイブしたセッションのディレクトリ |
| `GEMINI_DATA_DIR` | `~/.gemini/tmp` | Gemini CLI のチャット記録ディレクトリ（`<hash>/chats/session-*.jsonl`） |
| `IDLE_THRESHOLD_MS` | `300000`（5分） | 操作時間推定のアイドル閾値。レコード間隔がこれを超えると離席とみなし不算入 |
| `MAX_FILE_SIZE_MB` | `100` | この上限を超える JSONL はスキップ（警告ログ出力）。メモリ枯渇防止 |
| `CLAUDE_SETTINGS_PATH` | `~/.claude-dashboard/settings.json` | ダッシュボード設定の保存先 |
| `CLAUDE_ANALYSIS_DIR` | `~/.claude-dashboard/analysis` | AI分析結果の保存先 |
| `CLAUDE_CLI_PATH` | `claude` | Claude Code CLI のパス（設定画面の CLIパス が空のとき使用） |
| `ANALYSIS_TIMEOUT_MS` | `180000`（3分） | AI分析1回のタイムアウト |
| `ANALYSIS_MAX_BUDGET_USD` | `1` | Claude Code CLI での分析1回の予算上限 |
| `OPENAI_COMPAT_API_KEY` | なし | OpenAI互換APIのキー。設定されていれば settings.json の apiKey より優先 |

## AI分析（セッション振り返り・優先課題）

セッション詳細の「このセッションを分析する」と、ダッシュボードの「優先課題の分析」は
AI バックエンドで実行されます。ヘッダーの歯車アイコン → 設定モーダルの
「AI分析プロバイダ」で切り替えでき、プロバイダごとの設定（モデル・CLIパス・Base URL・APIキー）は
切り替えても保持されます。

分析はハーネスエンジニアリングの実践に基づく2層構成です:

- **定量メトリクス（LLM 不要・JSONL から機械算出）**: 推定変更行数・編集/再編集ファイル数（手戻り）、
  ツールエラー率・テスト実行/失敗回数（不具合）、ユーザー割り込み回数、
  工数効率（行/時間）・コスト効率（$/100行）・キャッシュ読取比率（節約）。
  分析結果に同梱保存され、セッション詳細とダッシュボードの週次トレンドに表示されます。
- **LLM 定性評価**: ハーネス実践5軸スコア（計画・タスク分解 / コンテキスト提供 /
  検証・テスト / 軌道安定性 / スコープ規律、各1〜5）と、手戻り原因ベースの
  カテゴリ付き改善アクション（次のセッションでそのまま実行できる一文）。
  定量メトリクスはプロンプトに注入され、評価の根拠として使われます。

「優先課題の分析」は、保存済みの振り返り（直近最大20セッション分）を横断して
優先度の高い課題を1〜3件選び、リポジトリ内蔵のベストプラクティスカタログ
（`src/lib/analysis/practices.ts`。CLAUDE.md 整備・計画モード・TDD などのハーネス実践9件と、
完了条件の明文化・タスク分解などのプロジェクト管理実践4件）を根拠にした
構造化アクションを提案します。各アクションは実施手段の種別
（依頼プロンプト / CLAUDE.md / ワークフロー / 設定・ツール）、根拠プラクティス、
実施手順、実数値を引用した期待効果、コピペしてそのまま使えるスニペットを持ちます。
カタログは入力の改善点カテゴリ頻度に応じて選択的にプロンプトへ注入されます。

旧形式（セッション振り返りは schemaVersion 1、優先課題は v1/v2）の分析結果は
「stale / 旧形式」として案内され、再分析で新形式に更新できます。

| プロバイダ | 方式 | 備考 |
|---|---|---|
| Claude Code CLI（既定） | `claude -p` ヘッドレス | コスト表示あり。モデルは haiku / sonnet |
| Codex CLI | `codex exec` ヘッドレス | `--output-schema` で構造化出力 |
| Gemini CLI | `gemini -p` ヘッドレス | スキーマはプロンプト埋め込み |
| LM Studio | OpenAI 互換 REST（既定 `http://localhost:1234/v1`） | ローカルモデル。APIキー不要 |
| OpenAI 互換 API | OpenAI 互換 REST | Ollama / vLLM など。Base URL・APIキーを設定 |

APIキーの注意: `settings.json`（パーミッション 600）に平文で保存されます。
API レスポンスにはキー本体は含まれません（`hasApiKey` のみ）。平文保存を避けたい場合は
環境変数 `OPENAI_COMPAT_API_KEY` を使ってください。

## 単価改定・新モデル追加

`src/lib/pricing/model-pricing.ts` の `PRICING_TABLE` を編集するだけで完結します
（USD / 1M tokens。input / output / 5m・1h キャッシュ書込 / 読取の5係数）。
単価表にないモデルはモデル名の部分一致（fable/opus/sonnet/haiku）でフォールバックし、
UI に「推定」バッジが表示されます。

## 集計の仕様（重要ポイント）

- **requestId デデュープ**: 同一 API リクエストが content block 毎に複数行記録されるため、
  usage は `requestId`（欠落時は `message.id` → `uuid`）で1回のみ計上。
  これを行わないとコストが約2.3倍に過大計上される（実測検証済み）。
- **ターン分割**: user プロンプト（`promptId`）単位。`tool_result` のみの行や
  `<local-command-caveat>` 等のメタ行は新ターンにしない。
- **所要時間**: Claude Code が記録する `system/turn_duration` を優先、なければタイムスタンプ差分。
- **サブエージェント**（`isSidechain`）: コストには算入、メッセージ数は別枠表示。
- **キャッシュ**: ファイルの mtime+size ベースのインメモリキャッシュ。変更時のみ再パース。
- 週は月曜開始、タイムゾーンはシステム TZ。

## 開発

```bash
npm run test         # ユニットテスト（TZ=Asia/Tokyo 固定）
npm run test:watch
npx tsc --noEmit     # 型チェック
```

データレイヤー（`src/lib/`）は Next.js 非依存の純関数で構成され、
`tests/unit/` に1対1対応のテストがあります。fixture（`tests/fixtures/`）は
実データを含まない匿名化した合成 JSONL です。
