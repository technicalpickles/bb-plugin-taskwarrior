export interface ProjectStatus {
  exists: boolean;
  pending: number;
}

export type ProjectHealth = "unlinked" | "missing" | "empty" | "ok";

export function effectiveProject(
  override: string | null | undefined,
  bbName: string | null,
  isPersonal: boolean,
): string | null {
  if (override !== null && override !== undefined && override !== "") return override;
  if (isPersonal || bbName === null || bbName === "") return null;
  return bbName;
}

export function projectHealth(project: string | null, status: ProjectStatus | null): ProjectHealth {
  if (project === null) return "unlinked";
  if (status === null) return "ok";
  if (!status.exists) return "missing";
  if (status.pending === 0) return "empty";
  return "ok";
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function closestProject(name: string, projects: string[]): string | null {
  const target = normalize(name);
  if (target === "") return null;
  const exact = projects.find((project) => normalize(project) === target);
  if (exact !== undefined) return exact;
  let best: string | null = null;
  let bestGap = Infinity;
  for (const project of projects) {
    const candidate = normalize(project);
    if (candidate === "") continue;
    if (candidate.includes(target) || target.includes(candidate)) {
      const gap = Math.abs(candidate.length - target.length);
      if (gap < bestGap) {
        best = project;
        bestGap = gap;
      }
    }
  }
  return best;
}

/** True iff the task's project is `name` or a dotted child of it (`name.x`). */
export function belongsToProject(taskProject: string | undefined, name: string): boolean {
  if (taskProject === undefined || name === "") return false;
  return taskProject === name || taskProject.startsWith(`${name}.`);
}
