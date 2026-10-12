#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const DEFAULT_ISSUE_FIELDS = "summary,status,assignee,description,issuetype,priority,labels,parent";
const REQUIRED_ENV = ["JIRA_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"];
const REQUEST_TIMEOUT_MS = 30_000;

const HELP = `Usage: jira.mjs <command> [options]

Read commands:
  doctor (local configuration diagnostics; no network or credential values)
  auth-check
  issue KEY [--fields LIST]
  search --jql JQL [--fields LIST] [--max-results N] [--next-page-token TOKEN]
  create-meta [--project KEY] [--type-id ID] [--start-at N] [--max-results N]
  issue-types [--project KEY]
  assignees [--project KEY | --issue KEY] [--query TEXT] [--max-results N]
  comments KEY [--start-at N] [--max-results N]
  transitions KEY [--fields]
  link-types

Mutation commands (confirm with the user before running):
  create --summary TEXT --type NAME [--project KEY] [--description TEXT | --description-file FILE]
         [--parent KEY] [--account-id ID] [--labels LIST] [--fields-file FILE]
  edit KEY [--summary TEXT] [--description TEXT | --description-file FILE]
         [--labels LIST] [--priority NAME] [--fields-file FILE]
  assign KEY --account-id ID
  comment KEY (--text TEXT | --file FILE)
  transition KEY --id ID [--fields-file FILE]
  link --type NAME --inward KEY --outward KEY [--comment TEXT | --comment-file FILE]

Environment: JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN, and optional JIRA_PROJECT_KEY.
The script loads ./.env from the invocation directory; existing environment values win.
Project-aware commands default to JIRA_PROJECT_KEY; do not source or manually parse .env.
create-meta without --type-id lists types; with --type-id it lists creation fields.
Search needs a restrictive JQL clause, e.g. project = ABC, not just ORDER BY.
Use --fields summary,status,assignee for concise issue/search responses.
Create returns the API fields plus a browser URL in "url"; --account-id assigns at creation.
Requests time out after 30 seconds and are never automatically retried.
After a failed or timed-out mutation, verify server state before retrying.`;

function fail(message) {
  throw new Error(message);
}

export function loadProjectEnv(cwd = process.cwd()) {
  const envFile = resolve(cwd, ".env");
  if (existsSync(envFile)) loadEnvFile(envFile);
  return envFile;
}

export function getConfig(env = process.env) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length) fail(`Missing environment variables: ${missing.join(", ")}`);

  let url;
  try {
    url = new URL(env.JIRA_URL);
  } catch {
    fail("JIRA_URL must be a valid URL");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    fail("JIRA_URL must be an HTTP(S) URL without embedded credentials");
  }

  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    authorization: `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64")}`,
    project: env.JIRA_PROJECT_KEY,
  };
}

function doctor(env, args) {
  const parsed = argsFor(args);
  if (!parsed) return HELP;
  noExtraPositionals(parsed.positionals, 0);
  const envFile = resolve(process.cwd(), ".env");
  let error = null;
  try {
    getConfig(env);
  } catch (cause) {
    error = cause.message;
  }
  return {
    envFile,
    envFileExists: existsSync(envFile),
    variables: Object.fromEntries([...REQUIRED_ENV, "JIRA_PROJECT_KEY"].map((name) => [name, Boolean(env[name])])),
    project: env.JIRA_PROJECT_KEY || null,
    configured: error === null,
    error,
  };
}

function apiError(status, statusText, body) {
  const details = [
    ...(Array.isArray(body?.errorMessages) ? body.errorMessages : []),
    ...Object.entries(body?.errors ?? {}).map(([field, message]) => `${field}: ${message}`),
  ];
  return `Jira API ${status} ${statusText}${details.length ? `: ${details.join("; ")}` : ""}`;
}

