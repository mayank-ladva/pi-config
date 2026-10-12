import assert from "node:assert/strict";
import askGuard, { isReadOnlySqlCommand, isRiskyCtxExecute, isRiskySqlCommand } from "../extensions/ask-guard.ts";

assert.equal(isReadOnlySqlCommand(`psql -c "SELECT * FROM users"`), true);
assert.equal(isReadOnlySqlCommand(`sqlite3 app.db 'SELECT 1; SELECT 2'`), true);
assert.equal(isReadOnlySqlCommand(`mysql -e "UPDATE users SET active = 0"`), false);
assert.equal(isReadOnlySqlCommand(`psql -c "SELECT 1; DELETE FROM users"`), false);
assert.equal(isReadOnlySqlCommand(`sql -c "ALTER TABLE users ADD name TEXT"`), false);
assert.equal(isReadOnlySqlCommand(`psql`), false);
assert.equal(isReadOnlySqlCommand(`sqlit query -c local -q "SELECT * FROM users"`), true);
assert.equal(isReadOnlySqlCommand(`sqlit query -c local -q "DELETE FROM users"`), false);
assert.equal(isReadOnlySqlCommand(`sqlit query -c local -f changes.sql`), false);
assert.equal(isRiskySqlCommand(`git commit -m "feat(db): add SQL Server migration baseline"`), false);
assert.equal(isRiskySqlCommand(`psql -c "DELETE FROM users"`), true);
assert.equal(isRiskySqlCommand(`sqlit query -c local -q "SELECT 1"; sqlit query -c local -q "DROP TABLE users"`), true);
assert.equal(isRiskyCtxExecute({ language: "shell", code: `sqlit query -c local -q "DELETE FROM users"` }), true);
assert.equal(isRiskyCtxExecute({ language: "python", code: `import shutil; shutil.rmtree(path)` }), true);
assert.equal(isRiskyCtxExecute({ language: "python", code: `connection.execute("SELECT * FROM users")` }), false);
assert.equal(isRiskyCtxExecute({ language: "javascript", code: `console.log("hello")` }), false);
for (const sql of [
  "UPDATE users SET active = 0",
  "ALTER TABLE users ADD name TEXT",
  "DROP TABLE users",
  "TRUNCATE TABLE users",
  "CREATE TABLE users (id INT)",
  "DELETE FROM users",
  "INSERT INTO users VALUES (1)",
  "MERGE INTO users USING staging ON users.id = staging.id",
  "GRANT ALL ON users TO guest",
  "EXEC delete_all_users",
  "SELECT * INTO backup FROM users",
]) {
  assert.equal(isRiskySqlCommand(`sqlit query -c local -q "${sql}"`), true, sql);
  assert.equal(isRiskyCtxExecute({ code: `connection.execute("${sql}")` }), true, sql);
}
assert.equal(isRiskyCtxExecute({ code: `connection.execute(query)` }), true);
assert.equal(isRiskyCtxExecute({ code: `connection.execute("SELECT 1"); connection.execute(query)` }), true);
assert.equal(isRiskyCtxExecute({ code: `sqlit query -c local -f migration.sql` }), true);
assert.equal(isRiskyCtxExecute({ code: `sqlit query -c local -q "SELECT 1"` }), false);

let onToolCall: ((event: any, ctx: any) => Promise<any>) | undefined;
askGuard({ on: (_event: string, handler: any) => { onToolCall = handler; } } as any);
assert.ok(onToolCall);
const prompts: string[] = [];
const blocked = await onToolCall(
  { toolName: "ctx_execute", input: { language: "python", code: "shutil.rmtree(path)" } },
  { hasUI: true, ui: { confirm: async (title: string) => { prompts.push(title); return false; } } },
);
assert.deepEqual(blocked, { block: true, reason: "Blocked risky ctx_execute code" });
assert.deepEqual(prompts, ["Risky code execution"]);

console.log("ask guard SQL checks ok");
