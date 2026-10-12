import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

try {
  const prompt = await readFile("prompts/plan.md", "utf8");

  assert.match(prompt, /Turn an approved spec into an implementation plan/i);
  assert.match(prompt, /Use `tasks\/\$1\.md` as the source of truth\./i);
  assert.match(prompt, /ordered steps with dependencies and verification points/i);
  assert.match(prompt, /carry them into the plan before implementation steps/i);
  assert.match(prompt, /stay out of scope/i);
  assert.match(prompt, /plan actionable and short/i);

  console.log("plan prompt ok");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
