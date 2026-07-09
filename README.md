# Claude Code 使用状況ダッシュボード

`~/.claude/projects/**/*.jsonl`（Claude Code のローカルセッションログ）を集計し、
チャット（ターン）毎・セッション毎のトークン使用量・推定コスト・操作時間を閲覧できる
ローカル専用 Web ダッシュボード。DB なし・認証なし・外部送信なし。

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
| `IDLE_THRESHOLD_MS` | `300000`（5分） | 操作時間推定のアイドル閾値。レコード間隔がこれを超えると離席とみなし不算入 |
| `MAX_FILE_SIZE_MB` | `100` | この上限を超える JSONL はスキップ（警告ログ出力）。メモリ枯渇防止 |

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

設計文書: [DETAILED_DESIGN.md](./DETAILED_DESIGN.md)