export async function jiraRequest(config, pathname, options = {}, fetchImpl = fetch) {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response;
  let text;
  try {
    response = await fetchImpl(new URL(pathname, `${config.baseUrl}/`), {
      ...options,
      signal,
      headers: {
        Accept: "application/json",
        Authorization: config.authorization,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    text = await response.text();
  } catch (error) {
    if (signal.aborted && signal.reason?.name === "TimeoutError") {
      fail("Jira request timed out after 30 seconds. No automatic retry was attempted. For mutations, verify server state before retrying.");
    }
    throw error;
  }
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }
  if (!response.ok) fail(apiError(response.status, response.statusText, body));
  return body ?? { ok: true, status: response.status };
}

export function textToAdf(text) {
  return {
    type: "doc",
    version: 1,
    content: String(text).split(/\r?\n/).map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

function options(extra = {}) {
  return { help: { type: "boolean" }, ...extra };
}

function argsFor(args, extra = {}) {
  const parsed = parseArgs({ args, options: options(extra), allowPositionals: true, strict: true });
  if (parsed.values.help) return null;
  return parsed;
}

function positional(positionals, index, name) {
  const value = positionals[index];
  if (!value) fail(`Missing ${name}`);
  return value;
}

function noExtraPositionals(positionals, count) {
  if (positionals.length > count) fail(`Unexpected argument: ${positionals[count]}`);
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) fail(`${name} must be a non-negative integer`);
  return number;
}

function queryString(values) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

function project(values, config) {
  const key = values.project ?? config.project;
  if (!key) fail("Missing project key: pass --project or set JIRA_PROJECT_KEY");
  return key;
}

function readText(values, textName, fileName, required = false) {
  const text = values[textName];
  const file = values[fileName];
  if (text !== undefined && file !== undefined) fail(`Use either --${textName} or --${fileName}, not both`);
  if (required && text === undefined && file === undefined) fail(`Pass --${textName} or --${fileName}`);
  return file !== undefined ? readFileSync(resolve(file), "utf8") : text;
}

function readObject(file, optionName = "fields-file") {
  if (!file) return {};
  let value;
  try {
    value = JSON.parse(readFileSync(resolve(file), "utf8"));
  } catch (error) {
    fail(`Invalid --${optionName}: ${error.message}`);
  }
  if (!value || Array.isArray(value) || typeof value !== "object") fail(`--${optionName} must contain a JSON object`);
  return value;
}

function commaList(value) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean);
}

function body(fields) {
  return JSON.stringify(fields);
}

async function authCheck(config, args) {
  const parsed = argsFor(args);
  if (!parsed) return HELP;
  noExtraPositionals(parsed.positionals, 0);
  return jiraRequest(config, "/rest/api/3/myself");
}

async function issue(config, args) {
  const parsed = argsFor(args, { fields: { type: "string", default: DEFAULT_ISSUE_FIELDS } });
  if (!parsed) return HELP;
  const key = positional(parsed.positionals, 0, "issue key");
  noExtraPositionals(parsed.positionals, 1);
  return jiraRequest(config, `/rest/api/3/issue/${encodeURIComponent(key)}${queryString({ fields: parsed.values.fields })}`);
}

async function search(config, args) {
  const parsed = argsFor(args, {
    jql: { type: "string" }, fields: { type: "string", default: DEFAULT_ISSUE_FIELDS },
    "max-results": { type: "string" }, "next-page-token": { type: "string" },
  });
  if (!parsed) return HELP;
  noExtraPositionals(parsed.positionals, 0);
  if (!parsed.values.jql) fail("Missing --jql");
  return jiraRequest(config, "/rest/api/3/search/jql", {
    method: "POST",
    body: body({
      jql: parsed.values.jql,
      fields: commaList(parsed.values.fields),
      maxResults: positiveInteger(parsed.values["max-results"], 20, "--max-results"),
      ...(parsed.values["next-page-token"] ? { nextPageToken: parsed.values["next-page-token"] } : {}),
    }),
  });
}

async function createMeta(config, args, typesOnly = false) {
  const parsed = argsFor(args, {
    project: { type: "string" }, "type-id": { type: "string" },
    "start-at": { type: "string" }, "max-results": { type: "string" },
  });
  if (!parsed) return HELP;
  noExtraPositionals(parsed.positionals, 0);
  const key = encodeURIComponent(project(parsed.values, config));
  const type = parsed.values["type-id"];
  if (typesOnly && type) fail("issue-types does not accept --type-id");
  const endpoint = type
    ? `/rest/api/3/issue/createmeta/${key}/issuetypes/${encodeURIComponent(type)}`
    : `/rest/api/3/issue/createmeta/${key}/issuetypes`;
  return jiraRequest(config, `${endpoint}${queryString({
    startAt: positiveInteger(parsed.values["start-at"], undefined, "--start-at"),
    maxResults: positiveInteger(parsed.values["max-results"], undefined, "--max-results"),
  })}`);
}

async function assignees(config, args) {
  const parsed = argsFor(args, {
    project: { type: "string" }, issue: { type: "string" }, query: { type: "string" },
    "start-at": { type: "string" }, "max-results": { type: "string" },
  });
  if (!parsed) return HELP;
  noExtraPositionals(parsed.positionals, 0);
  const key = parsed.values.project ?? (!parsed.values.issue ? config.project : undefined);
  if (key && parsed.values.issue) fail("Use either --project or --issue, not both");
  if (!key && !parsed.values.issue) fail("Pass --project or --issue, or set JIRA_PROJECT_KEY");
  return jiraRequest(config, `/rest/api/3/user/assignable/search${queryString({
    project: key, issueKey: parsed.values.issue, query: parsed.values.query,
    startAt: positiveInteger(parsed.values["start-at"], undefined, "--start-at"),
    maxResults: positiveInteger(parsed.values["max-results"], 50, "--max-results"),
  })}`);
}

async function comments(config, args) {
  const parsed = argsFor(args, { "start-at": { type: "string" }, "max-results": { type: "string" } });
  if (!parsed) return HELP;
  const key = positional(parsed.positionals, 0, "issue key");
  noExtraPositionals(parsed.positionals, 1);
  return jiraRequest(config, `/rest/api/3/issue/${encodeURIComponent(key)}/comment${queryString({
    startAt: positiveInteger(parsed.values["start-at"], undefined, "--start-at"),
    maxResults: positiveInteger(parsed.values["max-results"], 50, "--max-results"),
  })}`);
}

async function transitions(config, args) {
  const parsed = argsFor(args, { fields: { type: "boolean" } });
  if (!parsed) return HELP;
  const key = positional(parsed.positionals, 0, "issue key");
  noExtraPositionals(parsed.positionals, 1);
  return jiraRequest(config, `/rest/api/3/issue/${encodeURIComponent(key)}/transitions${queryString({
    expand: parsed.values.fields ? "transitions.fields" : undefined,
  })}`);
}

async function createIssue(config, args) {
  const parsed = argsFor(args, {
    summary: { type: "string" }, type: { type: "string" }, project: { type: "string" },
    description: { type: "string" }, "description-file": { type: "string" }, parent: { type: "string" },
    "account-id": { type: "string" }, labels: { type: "string" }, "fields-file": { type: "string" },
  });
  if (!parsed) return HELP;
  noExtraPositionals(parsed.positionals, 0);
  if (!parsed.values.summary) fail("Missing --summary");
  if (!parsed.values.type) fail("Missing --type");
  const description = readText(parsed.values, "description", "description-file");
  const fields = {
    ...readObject(parsed.values["fields-file"]),
    project: { key: project(parsed.values, config) },
    issuetype: { name: parsed.values.type },
    summary: parsed.values.summary,
    ...(description !== undefined ? { description: textToAdf(description) } : {}),
    ...(parsed.values.parent ? { parent: { key: parsed.values.parent } } : {}),
    ...(parsed.values["account-id"] ? { assignee: { accountId: parsed.values["account-id"] } } : {}),
    ...(parsed.values.labels ? { labels: commaList(parsed.values.labels) } : {}),
  };
  const created = await jiraRequest(config, "/rest/api/3/issue", { method: "POST", body: body({ fields }) });
  return { ...created, url: `${config.baseUrl}/browse/${encodeURIComponent(created.key)}` };
}

async function editIssue(config, args) {
  const parsed = argsFor(args, {
    summary: { type: "string" }, description: { type: "string" }, "description-file": { type: "string" },
    labels: { type: "string" }, priority: { type: "string" }, "fields-file": { type: "string" },
  });
  if (!parsed) return HELP;
  const key = positional(parsed.positionals, 0, "issue key");
  noExtraPositionals(parsed.positionals, 1);
  const description = readText(parsed.values, "description", "description-file");
  const fields = {
    ...readObject(parsed.values["fields-file"]),
    ...(parsed.values.summary !== undefined ? { summary: parsed.values.summary } : {}),
    ...(description !== undefined ? { description: textToAdf(description) } : {}),
    ...(parsed.values.labels ? { labels: commaList(parsed.values.labels) } : {}),
    ...(parsed.values.priority ? { priority: { name: parsed.values.priority } } : {}),
  };
  if (!Object.keys(fields).length) fail("No edit fields supplied");
  return jiraRequest(config, `/rest/api/3/issue/${encodeURIComponent(key)}`, { method: "PUT", body: body({ fields }) });
}

async function assign(config, args) {
  const parsed = argsFor(args, { "account-id": { type: "string" } });
  if (!parsed) return HELP;
  const key = positional(parsed.positionals, 0, "issue key");
  noExtraPositionals(parsed.positionals, 1);
  if (!parsed.values["account-id"]) fail("Missing --account-id");
  return jiraRequest(config, `/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, {
    method: "PUT", body: body({ accountId: parsed.values["account-id"] }),
  });
}

async function addComment(config, args) {
  const parsed = argsFor(args, { text: { type: "string" }, file: { type: "string" } });
  if (!parsed) return HELP;
  const key = positional(parsed.positionals, 0, "issue key");
  noExtraPositionals(parsed.positionals, 1);
  const text = readText(parsed.values, "text", "file", true);
  return jiraRequest(config, `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
    method: "POST", body: body({ body: textToAdf(text) }),
  });
}

