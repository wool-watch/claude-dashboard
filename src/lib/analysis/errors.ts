export type AnalysisErrorKind =
  | "cli-not-found"
  | "cli-failed"
  | "timeout"
  | "invalid-output"
  | "in-flight"
  | "no-conversation"
  | "no-analyses"
  | "aborted"
  | "connection-failed";

export class AnalysisError extends Error {
  constructor(
    message: string,
    readonly kind: AnalysisErrorKind,
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}
