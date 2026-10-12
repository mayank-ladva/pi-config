import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Type } from "typebox";

type Phase = "spec" | "plan" | "tasks" | "implement" | "review" | "done";
type TaskStatus = "pending" | "in_progress" | "blocked" | "done";
type TaskWorkflowMode = "normal" | "tdd" | "grill-me";

type TaskDirEntry = {
  name: string;
  isDirectory(): boolean;
};

type TaskflowToolAction = "status" | "next" | "run" | "done" | "approve" | "branch" | "pr_context";

type TaskflowToolParams = {
  action: TaskflowToolAction;
  id?: string;
  note?: string;
};

type TaskflowToolCallEvent = {
  toolName: string;
  input: {
    path?: unknown;
  };
};

interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  parallel?: boolean;
  notes?: string[];
}

interface TaskState {
  name: string;
  taskDir: string;
  phase: Phase;
  branch: string;
  workflowMode: TaskWorkflowMode;
  planApproved: boolean;
  tasks: TaskItem[];
}

const TASKS_DIR = "tasks";
const CURRENT_FILE = ".taskflow-current";

const TaskflowParams = Type.Object({
  action: StringEnum(["status", "next", "run", "done", "approve", "branch", "pr_context"] as const),
  id: Type.Optional(Type.String({ description: "Task ids for done, e.g. T001 T002 or 001 002" })),
  note: Type.Optional(Type.String({ description: "Optional note for task completion" })),
});



function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "task";
}

function branchNameFromTaskDir(taskDir: string): string {
  const base = taskDir.split("/").pop() ?? taskDir;
  return `feat/${base.replace(/^\d{3}-/, "")}`;
}

function taskNumberFromDir(taskDir: string): string {
  const base = taskDir.split("/").pop() ?? taskDir;
  return /^(\d{3})-/.exec(base)?.[1] ?? base;
}

async function resolveTaskDirRef(cwd: string, ref: string): Promise<string | undefined> {
  const raw = ref.trim().replace(/^@/, "");
  if (!raw) return undefined;

  const normalized = raw.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const directCandidates = [normalized, `${TASKS_DIR}/${normalized}`];
  for (const candidate of directCandidates) {
    if (await isTaskDir(cwd, candidate)) return candidate;
  }

  const base = normalized.split("/").pop() ?? normalized;
  if (!/^\d{3}$/.test(base)) return undefined;

  const tasksPath = resolve(cwd, TASKS_DIR);
  if (!(await exists(tasksPath))) return undefined;

  const entries: TaskDirEntry[] = await readdir(tasksPath, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${base}-`))
    .map((entry) => entry.name);

  if (matches.length === 1) return `${TASKS_DIR}/${matches[0]}`;
  if (matches.length > 1) {
    throw new Error(`Task number ${base} is ambiguous: ${matches.join(", ")}`);
  }

  return undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isTaskDir(cwd: string, taskDir: string): Promise<boolean> {
  const absDir = resolve(cwd, taskDir);
  if (!(await exists(absDir))) return false;

  const required = ["tasks.md", "plan.md", "spec.md"];
  for (const file of required) {
    if (await exists(resolve(absDir, file))) return true;
  }

  return false;
}

async function nextTaskNumber(cwd: string): Promise<number> {
  const tasksPath = resolve(cwd, TASKS_DIR);
  if (!(await exists(tasksPath))) return 1;

  const entries: TaskDirEntry[] = await readdir(tasksPath, { withFileTypes: true });
  const nums = entries
    .filter((entry) => entry.isDirectory() && /^\d{3}-/.test(entry.name))
    .map((entry) => Number(entry.name.slice(0, 3)))
    .filter(Number.isFinite);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function formatNumber(n: number): string {
  return String(n).padStart(3, "0");
}

function inferTaskName(taskDir: string, specText?: string): string {
  const heading = specText?.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;

  const base = taskDir.split("/").pop() ?? taskDir;
  const slug = base.replace(/^\d{3}-/, "").replaceAll("-", " ").trim();
  return slug ? slug.replace(/\b\w/g, (char) => char.toUpperCase()) : base;
}

function normalizeTaskId(id?: string): string | undefined {
  const raw = id?.trim();
  if (!raw) return undefined;

  const upper = raw.toUpperCase();
  if (/^T\d{3,}$/.test(upper)) return upper;
  if (/^\d+$/.test(upper)) return `T${upper.padStart(3, "0")}`;
  return upper;
}

function isDoneTaskToken(token: string): boolean {
  return /^(?:T\d{3,}|\d+)$/i.test(token);
}

interface ParsedDoneArgs {
  ids: string[];
  note?: string;
}

function parseTaskDoneArgs(input: string): ParsedDoneArgs {
  const tokens = input
    .trim()
    .replaceAll(",", " ")
    .split(/\s+/)
    .filter(Boolean);

  const ids: string[] = [];
  const noteTokens: string[] = [];
  let readingIds = true;

  for (const token of tokens) {
    const cleaned = token.replace(/^[([{"'`]+|[)\]},.;:!]+$/g, "");
    if (readingIds && isDoneTaskToken(cleaned)) {
      const normalized = normalizeTaskId(cleaned);
      if (normalized && !ids.includes(normalized)) ids.push(normalized);
      continue;
    }

    readingIds = false;
    noteTokens.push(token);
  }

  return { ids, note: noteTokens.join(" ").trim() || undefined };
}

