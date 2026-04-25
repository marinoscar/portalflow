# Walkthrough: agent uses portalflow end-to-end

This transcript shows how an OpenClaw agent fulfils the user request
"fetch the title of example.com and save a snapshot of the page" using
the portalflow skill. Lines prefixed with `>` are the user; everything
else is what the agent runs and observes.

## 1. User intent

> Use portalflow to fetch the title of example.com and save a snapshot
> of the page.

The skill triggers because the request matches its `description` field
("automate a web workflow, fill a form, …, save HTML/screenshots, or
run an existing portalflow automation file").

## 2. Preflight

```
$ portalflow --version
3.4.0
```

Binary present. The agent moves on.

## 3. Discovery

The agent caches the schema and tool list once per session. For this
small task it skips the tool list (no auth involved) but still grabs
the schema so it can author the automation correctly.

```
$ portalflow schema --pretty | jq '.definitions.Automation.required'
[
  "id",
  "name",
  "description",
  "goal",
  "inputs",
  "steps"
]
```

Now the agent knows the minimum fields it must fill in.

## 4. Author the automation

The user request maps cleanly onto the bundled hello-world example.
The agent reuses it instead of synthesizing from scratch:

```
$ cp ~/.openclaw/skills/portalflow/examples/demo-hello-world.json ./hello.json
```

If the user had a less templated request, the agent would copy
`demo-hello-world.json` and edit `steps`, validating along the way.

## 5. Validate

```
$ portalflow validate ./hello.json
portalflow validate: OK — portalflow hello-world (OpenClaw skill demo) (3 steps)
```

Exit code `0`. Safe to launch.

## 6. Run with --json

```
$ portalflow run ./hello.json --json --no-color
```

Stdout (single line, expanded here for readability):

```json
{
  "success": true,
  "startedAt": "2026-04-25T17:42:11.082Z",
  "completedAt": "2026-04-25T17:42:18.341Z",
  "stepsCompleted": 3,
  "stepsTotal": 3,
  "outputs": {
    "page_title": "Example Domain",
    "page_dom": "- tag: html\n  children:\n    - tag: head\n      children:\n        - tag: title\n          text: \"Example Domain\"\n    ..."
  },
  "artifacts": [
    "/home/user/.portalflow/artifacts/html/page_dom.yaml"
  ],
  "errors": []
}
```

Exit code: `0`.

## 7. Parse and reply

```
$ jq -r '.outputs.page_title' < result.json
Example Domain
$ jq -r '.artifacts[0]' < result.json
/home/user/.portalflow/artifacts/html/page_dom.yaml
```

The agent replies to the user:

> The page title is **Example Domain**. I saved a simplified DOM
> snapshot to `~/.portalflow/artifacts/html/page_dom.yaml` (≈4KB —
> readable in any editor).

## What happened on the failure path?

If the same run had failed because Chrome wasn't reachable, stdout
would have been:

```json
{ "success": false, "error": "Chrome / extension handshake failed: …", "exitCode": 4 }
```

…and the exit code would be `4`. The agent's exit-code reaction map
(in SKILL.md) tells it to suggest closing Chrome windows and retrying.

That's the entire happy-path contract: discover → validate → run →
parse. No log-tailing, no ANSI parsing, no follow-up commands needed.

---

# Walkthrough: agent uses goal-driven mode

This transcript shows how an OpenClaw agent fulfils the user request
"fetch the title of example.com" using `portalflow agent` instead of
the file-based flow. The agent recognises this is an ad-hoc task and
skips JSON authoring entirely.

## 1. User intent

> What's the page title of example.com?

The skill triggers (same `description` predicate as before). The agent
sees that this is a one-off information-retrieval task — no
multi-step logic, no need for a saved automation file.

## 2. Preflight

```
$ portalflow --version
3.5.0
```

Binary present.

## 3. Decision: goal-driven vs file-based

The task is:
- Single-phase (navigate + extract title)
- Ad-hoc (not going to be repeated)
- Expressible in one sentence

The agent uses `portalflow agent` and skips the schema → author →
validate cycle.

## 4. Run with goal-driven mode

```
$ portalflow agent \
    "open example.com and report the page title" \
    --json --no-color
```

Stdout (single line, expanded for readability):

```json
{
  "success": true,
  "startedAt": "2026-04-25T18:05:01.000Z",
  "completedAt": "2026-04-25T18:05:09.218Z",
  "stepsCompleted": 1,
  "stepsTotal": 1,
  "outputs": {
    "page_title": "Example Domain"
  },
  "artifacts": [],
  "errors": []
}
```

Exit code: `0`.

## 5. Parse and reply

```
$ echo "$RESULT" | jq -r '.outputs.page_title'
Example Domain
```

The agent replies to the user:

> The page title of example.com is **Example Domain**.

## What happened on the failure path?

If Chrome wasn't reachable, stdout would have been:

```json
{ "success": false, "error": "Chrome / extension handshake failed: …", "exitCode": 4 }
```

…and the exit code would be `4`. Same exit-code reaction map as the
file-based flow: suggest closing Chrome windows and retrying.

## Contrast with the file-based walkthrough

The file-based walkthrough above (steps 1–7) required: preflight,
schema discovery, file authoring, validation, run, and parse — six
steps. This walkthrough required: preflight, run, parse — three steps.
The `RunResult` output is identical in both cases.
