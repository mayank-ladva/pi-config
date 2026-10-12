import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const dangerousBash = [
  /\brm\s+(-rf|--recursive)\b/i,
  /\bsudo\b/i,
  /\bchmod\b.*\b777\b/i,
  /\bchown\b.*\b777\b/i,
  /\bgit\s+push\b.*(--force|-f)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\./i,
];

const sqlCli = /(?:^|[;&|\n]\s*)(?:(?:env|command)\s+)*(?:[A-Z_][A-Z0-9_]*=\S+\s+)*(?:\S*\/)?(?:sqlite3|psql|mysql|mariadb|sqlcmd|duckdb|sqlit)\b/i;
const sqlCommandArg = /(?:-c|-e|-Q|--execute|--command|--query(?:=|\s+))\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i;
const sqliteSqlArg = /\bsqlite3\b(?:\s+\S+)?\s+(?:"([^"]*)"|'([^']*)')/i;
const sqlitQueryArg = /\bsqlit\b[\s\S]*?\bquery\b[\s\S]*?(?:--query|-q)\s+(?:"([^"]*)"|'([^']*)')/i;
const mutatingSql = /(?:^|[^.\w])(?:ALTER|UPDATE|CREATE|DELETE|INSERT|DROP|TRUNCATE|REPLACE|MERGE|UPSERT|RENAME|GRANT|REVOKE|EXEC|EXECUTE|CALL|VACUUM|ATTACH|DETACH|PRAGMA|COPY|LOAD|INTO|BEGIN|COMMIT|ROLLBACK)\b/i;
const dbExecution = /\.\s*(?:execute|executemany|executescript|query|raw)\s*\(/gi;
const literalSelectCall = /\.\s*(?:execute|query)\s*\(\s*(?:"([^"]*)"|'([^']*)')\s*\)/gi;
const destructiveCode = /\b(?:shutil\.(?:rmtree|move)|os\.(?:remove|unlink|rmdir)|Path\([^)]*\)\.(?:unlink|rmdir))\s*\(/i;

export function isReadOnlySqlCommand(command: string) {
  if ([...command.matchAll(new RegExp(sqlCli.source, "gi"))].length !== 1) return false;

  const match = /\bsqlit\b/i.test(command)
    ? command.match(sqlitQueryArg)
    : command.match(sqlCommandArg) ?? command.match(sqliteSqlArg);
  const sql = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
  const statements = sql.split(";").map((statement) => statement.trim()).filter(Boolean);
  return statements.length > 0 && statements.every((statement) => /^SELECT\b/i.test(statement) && !mutatingSql.test(statement));
}

export function isRiskySqlCommand(command: string) {
  return sqlCli.test(command) && !isReadOnlySqlCommand(command);
}

export function isRiskyCtxExecute(input: { code?: unknown }) {
  const code = typeof input.code === "string" ? input.code : "";
  const calls = code.match(dbExecution) ?? [];
  const safeCalls = [...code.matchAll(literalSelectCall)];
  return (
    dangerousBash.some((pattern) => pattern.test(code)) ||
    mutatingSql.test(code) ||
    calls.length !== safeCalls.length ||
    safeCalls.some((call) => !/^SELECT\b/i.test((call[1] ?? call[2]).trim())) ||
    (sqlCli.test(code) && !isReadOnlySqlCommand(code)) ||
    destructiveCode.test(code) ||
    (/\bsqlit\b/i.test(code) && /(?:--file|-f)\s+/i.test(code))
  );
}

const sensitivePaths = [
  ".env",
  ".secrets/",
  ".ssh/",
  ".git/",
  "id_rsa",
  ".pem",
  ".key",
  ".secret",
];

async function confirmOrBlock(ctx: any, title: string, message: string) {
  if (!ctx.hasUI) return false;
  return await ctx.ui.confirm(title, message);
}

async function handleBashCall(event: any, ctx: any) {
  const rawCmd = (event.input as { command?: unknown }).command;
  const command = typeof rawCmd === "string" ? rawCmd : "";
  const riskySql = isRiskySqlCommand(command);
  if (riskySql || dangerousBash.some((pattern) => pattern.test(command))) {
    const title = riskySql ? "Risky SQL command" : "Risky command";
    const ok = await confirmOrBlock(ctx, title, `Allow this bash command?

${command}`);
    if (!ok) return { block: true, reason: "Blocked risky bash command" };
  }
}

async function handleCtxExecuteCall(event: any, ctx: any) {
  const input = event.input as { language?: unknown; code?: unknown };
  if (!isRiskyCtxExecute(input)) return;

  const language = typeof input.language === "string" ? input.language : "unknown";
  const code = typeof input.code === "string" ? input.code : "";
  const ok = await confirmOrBlock(ctx, "Risky code execution", `Allow this ${language} code?\n\n${code}`);
  if (!ok) return { block: true, reason: "Blocked risky ctx_execute code" };
}

async function handleEditWriteCall(event: any, ctx: any) {
  const rawPath = (event.input as { path?: unknown }).path;
  const path = typeof rawPath === "string" ? rawPath : "";
  if (sensitivePaths.some((needle) => path.includes(needle))) {
    const ok = await confirmOrBlock(ctx, "Protected path", `Allow editing this path?

${path}`);
    if (!ok) return { block: true, reason: `Protected path blocked: ${path}` };
  }
}

export default function askGuard(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") return handleBashCall(event, ctx);
    if (event.toolName === "ctx_execute") return handleCtxExecuteCall(event, ctx);
    if (event.toolName === "edit" || event.toolName === "write") return handleEditWriteCall(event, ctx);
  });
}
