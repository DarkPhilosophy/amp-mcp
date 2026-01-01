import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "amp", version: "0.2.0" },
  { capabilities: { tools: {} } }
);

const TOOL_RUN = "amp_run";
const TOOL_RESUME = "amp_resume";
const DEFAULT_MODE = process.env.AMP_MCP_DEFAULT_MODE || "free";

const statePath =
  process.env.AMP_MCP_STATE ||
  path.join(os.homedir(), ".local/share/mcp-servers/amp-mcp/state.json");

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: TOOL_RUN,
      description:
        "Run Amp CLI in execute mode and store the session ID per project.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "User instruction to pass to Amp.",
          },
          project_dir: {
            type: "string",
            description: "Working directory for the Amp run (defaults to current).",
          },
          stdin: {
            type: "string",
            description: "Optional stdin content to pipe into Amp.",
          },
          dangerously_allow_all: {
            type: "boolean",
            description: "Allow Amp to execute all commands without confirmation.",
          },
          timeout_sec: {
            type: "number",
            description: "Timeout in seconds before terminating Amp.",
          },
          mode: {
            type: "string",
            description:
              "Amp mode (free, rush, smart) to control model and cost.",
          },
          amp_bin: {
            type: "string",
            description: "Override Amp binary path (default: amp).",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: TOOL_RESUME,
      description:
        "Resume a project session by referencing the last Amp thread ID in the prompt.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "User instruction to pass to Amp.",
          },
          project_dir: {
            type: "string",
            description: "Working directory for the Amp run (defaults to current).",
          },
          thread_id: {
            type: "string",
            description: "Override thread ID to reference in the prompt.",
          },
          stdin: {
            type: "string",
            description: "Optional stdin content to pipe into Amp.",
          },
          dangerously_allow_all: {
            type: "boolean",
            description: "Allow Amp to execute all commands without confirmation.",
          },
          timeout_sec: {
            type: "number",
            description: "Timeout in seconds before terminating Amp.",
          },
          mode: {
            type: "string",
            description:
              "Amp mode (free, rush, smart) to control model and cost.",
          },
          amp_bin: {
            type: "string",
            description: "Override Amp binary path (default: amp).",
          },
        },
        required: ["prompt"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== TOOL_RUN && request.params.name !== TOOL_RESUME) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const {
    prompt,
    project_dir,
    thread_id,
    stdin,
    dangerously_allow_all = false,
    timeout_sec = 120,
    mode,
    amp_bin,
  } = request.params.arguments ?? {};

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new Error("prompt is required and must be a non-empty string");
  }

  const projectDir = project_dir || process.cwd();
  const projectKey = resolveProjectKey(projectDir);
  const state = loadState();

  let effectivePrompt = prompt;
  if (request.params.name === TOOL_RESUME) {
    const storedThread = thread_id || state.projects[projectKey]?.session_id;
    if (!storedThread) {
      return {
        content: [
          {
            type: "text",
            text: "error: no stored session for this project; run amp_run first or pass thread_id",
          },
        ],
      };
    }
    effectivePrompt = `@${storedThread}\n${prompt}`;
  }

  const args = ["--log-level", "error", "--no-ide", "--no-jetbrains"];
  if (dangerously_allow_all) {
    args.unshift("--dangerously-allow-all");
  }
  const modeArg = (mode || DEFAULT_MODE).trim();
  if (modeArg) {
    args.unshift("-m", modeArg);
  }
  args.push("-x", effectivePrompt, "--stream-json");

  const env = {
    ...process.env,
    NO_COLOR: "1",
    TERM: "dumb",
    FORCE_COLOR: "0",
  };

  const result = await runCommand({
    command: amp_bin || process.env.AMP_BIN || "amp",
    args,
    cwd: projectDir,
    stdin,
    timeoutMs: Math.max(1, Number(timeout_sec)) * 1000,
    env,
  });

  const parsed = parseStreamResult(result.stdout);
  const text = formatResult(result, parsed.resultText, parsed.errorText);

  if (parsed.sessionId) {
    state.projects[projectKey] = {
      session_id: parsed.sessionId,
      updated_at: new Date().toISOString(),
    };
    saveState(state);
  }

  return {
    content: [{ type: "text", text }],
  };
});

function resolveProjectKey(projectDir) {
  try {
    return fs.realpathSync(projectDir);
  } catch {
    return projectDir;
  }
}

function loadState() {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { projects: {} };
    }
    if (!parsed.projects || typeof parsed.projects !== "object") {
      parsed.projects = {};
    }
    return parsed;
  } catch {
    return { projects: {} };
  }
}

function saveState(state) {
  const dir = path.dirname(statePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function parseStreamResult(stdout) {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  let sessionId = null;
  let resultText = "";
  let lastAssistantText = "";
  let errorText = "";

  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (parsed && typeof parsed === "object") {
      if (parsed.session_id && !sessionId) {
        sessionId = parsed.session_id;
      }
      if (parsed.type === "assistant") {
        const content = parsed.message?.content || [];
        const textParts = content
          .filter((item) => item?.type === "text" && typeof item.text === "string")
          .map((item) => item.text);
        if (textParts.length > 0) {
          lastAssistantText = textParts.join("\n").trim();
        }
      }
      if (parsed.type === "result") {
        if (typeof parsed.result === "string") {
          resultText = parsed.result.trim();
        }
        if (parsed.subtype && typeof parsed.error === "string") {
          errorText = parsed.error.trim();
        }
      }
    }
  }

  if (!resultText && lastAssistantText) {
    resultText = lastAssistantText;
  }

  return { sessionId, resultText, errorText };
}

function formatResult(result, parsedText, parsedError) {
  const { code, stdout, stderr, timedOut } = result;
  const out = parsedText.trim();
  const parsedErr = parsedError.trim();
  const err = stderr.trim();

  if (timedOut) {
    return `error: Amp timed out\n${err || stdout.trim() || out}`.trim();
  }

  if (parsedErr.length > 0) {
    return `error: ${parsedErr}`.trim();
  }

  if (code === 0) {
    if (out.length > 0) return out;
    if (err.length > 0) return err;
    return "ok: Amp completed with no output";
  }

  return `error: Amp exited with code ${code}\n${err || stdout.trim() || out}`.trim();
}

function runCommand({ command, args, cwd, stdin, timeoutMs, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });

    if (stdin && stdin.length > 0) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

const transport = new StdioServerTransport();
await server.connect(transport);