async function hydrateTaskState(cwd: string, taskDir: string): Promise<TaskState | undefined> {
  if (!(await isTaskDir(cwd, taskDir))) return undefined;

  const specPath = resolve(cwd, taskDir, "spec.md");
  const planPath = resolve(cwd, taskDir, "plan.md");
  const tasksPath = resolve(cwd, taskDir, "tasks.md");
  const [specText, planExists, tasksText] = await Promise.all([
    (await exists(specPath)) ? readFile(specPath, "utf8") : Promise.resolve(""),
    exists(planPath),
    (await exists(tasksPath)) ? readFile(tasksPath, "utf8") : Promise.resolve(""),
  ]);

  const tasks = tasksText ? parseTasks(tasksText) : [];
  let phase: Phase;
  if (tasks.length > 0) {
    phase = tasks.every((task) => task.status === "done") ? "review" : "implement";
  } else {
    phase = planExists ? "plan" : "spec";
  }

  let workflowMode: TaskWorkflowMode = "normal";
  if (specText.includes("<!-- workflowMode: tdd -->")) {
    workflowMode = "tdd";
  } else if (specText.includes("<!-- workflowMode: grill-me -->")) {
    workflowMode = "grill-me";
  }

  return {
    name: inferTaskName(taskDir, specText || undefined),
    taskDir,
    phase,
    branch: branchNameFromTaskDir(taskDir),
    workflowMode,
    planApproved: tasks.length > 0,
    tasks,
  };
}

async function setCurrentTask(cwd: string, taskDir: string): Promise<void> {
  const tasksPath = resolve(cwd, TASKS_DIR);
  await mkdir(tasksPath, { recursive: true });
  await writeFile(join(tasksPath, CURRENT_FILE), `${taskDir}\n`, "utf8");
}

async function clearCurrentTask(cwd: string): Promise<void> {
  const currentPath = resolve(cwd, TASKS_DIR, CURRENT_FILE);
  if (!(await exists(currentPath))) return;
  const { unlink } = await import("node:fs/promises");
  await unlink(currentPath);
}

async function getCurrentTaskDir(cwd: string): Promise<string | undefined> {
  const currentPath = resolve(cwd, TASKS_DIR, CURRENT_FILE);
  if (!(await exists(currentPath))) return undefined;
  const value = (await readFile(currentPath, "utf8")).trim();
  return value || undefined;
}

async function loadState(cwd: string, taskRef?: string): Promise<TaskState | undefined> {
  const dir = taskRef ? await resolveTaskDirRef(cwd, taskRef) : await getCurrentTaskDir(cwd);
  if (!dir) return undefined;

  return hydrateTaskState(cwd, dir);
}

function specTemplate(name: string, modeComment = ""): string {
  return `${modeComment}# ${name}\n\n## Objective\n- TBD\n\n## User stories\n- As a <user>, I want <capability>, so that <outcome>.\n\n## Scope\n### In scope\n- TBD\n\n### Out of scope\n- TBD\n\n## Requirements\n- TBD\n\n## Test cases\n- TBD\n\n## Validation / tests\n- TBD\n\n## Acceptance criteria\n- [ ] TBD\n\n## Open questions\n- TBD\n`;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function sectionBody(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => new RegExp(String.raw`^##\s+${escapeRegExp(heading)}\s*$`).test(line));
  if (startIndex < 0) return "";

  const body: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (/^##\s+/.test(line)) break;
    body.push(line);
  }

  return body.join("\n").trim();
}

function extractListItems(section: string): string[] {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").replace(/^\[xX\]\s+/, ""))
    .filter((line) => Boolean(line) && line !== "TBD");
}

