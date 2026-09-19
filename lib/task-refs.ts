// Which existing tasks does a `task` argv name? Used to attribute agent
// tool calls to the tasks they touched. Deliberately conservative: only the
// leading filter's ids/uuids count, never report output.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_LIST = /^\d+(?:[,-]\d+)*$/;
const RANGE_CAP = 50;

function expandIdList(token: string): string[] {
  const refs: string[] = [];
  for (const part of token.split(",")) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range === null) {
      refs.push(String(Number(part)));
    } else {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let id = from; id <= to && refs.length < RANGE_CAP; id++) refs.push(String(id));
    }
    if (refs.length >= RANGE_CAP) break;
  }
  return refs.slice(0, RANGE_CAP);
}

export function extractTaskRefs(args: string[]): string[] {
  if (args[0] === "add" || args[0] === "log") return [];
  const refs: string[] = [];
  for (const token of args) {
    if (UUID.test(token)) {
      refs.push(token);
    } else if (ID_LIST.test(token)) {
      refs.push(...expandIdList(token));
    } else if (token.includes(":") || token.startsWith("+") || token.startsWith("-")) {
      continue;
    } else {
      break;
    }
    if (refs.length >= RANGE_CAP) break;
  }
  return refs.slice(0, RANGE_CAP);
}

export function parseCreatedTaskId(stdout: string): string | null {
  const match = /Created task (\d+)\./.exec(stdout);
  return match === null ? null : match[1];
}
