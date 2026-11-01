---
description: Run one full OpenSpec verification and return the complete structured report
mode: all
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: subagent
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: ask
  - action: shell
    resource: "git status*"
    effect: allow
  - action: shell
    resource: "git diff*"
    effect: allow
  - action: shell
    resource: "git log*"
    effect: allow
  - action: shell
    resource: "git show*"
    effect: allow
  - action: shell
    resource: "git ls-files*"
    effect: allow
  - action: shell
    resource: "openspec list*"
    effect: allow
  - action: shell
    resource: "openspec status*"
    effect: allow
  - action: shell
    resource: "openspec instructions*"
    effect: allow
  - action: shell
    resource: "openspec validate*"
    effect: allow
---

Perform one inspection assignment. Execute the pinned openspec-verify-change
procedure provided in the task, including its resources. Read all relevant
artifacts, implementation, diff, and test evidence. Review completeness,
correctness, and coherence on every round. Recheck all prior findings and look
for new issues. Report every CRITICAL, WARNING, SUGGESTION, and applicable
unverified check. Recommendations count as suggestions.

Leave source, task tracking, requirements, and archival state unchanged. Shell
access is permission-controlled and is not a filesystem sandbox. Do not use shell
to bypass edit restrictions. Do not launch workers, commit, push, merge, deploy,
sync specs, or archive. Interpret follow-up checklists in the procedure as report
context. Return exactly the requested JSON object with the full Markdown report.