function shortenText(text: string, max = 72): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function taskWorkflowModeLabel(mode: TaskWorkflowMode): string {
  switch (mode) {
    case "tdd":
      return "Test-driven feature";
    case "grill-me":
      return "Grill me";
    default:
      return "Normal feature";
  }
}

function taskIntakeModeLabel(mode: TaskWorkflowMode): string {
  switch (mode) {
    case "tdd": return "test-driven";
    case "grill-me": return "short follow-up";
    default: return "lightweight";
  }
}

function taskIntakeSummary(name: string, workflowMode: TaskWorkflowMode, clarifications: string[] = []): string {
  const intro = `I'll brainstorm the ${taskIntakeModeLabel(workflowMode)} spec for this task.`;

  return [
    `Task: ${name}`,
    `Mode: ${taskWorkflowModeLabel(workflowMode)}`,
    intro,
    "Template spec.md and plan.md will be created. We'll fill spec.md first, then use /task-plan to refine the plan. Finally /task-approve derives the task list.",
    ...(clarifications.length ? ["", "Approved clarifications:", ...clarifications.map((item) => `- ${item}`)] : []),
  ].join("\n");
}

function buildTaskNewPrompt(state: TaskState, clarifications: string[] = []): string {
  const noteBlock = clarifications.length
    ? [`Approved clarifications:`, ...clarifications.map((item) => `- ${item}`), ""].join("\n")
    : "";

  const base = `Spec and plan templates were created in ${state.taskDir}/. Walk through the spec with the user — ask about the goal, scope, and any edge cases. Fill the spec.md from the discussion. When the spec is settled, tell the user to run /task-plan to brainstorm and refine the plan.`;

  if (state.workflowMode === "tdd") {
    return `${noteBlock}${base} For test cases, discuss "Input -> Expect" format so the plan can reference them.`;
  }

  return `${noteBlock}${base}`;
}

function planTemplate(name: string): string {
  return `# ${name} Plan\n\n> Generated from the approved spec. Revise only if the spec changes.\n\n## Approach\n- TBD\n\n## Dependencies\n- TBD\n\n## Implementation strategy\n1. TBD\n\n## Validation strategy\n- TBD\n\n## Risks\n- TBD\n`;
}

function renderTasksFromPlan(name: string, planText: string): string {
  const approach = extractListItems(sectionBody(planText, "Approach"));
  const dependencies = extractListItems(sectionBody(planText, "Dependencies")).filter((item) => item !== "No explicit dependencies listed in the spec.");
  const implementationSteps = extractListItems(sectionBody(planText, "Implementation strategy"));
  const validationSteps = extractListItems(sectionBody(planText, "Validation strategy"));
  const risks = extractListItems(sectionBody(planText, "Risks")).filter((item) => item !== "Scope may need refinement if the approved spec is underspecified.");

  const workItems = implementationSteps.length ? implementationSteps : approach;
  const tasks: string[] = [];
  let nextTaskNumber = 1;
  const nextId = () => `T${formatNumber(nextTaskNumber++)}`;

  tasks.push(`- [ ] ${nextId()} Confirm the approved plan and implementation approach`);

  if (dependencies.length) {
    tasks.push(`- [ ] ${nextId()} Resolve dependency: ${shortenText(dependencies[0])}`);
  }

  workItems.forEach((item) => {
    tasks.push(`- [ ] ${nextId()} Implement plan step: ${shortenText(item)}`);
  });

  if (validationSteps.length) {
    const validationStep = validationSteps[0].replace(/^Validate\s+/i, "");
    tasks.push(`- [ ] ${nextId()} Validate: ${shortenText(validationStep)}`);
  } else {
    tasks.push(`- [ ] ${nextId()} Validate the implementation and record results`);
  }

  if (risks.length) {
    tasks.push(`- [ ] ${nextId()} Address risk: ${shortenText(risks[0])}`);
  }

  return [
    `# ${name} Tasks`,
    "",
    "> Generated from the approved plan. Use stable task ids and mark progress with `taskflow` or `/task-done`.",
    "> Format: `- [ ] T001 [P] Optional parallel marker and task text`",
    "",
    "## Implementation",
    ...tasks,
    "",
  ].join("\n");
}

function parseTasks(markdown: string): TaskItem[] {
  const tasks: TaskItem[] = [];
  const pattern = /^- \[([ xX])\]\s+(T\d{3,})\s+(\[P\]\s+)?(.+)$/gm;

  for (const match of markdown.matchAll(pattern)) {
    tasks.push({
      id: match[2],
      title: match[4].trim(),
      status: match[1].toLowerCase() === "x" ? "done" : "pending",
      parallel: Boolean(match[3]),
    });
  }

  return tasks;
}

