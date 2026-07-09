import {
  addUsage,
  emptyUsage,
  type ProjectSummary,
  type SessionDetail,
} from "@/lib/types";

function displayNameOf(projectPath: string): string {
  const segments = projectPath.split("/").filter((s) => s !== "");
  return segments[segments.length - 1] ?? projectPath;
}

export function aggregateProjects(
  sessions: SessionDetail[],
): ProjectSummary[] {
  const byProject = new Map<string, ProjectSummary>();

  for (const s of sessions) {
    const entry =
      byProject.get(s.projectId) ??
      ({
        projectId: s.projectId,
        projectPath: s.projectPath,
        displayName: displayNameOf(s.projectPath),
        sessionCount: 0,
        turnCount: 0,
        usage: emptyUsage(),
        costUSD: 0,
        activeTimeMs: 0,
        lastAt: "",
      } satisfies ProjectSummary);

    entry.sessionCount += 1;
    entry.turnCount += s.turnCount;
    entry.usage = addUsage(entry.usage, s.usage);
    entry.costUSD += s.costUSD;
    entry.activeTimeMs += s.activeTimeMs;
    if (s.lastAt > entry.lastAt) entry.lastAt = s.lastAt;
    byProject.set(s.projectId, entry);
  }

  return [...byProject.values()].sort((a, b) =>
    b.lastAt.localeCompare(a.lastAt),
  );
}
