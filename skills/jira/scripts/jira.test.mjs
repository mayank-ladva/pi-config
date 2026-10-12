import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getConfig, jiraRequest, loadProjectEnv, run, textToAdf } from "./jira.mjs";

const ENV = {
  JIRA_URL: "https://example.atlassian.net",
  JIRA_EMAIL: "dev@example.com",
  JIRA_API_TOKEN: "test-token",
  JIRA_PROJECT_KEY: "ABC",
};

test("loads project .env without overriding existing environment values", () => {
  const directory = mkdtempSync(join(tmpdir(), "jira-cli-"));
  const previous = {
    fileOnly: process.env.JIRA_TEST_FILE_ONLY,
    precedence: process.env.JIRA_TEST_PRECEDENCE,
  };
  try {
    writeFileSync(join(directory, ".env"), 'JIRA_TEST_FILE_ONLY="file"\r\nJIRA_TEST_PRECEDENCE="file"\r\n');
    process.env.JIRA_TEST_PRECEDENCE = "shell";
    loadProjectEnv(directory);
    assert.equal(process.env.JIRA_TEST_FILE_ONLY, "file");
    assert.equal(process.env.JIRA_TEST_PRECEDENCE, "shell");
  } finally {
    if (previous.fileOnly === undefined) delete process.env.JIRA_TEST_FILE_ONLY;
    else process.env.JIRA_TEST_FILE_ONLY = previous.fileOnly;
    if (previous.precedence === undefined) delete process.env.JIRA_TEST_PRECEDENCE;
    else process.env.JIRA_TEST_PRECEDENCE = previous.precedence;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("doctor reports local configuration without credentials or network calls", async (t) => {
  t.mock.method(globalThis, "fetch", () => assert.fail("doctor must not contact Jira"));
  const result = await run(["doctor"], ENV);
  assert.equal(result.envFile, join(process.cwd(), ".env"));
  assert.equal(typeof result.envFileExists, "boolean");
  assert.equal(result.project, "ABC");
  assert.equal(result.configured, true);
  assert.equal(result.error, null);
  assert.deepEqual(result.variables, Object.fromEntries(Object.keys(ENV).map((key) => [key, true])));
  for (const value of [ENV.JIRA_URL, ENV.JIRA_EMAIL, ENV.JIRA_API_TOKEN, getConfig(ENV).authorization]) {
    assert.equal(JSON.stringify(result).includes(value), false);
  }

  const missing = await run(["doctor"], {});
  assert.equal(missing.configured, false);
  assert.equal(missing.project, null);
  assert.equal(Object.values(missing.variables).every((value) => value === false), true);
  assert.match(missing.error, /Missing environment variables: JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN/);

  const invalid = await run(["doctor"], { ...ENV, JIRA_URL: "https://secret-user:secret-password@example.com" });
  assert.equal(invalid.configured, false);
  assert.match(invalid.error, /without embedded credentials/);
  assert.equal(JSON.stringify(invalid).includes("secret-"), false);
  await assert.rejects(run(["doctor", "unexpected"], {}), /Unexpected argument/);
});

test("doctor CLI loads quoted CRLF .env from the invocation directory and honors overrides", () => {
  const directory = mkdtempSync(join(tmpdir(), "jira-doctor-"));
  try {
    writeFileSync(join(directory, ".env"), Object.entries(ENV).map(([key, value]) => `${key}="${value}"`).join("\r\n"));
    const output = execFileSync(process.execPath, [fileURLToPath(new URL("./jira.mjs", import.meta.url)), "doctor"], {
      cwd: directory,
      env: { JIRA_PROJECT_KEY: "OVERRIDE" },
      encoding: "utf8",
    });
    const result = JSON.parse(output);
    assert.equal(result.envFile, join(directory, ".env"));
    assert.equal(result.envFileExists, true);
    assert.equal(result.configured, true);
    assert.equal(result.project, "OVERRIDE");
    assert.equal(output.includes(ENV.JIRA_API_TOKEN), false);
    assert.equal(output.includes(ENV.JIRA_EMAIL), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("times out requests and response bodies without retrying mutations", async (t) => {
  for (const phase of ["request", "body"]) {
    await t.test(phase, async (t) => {
      const controller = new AbortController();
      t.mock.method(AbortSignal, "timeout", (milliseconds) => {
        assert.equal(milliseconds, 30_000);
        return controller.signal;
      });
      let calls = 0;
      const fetchImpl = async (_url, options) => {
        calls++;
        assert.equal(options.signal, controller.signal);
        if (phase === "request") {
          controller.abort(new DOMException("Timeout", "TimeoutError"));
          options.signal.throwIfAborted();
        }
        return {
          text: async () => {
            controller.abort(new DOMException("Timeout", "TimeoutError"));
            throw new DOMException("Body aborted", "AbortError");
          },
        };
      };
      await assert.rejects(
        jiraRequest(getConfig(ENV), "/rest/api/3/issue", { method: "POST", body: "{}" }, fetchImpl),
        /timed out after 30 seconds.*No automatic retry.*verify server state/,
      );
      assert.equal(calls, 1);
    });
  }
});

test("builds Atlassian Document Format from plain text", () => {
  assert.deepEqual(textToAdf("first\n\nsecond"), {
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "first" }] },
      { type: "paragraph", content: [] },
      { type: "paragraph", content: [{ type: "text", text: "second" }] },
    ],
  });
});

test("validates configuration without exposing values", () => {
  assert.throws(
    () => getConfig({ JIRA_URL: "secret-url" }),
    (error) => error.message === "Missing environment variables: JIRA_EMAIL, JIRA_API_TOKEN",
  );
});

test("sends authentication internally and formats Jira errors", async () => {
  const config = getConfig(ENV);
  let received;
  const fetchImpl = async (url, options) => {
    received = { url: String(url), options };
    return new Response(JSON.stringify({ errorMessages: ["Not allowed"] }), {
      status: 403,
      statusText: "Forbidden",
      headers: { "Content-Type": "application/json" },
    });
  };

  await assert.rejects(
    jiraRequest(config, "/rest/api/3/myself", {}, fetchImpl),
    (error) => error.message === "Jira API 403 Forbidden: Not allowed" && !error.message.includes(ENV.JIRA_API_TOKEN),
  );
  assert.equal(received.url, "https://example.atlassian.net/rest/api/3/myself");
  assert.match(received.options.headers.Authorization, /^Basic /);
});

test("uses enhanced JQL search and creates assigned subtasks with ADF and browser URLs", async (t) => {
  const requests = [];
  const apiResult = { id: "10002", key: "ABC-2", self: "https://example.atlassian.net/rest/api/3/issue/10002" };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify(apiResult), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  await run(["search", "--jql", "project = ABC", "--max-results", "5"], ENV);
  const result = await run([
    "create", "--summary", "Child", "--type", "Sub-task", "--parent", "ABC-1",
    "--description", "Do the work", "--account-id", "account",
  ], { ...ENV, JIRA_URL: `${ENV.JIRA_URL}/` });
  assert.deepEqual(result, { ...apiResult, url: "https://example.atlassian.net/browse/ABC-2" });
  assert.equal(requests.length, 2);

  assert.equal(requests[0].url, "https://example.atlassian.net/rest/api/3/search/jql");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    jql: "project = ABC",
    fields: ["summary", "status", "assignee", "description", "issuetype", "priority", "labels", "parent"],
    maxResults: 5,
  });

  assert.equal(requests[1].url, "https://example.atlassian.net/rest/api/3/issue");
  const created = JSON.parse(requests[1].options.body).fields;
  assert.deepEqual(created.project, { key: "ABC" });
  assert.deepEqual(created.assignee, { accountId: "account" });
  assert.deepEqual(created.parent, { key: "ABC-1" });
  assert.deepEqual(created.issuetype, { name: "Sub-task" });
  assert.equal(created.description.content[0].content[0].text, "Do the work");
});

test("dispatches the remaining supported operations", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url: new URL(url), method: options.method ?? "GET" });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const cases = [
    [["auth-check"], "/rest/api/3/myself", "GET"],
    [["issue", "ABC-1"], "/rest/api/3/issue/ABC-1", "GET"],
    [["create-meta"], "/rest/api/3/issue/createmeta/ABC/issuetypes", "GET"],
    [["create-meta", "--type-id", "10003"], "/rest/api/3/issue/createmeta/ABC/issuetypes/10003", "GET"],
    [["issue-types"], "/rest/api/3/issue/createmeta/ABC/issuetypes", "GET"],
    [["assignees", "--query", "Jane"], "/rest/api/3/user/assignable/search", "GET"],
    [["comments", "ABC-1"], "/rest/api/3/issue/ABC-1/comment", "GET"],
    [["transitions", "ABC-1"], "/rest/api/3/issue/ABC-1/transitions", "GET"],
    [["link-types"], "/rest/api/3/issueLinkType", "GET"],
    [["edit", "ABC-1", "--summary", "Changed"], "/rest/api/3/issue/ABC-1", "PUT"],
    [["assign", "ABC-1", "--account-id", "account"], "/rest/api/3/issue/ABC-1/assignee", "PUT"],
    [["comment", "ABC-1", "--text", "Hello"], "/rest/api/3/issue/ABC-1/comment", "POST"],
    [["transition", "ABC-1", "--id", "31"], "/rest/api/3/issue/ABC-1/transitions", "POST"],
  ];

  for (const [args] of cases) await run(args, ENV);
  assert.deepEqual(
    requests.map(({ url, method }) => [url.pathname, method]),
    cases.map(([, pathname, method]) => [pathname, method]),
  );
});

test("builds directed issue links", async (t) => {
  let request;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    request = { url: String(url), options };
    return new Response(null, { status: 201 });
  });

  await run([
    "link", "--type", "Blocks", "--inward", "ABC-1", "--outward", "ABC-2", "--comment", "Related",
  ], ENV);

  assert.equal(request.url, "https://example.atlassian.net/rest/api/3/issueLink");
  const payload = JSON.parse(request.options.body);
  assert.deepEqual(payload.type, { name: "Blocks" });
  assert.deepEqual(payload.inwardIssue, { key: "ABC-1" });
  assert.deepEqual(payload.outwardIssue, { key: "ABC-2" });
  assert.equal(payload.comment.body.content[0].content[0].text, "Related");
});