async function syncTaskCheckbox(cwd: string, state: TaskState, id: string): Promise<void> {
  const tasksPath = resolve(cwd, state.taskDir, "tasks.md");
  if (!(await exists(tasksPath))) return;

  await withFileMutationQueue(tasksPath, async () => {
    const current = await readFile(tasksPath, "utf8");
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const next = current.replace(new RegExp(String.raw`^- \[ \] ${escapedId} `, "m"), String.raw`- [x] ${id} `);
    if (next !== current) await writeFile(tasksPath, next, "utf8");
  });
}

function nextItems(state: TaskState, limit = 3): TaskItem[] {
  const inProgress = state.tasks.filter((task) => task.status === "in_progress");
  if (inProgress.length) return inProgress.slice(0, limit);
  return state.tasks.filter((task) => task.status === "pending").slice(0, limit);
}

function formatState(state: TaskState): string {
  const done = state.tasks.filter((task) => task.status === "done").length;
  const total = state.tasks.length;
  const next = nextItems(state, 3);
  return [
    `Task #: ${taskNumberFromDir(state.taskDir)}`,
    `Name: ${state.name}`,
    `Mode: ${taskWorkflowModeLabel(state.workflowMode)}`,
    `Dir: ${state.taskDir}`,
    `Phase: ${state.phase}${state.planApproved ? " (approved)" : ""}`,
    `Branch: ${state.branch}`,
    `Progress: ${done}/${total}`,
    "",
    "Next:",
    ...(next.length ? next.map((task) => `- ${task.id}: ${task.title}`) : ["- none"]),
  ].join("\n");
}

function compactContext(state: TaskState): string {
  const next = nextItems(state, 3).map((task) => `- ${task.id}: ${task.title}`).join("\n") || "- none";
  const done = state.tasks.filter((task) => task.status === "done").length;
  return `[TASKFLOW]\nTask #: ${taskNumberFromDir(state.taskDir)}\nName: ${state.name}\nMode: ${taskWorkflowModeLabel(state.workflowMode)}\nDir: ${state.taskDir}\nPhase: ${state.phase}\nPlan approved: ${state.planApproved}\nProgress: ${done}/${state.tasks.length}\nSuggested branch: ${state.branch}\nNext steps:\n${next}\n\nRules:\n- Use /task-run when you want the whole task completed end-to-end.\n- Use /task-next only for a single slice.\n- Do not rewrite spec/plan/tasks during implementation unless the user explicitly asks.\n- Use the taskflow tool or /task-done to mark completed task ids.\n- Normal mode: spec only when the task is big.\n- TDD mode: keep test cases in input -> expect form before code.\n- Grill-me mode: ask short batches until you are confident.`;
}

function autonomousContext(state: TaskState): string {
  const done = state.tasks.filter((task) => task.status === "done").length;
  const remaining = state.tasks.filter((task) => task.status !== "done");
  const worklist = remaining.length
    ? remaining.map((task) => `- ${task.id}: ${task.title} [${task.status}]`).join("\n")
    : "- none";
  return `[TASKFLOW]\nTask #: ${taskNumberFromDir(state.taskDir)}\nName: ${state.name}\nMode: ${taskWorkflowModeLabel(state.workflowMode)}\nDir: ${state.taskDir}\nPhase: ${state.phase}\nPlan approved: ${state.planApproved}\nProgress: ${done}/${state.tasks.length}\nSuggested branch: ${state.branch}\nRemaining work:\n${worklist}\n\nRules:\n- Execute the task end-to-end, not slice-by-slice.\n- Use ${state.taskDir}/tasks.md as the source of truth.\n- Use the taskflow tool or /task-done to mark each finished task id as you complete it.\n- Keep going until all items are done, then validate and summarize the result.\n- Normal mode: spec only when the task is big.\n- TDD mode: keep test cases in input -> expect form before code.\n- Grill-me mode: ask short batches until you are confident.`;
}

