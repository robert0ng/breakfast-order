/**
 * discover.ts — Explore the quickclick.cc ordering page structure.
 *
 * Usage:
 *   npx tsx discover.ts --url "<liff-url-with-token>"
 *
 * Uses `claude -p` (Claude Code CLI) instead of the Anthropic SDK.
 * No ANTHROPIC_API_KEY needed.
 */

import "dotenv/config";
import { execFileSync, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const urlIdx = args.indexOf("--url");
if (urlIdx === -1 || !args[urlIdx + 1]) {
  console.error("Usage: npx tsx discover.ts --url <liff-url-with-token>");
  process.exit(1);
}
const TARGET_URL = args[urlIdx + 1];

const SCREENSHOTS_DIR = path.resolve("screenshots");
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const QUICKCLICK_EMAIL = process.env.QUICKCLICK_EMAIL;
const QUICKCLICK_PASSWORD = process.env.QUICKCLICK_PASSWORD;
if (!QUICKCLICK_EMAIL || !QUICKCLICK_PASSWORD) {
  console.error("Missing QUICKCLICK_EMAIL or QUICKCLICK_PASSWORD in .env");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// agent-browser helpers
// ---------------------------------------------------------------------------

const AUTH_STATE = path.resolve("auth.json");
const LINE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 Line/13.6.1";
const BASE_FLAGS = `--user-agent "${LINE_UA}"${fs.existsSync(AUTH_STATE) ? ` --state "${AUTH_STATE}"` : ""}`;
const BASE_ARGS = ["--user-agent", LINE_UA, ...(fs.existsSync(AUTH_STATE) ? ["--state", AUTH_STATE] : [])];

function ab(command: string): string {
  const cmd = `agent-browser ${BASE_FLAGS} ${command}`;
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err: any) {
    const msg = err.stderr ?? err.message ?? String(err);
    console.error(`[agent-browser] error: ${cmd}`);
    console.error(msg);
    return `ERROR: ${msg}`;
  }
}

function navigate(url: string): string {
  const r = ab(`open "${url}"`);
  ab("wait --load networkidle");
  return r;
}

function snapshot(): string {
  return ab("snapshot -i");
}

function click(ref: string): string {
  ab(`click "${ref}"`);
  return `Clicked ${ref}`;
}

function findText(text: string): string {
  try {
    execFileSync("agent-browser", [...BASE_ARGS, "find", "text", text, "click"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: any) {
    const msg = err.stderr ?? err.message ?? String(err);
    console.error(`[agent-browser] find_text error: ${msg}`);
    return `ERROR: ${msg}`;
  }
  return `Clicked element with text: ${text}`;
}

function evalJs(js: string): string {
  try {
    return execFileSync("agent-browser", [...BASE_ARGS, "eval", js], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err: any) {
    const msg = err.stderr ?? err.message ?? String(err);
    console.error(`[agent-browser] eval error: ${msg}`);
    return `ERROR: ${msg}`;
  }
}

function fill(ref: string, text: string): string {
  const escaped = text.replace(/"/g, '\\"');
  ab(`fill "${ref}" "${escaped}"`);
  return `Filled ${ref}`;
}

function waitLoad(): string {
  return ab("wait --load networkidle");
}

function screenshot(name: string): string {
  const file = path.join(SCREENSHOTS_DIR, `${name}.png`);
  ab(`screenshot "${file}"`);
  return `Screenshot saved: ${file}`;
}

// ---------------------------------------------------------------------------
// Claude via CLI (no API key needed)
// ---------------------------------------------------------------------------

function askClaude(prompt: string): string {
  try {
    return execFileSync("claude", ["-p", prompt], {
      encoding: "utf-8",
      timeout: 120000,
    }).trim();
  } catch (err: any) {
    const msg = err.stderr ?? err.message ?? String(err);
    console.error("[claude] error:", msg.slice(0, 200));
    return `ERROR: ${msg}`;
  }
}

function parseAction(response: string): Record<string, string> | null {
  // Extract the last valid JSON object from response (Claude may self-correct mid-response)
  const matches = [...response.matchAll(/\{[\s\S]*?\}/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(matches[i][0]);
    } catch {
      continue;
    }
  }
  // Fallback: try greedy match
  const greedy = response.match(/\{[\s\S]*\}/);
  if (!greedy) return null;
  try {
    return JSON.parse(greedy[0]);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main agent loop
// ---------------------------------------------------------------------------

const SYSTEM = `You are a browser automation assistant performing a DISCOVERY run on a food ordering website (quickclick.cc / LINE LIFF store).

GOAL: Explore the page structure. Do NOT place an order. Report:
- Menu categories and items
- Customization options (size, sugar, ice, toppings, etc.)
- Checkout form fields required
- Any login or error states encountered

LOGIN CREDENTIALS — if you see a login page, fill these immediately:
  Email: ${QUICKCLICK_EMAIL}
  Password: ${QUICKCLICK_PASSWORD}

Respond with ONLY a JSON object, no markdown fences, no extra text. Choose ONE action per response.

Action formats:
  {"action": "navigate", "url": "...", "reason": "..."}
  {"action": "click", "ref": "@e5", "reason": "..."}
  {"action": "find_text", "text": "蔬菜蛋", "reason": "..."}
  {"action": "fill", "ref": "@e5", "text": "...", "reason": "..."}
  {"action": "eval", "js": "document.querySelector('.foo').click()", "reason": "..."}
  {"action": "wait", "reason": "..."}
  {"action": "screenshot", "name": "descriptive-name", "reason": "..."}
  {"action": "done", "summary": "full structured report", "reason": "..."}

Rules:
- The CURRENT PAGE SNAPSHOT provided each step is the live accessibility tree — use it to read refs and page state. You do NOT need a screenshot to check state.
- Screenshot ONLY at these milestones: after successful login, once per category explored, cart view, checkout form. Maximum ~15 screenshots total. Never screenshot just to "check" or "confirm" state.
- Menu item cards (e.g. 蔬菜蛋, 玉米蛋) are NOT in the interactive snapshot — use find_text to click them by their Chinese name.
- Use refs from the CURRENT PAGE SNAPSHOT for interactive elements (tabs, buttons, inputs). Use find_text for menu item cards.
- After filling login, click submit and wait for load.
- If you see a CAPTCHA image field, read the text from the snapshot and fill the field directly. The CAPTCHA contains ONLY alphanumeric characters (a-z, A-Z, 0-9) — no punctuation, tildes, dashes, or special characters. Strip any non-alphanumeric characters from what you read before filling the field.
- Call done when you have a complete picture of the menu structure.`;

async function main() {
  console.log("Starting discovery run...");
  console.log(`URL: ${TARGET_URL}\n`);

  const history: string[] = [];
  const MAX_STEPS = 500;

  // First action: navigate to the URL
  let currentSnapshot = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    // Get current page state (skip on first step before navigation)
    if (step > 0) {
      currentSnapshot = snapshot();
    }

    const recentHistory = history.slice(-20);
    const historyBlock = recentHistory.length > 0
      ? `ACTIONS TAKEN SO FAR (last ${recentHistory.length} of ${history.length}):\n${recentHistory.join("\n")}\n\n`
      : "ACTIONS TAKEN SO FAR: none yet\n\n";

    const snapshotBlock = currentSnapshot
      ? `CURRENT PAGE SNAPSHOT:\n${currentSnapshot}`
      : `CURRENT PAGE SNAPSHOT: (page not yet loaded — navigate to the target URL first)`;

    const prompt = `${SYSTEM}

TARGET URL TO DISCOVER: ${TARGET_URL}

${historyBlock}${snapshotBlock}

What is the next single action? (JSON only)`;

    console.log(`\n[step ${step + 1}] Asking Claude...`);
    let response = askClaude(prompt);
    console.log(`[claude] ${response.slice(0, 200)}`);

    let action = parseAction(response);
    if (!action) {
      console.warn("Could not parse action, retrying...");
      response = askClaude(prompt);
      action = parseAction(response);
    }
    if (!action) {
      console.error("Could not parse action after retry, skipping step:", response.slice(0, 200));
      continue;
    }

    let result = "";
    switch (action.action) {
      case "navigate":
        navigate(action.url);
        result = `Navigated to ${action.url}`;
        break;
      case "click":
        result = click(action.ref);
        break;
      case "find_text":
        result = findText(action.text);
        break;
      case "eval":
        result = evalJs(action.js);
        break;
      case "fill":
        result = fill(action.ref, action.text);
        break;
      case "wait":
        result = waitLoad();
        break;
      case "screenshot":
        result = screenshot(action.name);
        break;
      case "done":
        console.log("\n" + "=".repeat(60));
        console.log("DISCOVERY REPORT:");
        console.log(action.summary);
        console.log("=".repeat(60));
        console.log(`\nScreenshots saved in: ${SCREENSHOTS_DIR}`);
        return;
      default:
        result = `Unknown action: ${action.action}`;
    }

    const logEntry = `Step ${step + 1}: ${action.action}(${JSON.stringify(action)}) → ${result.slice(0, 100)}`;
    console.log(`[result] ${result.slice(0, 120)}`);
    history.push(logEntry);
  }

  console.warn(`\nReached max steps (${MAX_STEPS}) without done signal.`);
  console.log(`Screenshots saved in: ${SCREENSHOTS_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
