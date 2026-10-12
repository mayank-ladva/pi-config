import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const AGENT_FILES = ["AGENTS.md"] as const;
const TEMPLATE_BLOCK = `## context-mode is active
Use \`ctx_*\` tools. The extension injects routing rules — follow them.
`;

type ExistingFileAction = "replace" | "append" | "cancel";

interface InitAgentsContext {
  ui: {
    notify(message: string, level?: string): void;
    select(title: string, options: string[]): Promise<string | undefined>;
  };
}

async function chooseExistingFileAction(ctx: InitAgentsContext, fileName: string): Promise<ExistingFileAction> {
  const replaceLabel = `Replace ${fileName} with the new one`;
  const appendLabel = `Append text to the existing ${fileName}`;
  const choice = await ctx.ui.select(`Update ${fileName}?`, [replaceLabel, appendLabel, "Cancel"]);

  if (choice === replaceLabel) return "replace";
  if (choice === appendLabel) return "append";
  return "cancel";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function resolveAgentsPath(cwd: string): Promise<string> {
  return resolve(cwd, "AGENTS.md");
}

function appendBlock(text: string): string {
  let separator: string;
  if (text.endsWith("\n\n")) {
    separator = "";
  } else if (text.endsWith("\n")) {
    separator = "\n";
  } else {
    separator = "\n\n";
  }
  return `${text}${separator}${TEMPLATE_BLOCK}`;
}

async function runInit(cwd: string, ctx: InitAgentsContext) {
  const agentsPath = await resolveAgentsPath(cwd);
  const fileName = basename(agentsPath);

  if (!(await fileExists(agentsPath))) {
    await writeFile(agentsPath, `${TEMPLATE_BLOCK}\n`, "utf8");
    ctx.ui.notify(`Created ${fileName}`, "info");
    return;
  }

  const current = await readFile(agentsPath, "utf8");
  const choice = await chooseExistingFileAction(ctx, fileName);
  if (choice === "cancel") return;

  if (choice === "replace") {
    await writeFile(agentsPath, `${TEMPLATE_BLOCK}\n`, "utf8");
    ctx.ui.notify(`Replaced ${fileName}`, "info");
    return;
  }

  await writeFile(agentsPath, `${appendBlock(current)}\n`, "utf8");
  ctx.ui.notify(`Appended to ${fileName}`, "info");
}

export default function initAgents(pi: ExtensionAPI) {
  pi.registerCommand("init", {
    description:
      "Create or update AGENTS.md with the context-mode routing block",
    handler: async (_args, ctx) => {
      await runInit(ctx.cwd, ctx);
    },
  });

  pi.registerCommand("init-agents", {
    description: "Alias for /init",
    handler: async (_args, ctx) => {
      await runInit(ctx.cwd, ctx);
    },
  });
}
