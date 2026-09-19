#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const dbPath = join(process.env.TASKDATA ?? ".", "db.json");
const args = process.argv.slice(2).filter((a) => !a.startsWith("rc."));
const db = JSON.parse(readFileSync(dbPath, "utf8"));

function withIds() {
  let n = 0;
  return db.tasks.map((t) => ({ ...t, id: t.status === "pending" ? ++n : 0 }));
}
function save() {
  writeFileSync(dbPath, JSON.stringify(db));
}
function matches(task, tokens) {
  const refs = tokens.filter((t) => /^\d+$/.test(t) || /^[0-9a-f-]{36}$/i.test(t));
  const filters = tokens.filter((t) => t.includes(":"));
  if (refs.length > 0 && !refs.some((r) => String(task.id) === r || task.uuid === r)) return false;
  return filters.every((f) => {
    const [key, value] = [f.slice(0, f.indexOf(":")), f.slice(f.indexOf(":") + 1)];
    if (key === "project") return String(task.project ?? "").startsWith(value);
    if (key === "status") return task.status === value;
    return true;
  });
}

const command = args.at(-1);
if (command === "export") {
  const out = withIds().filter((t) => matches(t, args.slice(0, -1)));
  process.stdout.write(JSON.stringify(out));
} else if (args[0] === "add") {
  const task = { uuid: randomUUID(), description: args.slice(1).join(" "), status: "pending" };
  db.tasks.push(task);
  save();
  process.stdout.write(`Created task ${withIds().find((t) => t.uuid === task.uuid).id}.\n`);
} else if (command === "done") {
  const target = withIds().filter((t) => matches(t, args.slice(0, -1)));
  for (const t of target) db.tasks.find((x) => x.uuid === t.uuid).status = "completed";
  save();
  process.stdout.write(`Completed ${target.length} task(s).\n`);
} else if (args.includes("modify")) {
  const at = args.indexOf("modify");
  const target = withIds().filter((t) => matches(t, args.slice(0, at)));
  for (const t of target) {
    const row = db.tasks.find((x) => x.uuid === t.uuid);
    for (const token of args.slice(at + 1)) {
      const sep = token.indexOf(":");
      if (sep === -1) continue;
      const key = token.slice(0, sep);
      const value = token.slice(sep + 1);
      if (value === "") delete row[key];
      else row[key] = value;
    }
  }
  save();
  process.stdout.write(`Modified ${target.length} task(s).\n`);
} else if (args[0] === "undo") {
  process.stdout.write("Undo complete.\n");
} else if (command === "_projects") {
  const names = new Set(
    withIds().filter((t) => t.status === "pending" && t.project).map((t) => t.project),
  );
  process.stdout.write([...names].sort().join("\n") + "\n");
} else {
  process.stderr.write(`fake-task: unsupported args: ${args.join(" ")}\n`);
  process.exit(1);
}