async function createTask(cwd: string, rawName: string, workflowMode: TaskWorkflowMode): Promise<TaskState> {
  const name = rawName.trim();
  if (!name) throw new Error("Task name is required");

  const taskDir = `${TASKS_DIR}/${formatNumber(await nextTaskNumber(cwd))}-${slugify(name)}`;
  const absDir = resolve(cwd, taskDir);
  await mkdir(absDir, { recursive: true });

  const absSpec = resolve(absDir, "spec.md");
  const absPlan = resolve(absDir, "plan.md");
  if (!(await exists(absSpec))) {
    const modeComment = workflowMode === "normal" ? "" : `<!-- workflowMode: ${workflowMode} -->\n\n`;
    await writeFile(absSpec, specTemplate(name, modeComment), "utf8");
  }
  if (!(await exists(absPlan))) {
    await writeFile(absPlan, planTemplate(name), "utf8");
  }

  await setCurrentTask(cwd, taskDir);
  return {
    name,
    taskDir,
    phase: "spec",
    branch: branchNameFromTaskDir(taskDir),
    workflowMode,
    planApproved: false,
    tasks: [],
  };
}

async function approveTask(cwd: string, state: TaskState): Promise<TaskState> {
  const planPath = resolve(cwd, state.taskDir, "plan.md");
  const tasksPath = resolve(cwd, state.taskDir, "tasks.md");
  const planText = await readFile(planPath, "utf8");
  const tasksText = renderTasksFromPlan(state.name, planText);

  await withFileMutationQueue(tasksPath, async () => {
    await writeFile(tasksPath, tasksText, "utf8");
  });

  const parsed = parseTasks(tasksText);
  if (parsed.length === 0) {
    throw new Error(`Generated no task rows for ${relative(cwd, tasksPath)}`);
  }

  return {
    ...state,
    tasks: parsed,
    planApproved: true,
    phase: "implement",
  };
}

interface MarkDoneResult {
  state: TaskState;
  requestedIds: string[];
  completed: string[];
  alreadyDone: string[];
  missing: string[];
}

async function markDone(cwd: string, state: TaskState, ids?: string[], note?: string): Promise<MarkDoneResult> {
  const requestedIds = ids?.length
    ? [...new Set(ids.map((id) => normalizeTaskId(id)).filter((id): id is string => Boolean(id)))]
    : nextItems(state, 1)
        .map((item) => item.id)
        .filter((id): id is string => Boolean(id));

  if (!requestedIds.length) throw new Error("No pending task to mark done");

  const completed: string[] = [];
  const alreadyDone: string[] = [];
  const missing: string[] = [];
  const noteText = note?.trim();

  for (const [index, targetId] of requestedIds.entries()) {
    const task = state.tasks.find((item) => item.id.toLowerCase() === targetId.toLowerCase());
    if (!task) {
      missing.push(targetId);
      continue;
    }

    if (task.status === "done") {
      alreadyDone.push(targetId);
      continue;
    }

    task.status = "done";
    if (noteText && index === requestedIds.length - 1) {
      task.notes = [...(task.notes ?? []), noteText];
    }

    await syncTaskCheckbox(cwd, state, task.id);
    completed.push(task.id);
  }

  const fresh = await hydrateTaskState(cwd, state.taskDir);
  return {
    state: fresh ?? state,
    requestedIds,
    completed,
    alreadyDone,
    missing,
  };
}

function formatDoneSummary(result: MarkDoneResult): string {
  const lines = result.requestedIds.map((id) => {
    if (result.completed.includes(id)) return `Marked ${id} done.`;
    if (result.alreadyDone.includes(id)) return `Task ${id} was already done.`;
    return `Task ${id} not found.`;
  });

  return lines.length ? lines.join("\n") : "No task ids supplied.";
}

function isProtectedTaskPath(cwd: string, filePath: string, state?: TaskState): boolean {
  if (!state?.planApproved) return false;
  const abs = resolve(cwd, filePath.replace(/^@/, ""));
  const rel = relative(cwd, abs).replaceAll("\\", "/");
  if (!rel.startsWith(`${state.taskDir}/`)) return false;
  return rel.endsWith("/plan.md") || rel.endsWith("/tasks.md") || rel.endsWith("/spec.md");
}

async function gitOutput(pi: ExtensionAPI, args: string[]): Promise<string> {
  const result = await pi.exec("git", args, { timeout: 8000 });
  return (result.stdout || result.stderr || "").trim();
}

