import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import taskflow from "../extensions/taskflow.ts";

function makePi() {
  const commands = new Map<string, any>();
  return {
    commands,
    registerTool() {},
    registerCommand(name: string, definition: any) {
      commands.set(name, definition);
    },
    sendMessage() {},
    setSessionName() {},
    on() {},
  };
}

async function setupTask(confirmResponses: boolean[]) {
  const cwd = await mkdtemp(join(tmpdir(), "taskflow-new-"));
  const pi = makePi();
  taskflow(pi as any);

  const taskNew = pi.commands.get("task-new");
  assert(taskNew, "task-new command should be registered");

  const confirmMessages: string[] = [];
  const editorTexts: string[] = [];
  const inputQueue = ["Confirm before creation", "Add a testable summary", "Include follow-up loop notes"];
  const ctx = {
    cwd,
    ui: {
      select: async () => "Normal feature",
      input: async () => inputQueue.shift(),
      confirm: async (_title: string, message: string) => {
        confirmMessages.push(message);
        return confirmResponses.shift() ?? true;
      },
      notify() {},
      setEditorText(text: string) {
        editorTexts.push(text);
      },
    },
  };

  await taskNew.handler("", ctx);

  const taskDirs = await readdir(join(cwd, "tasks"), { withFileTypes: true });
  const taskDir = taskDirs.find((entry) => entry.isDirectory() && /^\d{3}-/.test(entry.name));
  assert(taskDir, "task directory should be created after approval");

  const taskPath = join(cwd, "tasks", taskDir.name);
  return { cwd, taskPath, confirmMessages, editorTexts, pi, ctx };
}

try {
  // --- Phase 1: /task-new creates spec + plan templates ---
  const first = await setupTask([false, false, true]);
  const files = await readdir(first.taskPath);
  assert(!files.includes("state.json"), "state.json should not exist");
  assert(files.includes("spec.md"), "spec.md should exist after task creation");
  assert(files.includes("plan.md"), "plan.md should exist after task creation");

  const specText0 = await readFile(join(first.taskPath, "spec.md"), "utf8");
  assert(!specText0.includes("workflowMode"), "no mode marker for normal mode");

  assert.equal(first.confirmMessages.length, 3, "declines should loop until approval");
  assert.match(first.confirmMessages[0], /Template spec\.md and plan\.md will be created/i);
  assert.match(first.editorTexts[0], /Fill the spec\.md from the discussion/i);
  assert.match(first.editorTexts[0], /\/task-plan/i);

  const specText = await readFile(join(first.taskPath, "spec.md"), "utf8");
  const planText = await readFile(join(first.taskPath, "plan.md"), "utf8");
  assert.match(specText, /## Objective/);
  assert.match(planText, /## Approach/);

  await rm(first.cwd, { recursive: true, force: true });

  // --- Phase 2: Full flow spec → task-plan → task-approve ---
  const second = await setupTask([true]);

  // Write the spec
  const spec = `# Add generic /plan\n\n## Objective\n- Add generic /plan command\n\n## Scope\n### In scope\n- Create the /plan command\n\n## Requirements\n- Capture approved clarifications\n\n## Implementation strategy\n1. Implement the command handler\n2. Wire it into extension setup\n\n## Validation / tests\n- Run taskflow tests\n\n## Acceptance criteria\n- [ ] The command creates a plan\n`;
  await writeFile(join(second.taskPath, "spec.md"), spec, "utf8");

  // Phase 2a: /task-plan — user writes a plan
  const plan = `# Add generic /plan Plan\n\n## Approach\n- Build a simple /plan command\n\n## Dependencies\n- None\n\n## Implementation strategy\n1. Create the command handler\n2. Register it in the extension\n3. Test the flow\n\n## Validation strategy\n- Run the existing taskflow tests\n\n## Risks\n- Minimal\n`;
  await writeFile(join(second.taskPath, "plan.md"), plan, "utf8");

  // Phase 2b: /task-approve derives tasks from plan
  const taskApprove = second.pi.commands.get("task-approve");
  assert(taskApprove, "task-approve command should be registered");

  await taskApprove.handler("", second.ctx);

  const tasksMd = await readFile(join(second.taskPath, "tasks.md"), "utf8");
  assert.match(tasksMd, /Generated from the approved plan/i);
  assert.match(tasksMd, /T001 Confirm the approved plan and implementation approach/);
  assert.match(tasksMd, /T003 Implement plan step: Create the command handler/);
  assert.match(tasksMd, /T004 Implement plan step: Register it in the extension/);
  assert.match(tasksMd, /T005 Implement plan step: Test the flow/);
  assert.match(tasksMd, /T006 Validate: Run the existing taskflow tests/);

  // Plan.md should NOT have been overwritten by approve
  const planAfter = await readFile(join(second.taskPath, "plan.md"), "utf8");
  assert.ok(planAfter.includes("Build a simple /plan command"));

  await rm(second.cwd, { recursive: true, force: true });
  console.log("taskflow approval flow ok");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
