export const meta = {
  name: "openspec-verify-loop",
  description: "Verify an OpenSpec change, fix every finding with fresh workers, and repeat until a verification is clean",
  phases: [{ title: "Verify" }, { title: "Fix" }],
};

const input = args || {};
let change = input.change || null;
const max = Math.min(input.maxRounds || 5, Math.floor((budget().maxAgentCalls + 1) / 2));

const rules = [
  "Rules:",
  "- Report the real exit code of every command you run. Do not hide failures with pipes, `|| true` or truncated output.",
  "- Do not commit, push, merge, deploy, sync specs or archive. Archive-readiness wording in a report is not authorization.",
  "- Do not ask the user questions. If you cannot proceed, end your reply with the line `VERDICT: BLOCKED <reason>`.",
].join("\n");

function target() {
  const name = change ? "change `" + change + "`" : "the active change (if several changes are active, end with `VERDICT: BLOCKED` and list them)";
  return input.store ? name + " in OpenSpec store `" + input.store + "` (pass `--store " + input.store + "` to openspec commands)" : name;
}

function verifierPrompt() {
  const procedure = input.procedurePath
    ? "Read and follow the procedure in `" + input.procedurePath + "`."
    : "Use the installed `openspec-verify-change` skill.";
  return [
    "Run the openspec-verify-change procedure on " + target() + ". " + procedure,
    "Return its complete verification report, titled `## Verification Report: <change-name>`.",
    "Do not edit, create or delete files in the checkout, including through the shell. Temporary files outside it, such as under `$TMPDIR` or `/tmp`, are allowed, for example to keep a command's full output.",
    "A manual check you cannot run here, such as a run on another host, counts as verified when the repository records its date, run and outcome (for example in the task list or docs/verification.md) and no later change alters the behaviour that check exercised. A later edit that leaves that behaviour unchanged, even in the same file, does not make the record stale. List such checks as verified from the record, without the words \"not verified\". Report a check as Not verified only when it has no such record or a later change alters the behaviour it exercised.",
    "A design document is optional: when the change has no `design.md`, mark Design Adherence **Not applicable**, not Not verified, and do not use the words \"not verified\" for it. When the change has a `design.md`, check the implementation against it as usual.",
    "End your reply with one final verdict line: `VERDICT: CLEAN` when the report has no critical issues, warnings or suggestions and leaves no check unverified; `VERDICT: UNVERIFIED` when it has no critical issues, warnings or suggestions but reports one or more checks as Not verified; `VERDICT: ISSUES` otherwise; or `VERDICT: BLOCKED <reason>` when you cannot run the procedure.",
    rules,
  ].join("\n");
}

function fixerPrompt(report) {
  return [
    "Fix every issue in this OpenSpec verification report for " + target() + ": every critical issue, warning and suggestion.",
    "A check reported as Not verified is a limit of the report, not an issue: do not create optional or intentionally omitted artifacts, such as `design.md`, to satisfy a check.",
    "Keep edits small, preserve unrelated work, and do not weaken tests, requirements or scope to make the report clean. Run the relevant checks after fixing.",
    "End with a short summary of what you changed.",
    rules,
    "",
    "Verification report:",
    report,
  ].join("\n");
}

function lastLine(text) {
  // Tolerate Markdown emphasis or code marks and a trailing period; `_` only at the edges, so reasons keep it.
  const lines = String(text).split("\n")
    .map((line) => line.replace(/[`*]/g, "").trim().replace(/^_+|_+$/g, "").trim().replace(/\.$/, ""))
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}
function blockedReason(text) {
  const match = /^VERDICT: BLOCKED\b\s*[:\-–—]?\s*(.*)$/.exec(lastLine(text));
  return match ? match[1].trim() || "no reason given" : null;
}
const VERDICTS = ["VERDICT: CLEAN", "VERDICT: UNVERIFIED", "VERDICT: ISSUES"];
const nonzeroCount = /\b[1-9]\d*\s+(critical|warning|suggestion)/i;
// A check is marked Not verified at a line start, in a table cell or after a colon, not when the words are quoted mid-sentence.
const markedNotVerified = /(^|\||:)[\s#>*_`\-\d.]*not verified\b/im;
// Double-quoted text cites a mark rather than making one, as when a report quotes a test fixture.
// Backticks still count: a verifier may write a real status as code.
function unquoted(report) {
  return String(report).replace(/"[^"\n]*"|“[^”\n]*”/g, '""');
}
// The skill's Final Assessment states every nonzero count and names every skipped check ("<check> not verified: <reason>"),
// while earlier sections may quote either, so judge from it when the report has one.
function gaps(report) {
  const text = String(report);
  const heads = [...text.matchAll(/^[#>*_\s]*Final Assessment\b/gim)];
  if (heads.length) {
    const assessment = text.slice(heads[heads.length - 1].index);
    return { count: nonzeroCount.test(assessment), notVerified: /not verified/i.test(assessment) };
  }
  return { count: nonzeroCount.test(text), notVerified: markedNotVerified.test(unquoted(text)) };
}
function isClean(report) {
  const found = gaps(report);
  return lastLine(report) === "VERDICT: CLEAN" && !found.count && !found.notVerified;
}
// No issues, but checks left Not verified: a limit of the report that no fixer may clear by inventing artifacts.
function isUnverified(report) {
  const found = gaps(report);
  return lastLine(report) === "VERDICT: UNVERIFIED" && !found.count && found.notVerified;
}
function result(status, rounds, reason, report) {
  return { status, change, rounds, reason, report };
}

let round = 0;
while (true) {
  round++;
  log("Round " + round + " of " + max + ": verifying");
  const report = await agent(verifierPrompt(), { phase: "Verify", label: "Verify " + round });
  const blocked = blockedReason(report);
  if (blocked) return result("blocked", round, blocked, report);
  // An unreadable reply must not reach a fixer told to fix every issue in it.
  if (!VERDICTS.includes(lastLine(report))) return result("blocked", round, "Unrecognized verifier result: the last line is not a VERDICT line", report);
  if (!change) {
    const title = /^#{1,6}\s*Verification Report:\s*(\S+)/m.exec(report);
    if (title) change = title[1].replace(/[`*]/g, "");
  }
  if (isClean(report)) return result("clean", round, "A fresh verification found no issues", report);
  if (isUnverified(report)) return result("unverified", round, "A fresh verification found no issues but left checks Not verified; see the report", report);
  if (round >= max) return result("limit", round, "Round limit " + max + " reached with issues remaining", report);
  if (!change) return result("blocked", round, "Cannot identify the change: the report has no `Verification Report:` title", report);
  log("Round " + round + ": fixing");
  const fix = await agent(fixerPrompt(report), { phase: "Fix", label: "Fix " + round });
  const fixBlocked = blockedReason(fix);
  if (fixBlocked) return result("blocked", round, fixBlocked, fix);
}