export default function taskflow(pi: ExtensionAPI) {
  pi.registerTool({
    name: "taskflow",
    label: "Taskflow",
    description: "Read or update the current spec-driven task state without loading full task files.",
    promptSnippet: "Manage interactive task intake modes, compact task state, and autonomous end-to-end runs.",
    promptGuidelines: [
      "Use taskflow to read or update task progress instead of rewriting task markdown during implementation.",
      "Use /task-new as the interactive intake: creates template spec.md and plan.md, fills spec.md from discussion, then tells the user to run /task-plan.",
      "Use /task-plan to brainstorm and refine plan.md before approving.",
      "Use taskflow action approve to derive the task list from the approved plan.",
      "Use taskflow action run for end-to-end execution and taskflow action next only for a single slice.",
      "Use taskflow action done after completing one or more stable task ids.",
    ],
    parameters: TaskflowParams,
    async execute(_toolCallId: unknown, params: TaskflowToolParams, _signal: unknown, _onUpdate: unknown, ctx: ExtensionContext) {
      const state = await loadState(ctx.cwd);
      if (!state) throw new Error("No current taskflow task. Run /task-new <name> first.");

      if (params.action === "approve") {
        const approved = await approveTask(ctx.cwd, state);
        return { content: [{ type: "text", text: `Derived tasks from the approved plan.\n\n${formatState(approved)}` }], details: approved };
      }

      if (params.action === "done") {
        const parsed = parseTaskDoneArgs(params.id ?? "");
        const note = [parsed.note, params.note?.trim()].filter(Boolean).join(" ").trim() || undefined;
        const result = await markDone(ctx.cwd, state, parsed.ids, note);
        return { content: [{ type: "text", text: `${formatDoneSummary(result)}\n\n${formatState(result.state)}` }], details: result };
      }

      if (params.action === "next") {
        return { content: [{ type: "text", text: compactContext(state) }], details: { next: nextItems(state) } };
      }

      if (params.action === "run") {
        if (!state.planApproved) {
          return { content: [{ type: "text", text: "Approve the task first with /task-approve." }], details: { approved: false } };
        }
        return { content: [{ type: "text", text: autonomousContext(state) }], details: { run: state.tasks } };
      }

      if (params.action === "branch") {
        return { content: [{ type: "text", text: state.branch }], details: { branch: state.branch } };
      }

      if (params.action === "pr_context") {
        const status = await gitOutput(pi, ["status", "-sb"]);
        const statText = await gitOutput(pi, ["diff", "--stat"]);
        const text = `${formatState(state)}\n\nGit status:\n${status}\n\nDiff stat:\n${statText || "No unstaged diff"}`;
        return { content: [{ type: "text", text }], details: { state, status, stat: statText } };
      }

      return { content: [{ type: "text", text: formatState(state) }], details: state };
    },
  });

  pi.registerCommand("task-new", {
    description: "Create an interactive task intake flow",
    handler: async (args: string, ctx: ExtensionContext) => {
      const modeChoice = await ctx.ui.select("Choose task workflow mode", ["Normal feature", "Test-driven feature", "Grill me"]);
      if (!modeChoice) {
        ctx.ui.notify("Task creation cancelled.", "warning");
        return;
      }

      const nameInput = await ctx.ui.input("Feature or bug name", args.trim() || "");
      if (nameInput === undefined) {
        ctx.ui.notify("Task creation cancelled.", "warning");
        return;
      }

      const name = nameInput.trim();
      if (!name) {
        ctx.ui.notify("Task name is required.", "warning");
        return;
      }

      let workflowMode: TaskWorkflowMode;
      if (modeChoice === "Test-driven feature") {
        workflowMode = "tdd";
      } else if (modeChoice === "Grill me") {
        workflowMode = "grill-me";
      } else {
        workflowMode = "normal";
      }
      const reviewNotes: string[] = [];

      while (true) {
        const confirmed = await ctx.ui.confirm("Review spec and plan before creation", taskIntakeSummary(name, workflowMode, reviewNotes));

        if (confirmed) break;

        const noteInput = await ctx.ui.input("What should change before I create the spec and plan?", "");
        if (noteInput === undefined) {
          ctx.ui.notify("Task creation cancelled.", "warning");
          return;
        }

        const note = noteInput.trim();
        if (!note) {
          ctx.ui.notify("Please describe what to change or cancel.", "warning");
          continue;
        }

        reviewNotes.push(note);
      }

      const state = await createTask(ctx.cwd, name, workflowMode);
      pi.setSessionName(`${taskNumberFromDir(state.taskDir)} ${state.name}`);
      pi.sendMessage({ customType: "taskflow", content: `Created taskflow task.\n\n${formatState(state)}`, display: true }, { triggerTurn: false });
      ctx.ui.setEditorText(buildTaskNewPrompt(state, reviewNotes));
    },
  });

  pi.registerCommand("task-current", {
    description: "Set current task by number or path (usage: /task-current 001)",
    handler: async (args: string, ctx: ExtensionContext) => {
      const taskRef = args.trim();
      if (!taskRef) {
        ctx.ui.notify("Usage: /task-current 001", "warning");
        return;
      }
      const state = await loadState(ctx.cwd, taskRef);
      if (!state) {
        ctx.ui.notify(`No state found for ${taskRef}`, "error");
        return;
      }
      await setCurrentTask(ctx.cwd, state.taskDir);
      pi.setSessionName(`${taskNumberFromDir(state.taskDir)} ${state.name}`);
      pi.sendMessage({ customType: "taskflow", content: `Current task set.\n\n${formatState(state)}`, display: true }, { triggerTurn: false });
    },
  });

  pi.registerCommand("task-status", {
    description: "Show compact current task state",
    handler: async (_args: unknown, ctx: ExtensionContext) => {
      const state = await loadState(ctx.cwd);
      pi.sendMessage({ customType: "taskflow", content: state ? formatState(state) : "No current taskflow task.", display: true }, { triggerTurn: false });
    },
  });

  pi.registerCommand("task-approve", {
    description: "Derive task list from the approved plan.md and enter implementation mode",
    handler: async (_args: unknown, ctx: ExtensionContext) => {
      const state = await loadState(ctx.cwd);
      if (!state) return ctx.ui.notify("No current taskflow task.", "error");
      const approved = await approveTask(ctx.cwd, state);
      pi.sendMessage({ customType: "taskflow", content: `Derived tasks from the approved plan.\n\n${formatState(approved)}`, display: true }, { triggerTurn: false });
    },
  });

  pi.registerCommand("task-plan", {
    description: "Open an interactive plan brainstorming session that writes plan.md",
    handler: async (_args: unknown, ctx: ExtensionContext) => {
      const state = await loadState(ctx.cwd);
      if (!state) return ctx.ui.notify("No current taskflow task.", "error");
      if (state.planApproved) return ctx.ui.notify("Plan is already approved. Use /task-revise if you need to change it.", "warning");

      pi.sendMessage({ customType: "taskflow", content: compactContext(state), display: true }, { triggerTurn: false });

      const prompt = [
        `Planning ${state.name}. The plan.md template is at ${state.taskDir}/plan.md.`,
        "",
        "Brainstorm the approach with the user — ask about implementation details, dependencies, validation strategy, and risks. Refine plan.md together. When the plan is settled, run /task-approve to generate tasks from it.",
      ].join("\n");

      ctx.ui.setEditorText(prompt);
    },
  });

  pi.registerCommand("task-revise", {
    description: "Explicitly reopen the current task for spec/plan/task revision",
    handler: async (_args: unknown, ctx: ExtensionContext) => {
      const state = await loadState(ctx.cwd);
      if (!state) return ctx.ui.notify("No current taskflow task.", "error");
      const tasksPath = resolve(ctx.cwd, state.taskDir, "tasks.md");
      if (await exists(tasksPath)) {
        const { unlink } = await import("node:fs/promises");
        await unlink(tasksPath);
      }
      const updated = (await hydrateTaskState(ctx.cwd, state.taskDir)) ?? state;
      pi.sendMessage({ customType: "taskflow", content: `Task reopened for revision.\n\n${formatState(updated)}`, display: true }, { triggerTurn: false });
    },
  });

  pi.registerCommand("task-next", {
    description: "Prepare the next implementation prompt from compact task state",
    handler: async (_args: unknown, ctx: ExtensionContext) => {
      const state = await loadState(ctx.cwd);
      if (!state) return ctx.ui.notify("No current taskflow task.", "error");
      const next = nextItems(state, 1)[0];
      if (!next) {
        pi.sendMessage({ customType: "taskflow", content: "No pending taskflow tasks.", display: true }, { triggerTurn: false });
        return;
      }
      const prompt = `Implement ${next.id}: ${next.title}\n\nUse ${state.taskDir} as source of truth. Do not rewrite the plan. Validate the change, then mark ${next.id} done with taskflow.`;
      pi.sendMessage({ customType: "taskflow", content: compactContext(state), display: true }, { triggerTurn: false });
      ctx.ui.setEditorText(prompt);
    },
  });

  pi.registerCommand("task-run", {
    description: "Prepare an end-to-end implementation prompt for the full task",
    handler: async (_args: unknown, ctx: ExtensionContext) => {
      const state = await loadState(ctx.cwd);
      if (!state) return ctx.ui.notify("No current taskflow task.", "error");
      if (!state.planApproved) return ctx.ui.notify("Approve the task first with /task-approve.", "warning");
      const prompt = `Complete ${state.name} end-to-end using ${state.taskDir} as the source of truth.\n\nWork through the remaining checklist items without stopping after each slice. Read the task file, make the required code/config changes, validate the result, and use taskflow /task-done for each completed task id as you finish it. When everything is done, summarize the outcome for review.`;
      pi.sendMessage({ customType: "taskflow", content: autonomousContext(state), display: true }, { triggerTurn: false });
      ctx.ui.setEditorText(prompt);
    },
  });

  pi.registerCommand("task-done", {
    description: "Mark taskflow tasks done (usage: /task-done T001 T002 [note] or /task-done 001 002 [note])",
    handler: async (args: string, ctx: ExtensionContext) => {
      const state = await loadState(ctx.cwd);
      if (!state) return ctx.ui.notify("No current taskflow task.", "error");
      const parsed = parseTaskDoneArgs(args);
      const result = await markDone(ctx.cwd, state, parsed.ids, parsed.note);
      pi.sendMessage({ customType: "taskflow", content: `${formatDoneSummary(result)}\n\n${formatState(result.state)}`, display: true }, { triggerTurn: false });
    },
  });

  pi.registerCommand("task-detach", {
    description: "Clear the current task and reset session to generic state",
    handler: async (_args: unknown, ctx: ExtensionContext) => {
      const state = await loadState(ctx.cwd);
      if (!state) return ctx.ui.notify("No current taskflow task to detach from.", "warning");
      await clearCurrentTask(ctx.cwd);
      pi.setSessionName("");
      pi.sendMessage({ customType: "taskflow", content: `Detached from task ${taskNumberFromDir(state.taskDir)} ${state.name}.\n\nTask folder preserved at ${state.taskDir}. Reattach anytime with /task-current ${taskNumberFromDir(state.taskDir)}.`, display: true }, { triggerTurn: false });
    },
  });

  pi.registerCommand("task-branch", {
    description: "Show or create the suggested task branch (usage: /task-branch [--create])",
    handler: async (args: string, ctx: ExtensionContext) => {
      const state = await loadState(ctx.cwd);
      if (!state) return ctx.ui.notify("No current taskflow task.", "error");
      if (!args.includes("--create")) {
        pi.sendMessage({ customType: "taskflow", content: `Suggested branch: ${state.branch}`, display: true }, { triggerTurn: false });
        return;
      }
      if (ctx.hasUI) {
        const ok = await ctx.ui.confirm("Create task branch?", `Run git checkout -b ${state.branch}?`);
        if (!ok) return;
      }
      const result = await pi.exec("git", ["checkout", "-b", state.branch], { timeout: 10000 });
      pi.sendMessage({ customType: "taskflow", content: result.stdout || result.stderr || `Created ${state.branch}`, display: true }, { triggerTurn: false });
    },
  });

  pi.registerCommand("task-pr", {
    description: "Prepare a PR drafting prompt from current task state and git context",
    handler: async (_args: unknown, ctx: ExtensionContext) => {
      const state = await loadState(ctx.cwd);
      if (!state) return ctx.ui.notify("No current taskflow task.", "error");
      const status = await gitOutput(pi, ["status", "-sb"]);
      const statText = await gitOutput(pi, ["diff", "--stat"]);
      const prompt = `Draft a review-ready PR for ${state.name}.\n\nTask context:\n${formatState(state)}\n\nGit status:\n${status}\n\nDiff stat:\n${statText || "No unstaged diff"}\n\nUse repository PR template if one exists. Include summary, scope, testing, reviewer focus, risks, and out-of-scope items.`;
      ctx.ui.setEditorText(prompt);
    },
  });

  pi.on("before_agent_start", async (_event: unknown, ctx: ExtensionContext) => {
    const state = await loadState(ctx.cwd);
    if (!state) return;
    return {
      message: {
        customType: "taskflow-context",
        content: compactContext(state),
        display: false,
      },
    };
  });

  pi.on("tool_call", async (event: TaskflowToolCallEvent, ctx: ExtensionContext) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    const input = event.input;
    const path = typeof input.path === "string" ? input.path : undefined;
    if (!path) return;

    const state = await loadState(ctx.cwd);
    if (!isProtectedTaskPath(ctx.cwd, path, state)) return;

    if (!ctx.hasUI) {
      return { block: true, reason: "Taskflow blocks task spec/plan/tasks rewrites after approval. Run /task-revise first." };
    }

    const ok = await ctx.ui.confirm(
      "Revise approved task?",
      `Taskflow is in implementation mode. Allow editing ${path}?\n\nPrefer executing the current task instead of rewriting the plan.`,
    );
    if (!ok) {
      return { block: true, reason: "Taskflow blocked approved task rewrite. Use /task-revise to reopen planning." };
    }
  });
}