async function transition(config, args) {
  const parsed = argsFor(args, { id: { type: "string" }, "fields-file": { type: "string" } });
  if (!parsed) return HELP;
  const key = positional(parsed.positionals, 0, "issue key");
  noExtraPositionals(parsed.positionals, 1);
  if (!parsed.values.id) fail("Missing --id");
  const fields = readObject(parsed.values["fields-file"]);
  return jiraRequest(config, `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
    method: "POST",
    body: body({ transition: { id: parsed.values.id }, ...(Object.keys(fields).length ? { fields } : {}) }),
  });
}

async function linkTypes(config, args) {
  const parsed = argsFor(args);
  if (!parsed) return HELP;
  noExtraPositionals(parsed.positionals, 0);
  return jiraRequest(config, "/rest/api/3/issueLinkType");
}

async function link(config, args) {
  const parsed = argsFor(args, {
    type: { type: "string" }, inward: { type: "string" }, outward: { type: "string" },
    comment: { type: "string" }, "comment-file": { type: "string" },
  });
  if (!parsed) return HELP;
  noExtraPositionals(parsed.positionals, 0);
  for (const name of ["type", "inward", "outward"]) if (!parsed.values[name]) fail(`Missing --${name}`);
  const comment = readText(parsed.values, "comment", "comment-file");
  return jiraRequest(config, "/rest/api/3/issueLink", {
    method: "POST",
    body: body({
      type: { name: parsed.values.type },
      inwardIssue: { key: parsed.values.inward },
      outwardIssue: { key: parsed.values.outward },
      ...(comment !== undefined ? { comment: { body: textToAdf(comment) } } : {}),
    }),
  });
}

const commands = {
  "auth-check": authCheck,
  issue,
  search,
  "create-meta": createMeta,
  "issue-types": (config, args) => createMeta(config, args, true),
  assignees,
  comments,
  transitions,
  "link-types": linkTypes,
  create: createIssue,
  edit: editIssue,
  assign,
  comment: addComment,
  transition,
  link,
};

export async function run(argv = process.argv.slice(2), env = process.env) {
  if (!argv.length || argv[0] === "help" || argv.includes("--help")) return HELP;
  if (argv[0] === "doctor") return doctor(env, argv.slice(1));
  const command = commands[argv[0]];
  if (!command) fail(`Unknown command: ${argv[0]}`);
  const config = getConfig(env);
  return command(config, argv.slice(1));
}

async function main() {
  try {
    loadProjectEnv();
    const result = await run();
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
