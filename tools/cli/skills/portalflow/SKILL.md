---
name: portalflow
description: Run browser automations defined as JSON via the portalflow CLI. Use when the user asks to automate a web workflow, fill a form, log into a site, extract data from a page, save HTML/screenshots, or run an existing portalflow automation file.
requires.bins: ["portalflow"]
requires.env: ["ANTHROPIC_API_KEY"]
metadata.openclaw.install: "npm install -g @portalflow/cli"
---

# portalflow

`portalflow` is a CLI that executes browser automations defined as JSON.
A single automation describes a sequence of steps (navigate, click, type,
extract, aiscope, …) and can return structured outputs and artifacts.
This skill teaches you the agent-friendly surface so you can discover
the schema, validate authored JSON, and run it in fully non-interactive
mode.

## Preflight

Before doing anything else, verify the binary exists and check the
version. Bail out with a clear message if either fails — installation
is a user-side concern, not something to retry.

```bash
portalflow --version
```

If the command is missing, tell the user to install it:

> `npm install -g @portalflow/cli`

## Discovery (cache the result)

Two introspection commands are stable wire contracts. Run them once per
session and cache the output — they don't change inside a run.

**Schema** — the JSON Schema for the automation file format. Use this
when synthesizing a new automation so you don't have to guess field
names or enum values.

```bash
portalflow schema --pretty
```

**Tools** — built-in helper tools an `aiscope` step can call via
`tool_call`. Currently includes `smscli` (SMS OTP retrieval) and
`vaultcli` (secret retrieval). Skip this step if the user's task
doesn't involve authentication or secrets.

```bash
portalflow tools list --pretty
```

## Validate before running

If you wrote (or modified) the automation JSON yourself, validate it
before launching a real run. Validation is fast and catches the kinds
of typos that would otherwise cost you a Chrome launch.

```bash
portalflow validate ./my-automation.json
```

Exit code `0` = OK. Exit code `2` = schema validation failed; the
stderr output contains a structured error tree you can show the user.

## Running an automation

Always pass `--json` so you get a parseable result document on stdout
instead of the human-friendly presenter view. Always also pass
`--no-color` defensively — `--json` already implies it, but explicit
is safer for older CLI versions.

```bash
portalflow run ./my-automation.json \
  --json \
  --no-color \
  --inputs-json '{"username":"alice","password":"$VAULTCLI_password"}'
```

For automations without inputs, drop the `--inputs-json` flag.

### Result shape

On success or controlled failure (the run reached completion but a step
failed) the CLI prints a single JSON line on stdout matching:

```json
{
  "success": true,
  "startedAt": "2026-04-25T17:30:00.000Z",
  "completedAt": "2026-04-25T17:30:08.412Z",
  "stepsCompleted": 3,
  "stepsTotal": 3,
  "outputs": { "page_title": "Example Domain", "page_dom": "..." },
  "artifacts": ["/home/user/.portalflow/artifacts/html/page_dom.yaml"],
  "errors": []
}
```

On a pre-flight failure (bad input format, missing config, schema
invalid) the envelope is shorter:

```json
{ "success": false, "error": "Chrome profile mode is not configured.", "exitCode": 1 }
```

### Exit codes

Always check the exit code in addition to the JSON body — they agree
but the code is sometimes the only signal you'll see if stdout was
truncated.

| Code | Meaning                                         |
|-----:|-------------------------------------------------|
| 0    | Success                                         |
| 1    | Runtime / unexpected / user input error         |
| 2    | Schema validation failed                        |
| 3    | LLM provider auth or pre-flight failure         |
| 4    | Chrome launch or extension handshake failure    |

Agent-side reaction map:
- `2` → show the user the schema error and stop. Don't retry.
- `3` → ask the user to check `ANTHROPIC_API_KEY` (or run
        `portalflow provider list` to inspect provider config).
- `4` → tell the user Chrome isn't ready; suggest closing all Chrome
        windows and retrying.
- `1` → read the JSON `error` field and decide whether to retry.

## Worked example

A complete agent turn that runs the bundled hello-world automation and
returns the page title to the user:

```bash
# 1. Validate
portalflow validate ./examples/demo-hello-world.json
# expect exit 0

# 2. Run
RESULT=$(portalflow run ./examples/demo-hello-world.json --json --no-color)

# 3. Parse
echo "$RESULT" | jq -r '.outputs.page_title'
# Example Domain
echo "$RESULT" | jq -r '.artifacts[0]'
# /home/user/.portalflow/artifacts/html/page_dom.yaml
```

The bundled `examples/demo-hello-world.json` (next to this SKILL.md)
exercises navigate + title extract + simplified-DOM save. Use it as a
starter when authoring new automations.

## Authoring new automations

When the user asks for an automation that doesn't exist yet:

1. Run `portalflow schema --pretty` to see the full field set.
2. Copy `examples/demo-hello-world.json` as a scaffold.
3. Edit `id` (UUID), `name`, `description`, `goal`, and `steps`.
4. Run `portalflow validate` before launching the run.
5. Save the file under `~/.portalflow/automations/` so the user can
   re-run it later via `portalflow run <name>` (the runner resolves
   bare names against this directory).

For complex flows that require LLM judgment (clicking the right button
on a busy page, dismissing a banner with unpredictable HTML), prefer
an `aiscope` step over hand-coded selectors — the LLM observes the
page and chooses the action.

## When NOT to invoke this skill

- The user wants to make an HTTP request, not drive a browser. Use
  `curl` or `fetch` instead.
- The task is local file manipulation only — portalflow always launches
  Chrome, which is overkill.
- The user already has a different browser-automation tool in their
  workflow (Playwright script, Selenium, etc.) and just asked you to
  read the existing code.
