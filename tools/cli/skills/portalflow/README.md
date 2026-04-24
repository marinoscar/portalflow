# portalflow OpenClaw skill

A drop-in [OpenClaw](https://openclaw.ai/) skill that lets an agent
discover, author, validate, and run portalflow browser automations.

## Files in this directory

| File | Purpose |
|------|---------|
| `SKILL.md` | The skill itself. OpenClaw reads the YAML frontmatter to decide when to invoke it; the markdown body teaches the agent the workflow. |
| `README.md` | This file — installation, troubleshooting, update procedure. Not consumed by OpenClaw. |
| `examples/demo-hello-world.json` | Working portalflow automation the skill body links to. The agent uses it as a starter template. |
| `examples/walkthrough.md` | Annotated transcript of a complete agent turn. Useful when you're tuning the SKILL.md `description` field. |

## Install

OpenClaw resolves skills along this precedence chain (highest first):

```
<workspace>/skills/<name>/        # workspace-local — wins for one project
<workspace>/.agents/skills/<name>/
~/.agents/skills/<name>/
~/.openclaw/skills/<name>/        # personal default — recommended
<bundled>/                        # ships with OpenClaw itself
```

The recommended install is **personal** so every project picks it up:

```bash
cp -r tools/cli/skills/portalflow ~/.openclaw/skills/portalflow
```

For workspace-only use (one project, isolated config):

```bash
mkdir -p .agents/skills && cp -r tools/cli/skills/portalflow .agents/skills/portalflow
```

OpenClaw reloads skills on the next conversation; no restart needed.

## Verify the skill is discoverable

After install, ask OpenClaw:

> List the available portalflow tools.

Expected behaviour: the agent runs `portalflow tools list --pretty`
and returns the inventory (smscli, vaultcli). If instead it says it
doesn't know how to use portalflow, see Troubleshooting below.

## Prerequisites

- `portalflow` on `PATH` — `npm install -g @portalflow/cli`. The
  skill's `requires.bins: ["portalflow"]` line tells OpenClaw to fail
  fast if it isn't installed.
- An LLM provider key — set `ANTHROPIC_API_KEY` in your shell. The
  skill's `requires.env` line surfaces this requirement to the user
  before the first run. Other providers also work — set the
  appropriate key and run `portalflow provider config` to register it.
- One-time `portalflow settings extension` to choose a Chrome profile
  mode. The runner refuses to launch otherwise; the failure surfaces
  as exit code `1` with a clear message.

## Troubleshooting

**Skill never triggers.** OpenClaw uses the SKILL.md `description`
field as the trigger predicate. If your typical request phrasing isn't
covered, edit the description to include the keywords you actually
use (e.g., add "scrape", "download a file", whatever fits). After
editing, start a new conversation to pick up the change.

**`requires.bins` failing.** Run `which portalflow` and `portalflow
--version`. If missing, install with `npm install -g
@portalflow/cli`. If the binary is in a non-standard location, make
sure that path is on `PATH` for the shell OpenClaw launches its
subprocesses in.

**Exit code 3 on every run.** Provider auth — your `ANTHROPIC_API_KEY`
is missing, expired, or pointing at the wrong account. Run
`portalflow provider list` to see what the CLI thinks is configured.

**Exit code 4 on every run.** Chrome / extension handshake. Close all
Chrome windows and rerun (or pass `--kill-chrome`). On macOS you may
also need `portalflow settings extension --profile-mode dedicated`.

**The agent ignores `--json` output.** Make sure your portalflow
version is `>= 3.4.0` (`portalflow --version`). Earlier versions
didn't have `--json`; the agent will fall back to parsing colored
text and may misinterpret the result.

## Updating

When portalflow ships a new version, replace the skill directory
in-place:

```bash
rm -rf ~/.openclaw/skills/portalflow
cp -r tools/cli/skills/portalflow ~/.openclaw/skills/portalflow
```

The SKILL.md will document any new commands or flags relevant to the
agent. Read the changelog at the project root to see what changed —
not every CLI release affects the skill body.

## Reporting issues

If the skill doesn't behave the way the SKILL.md claims, file an
issue against portalflow with:
- the exact user request you sent OpenClaw
- the SKILL.md version (commit hash if installed from source)
- `portalflow --version`
- the failing exit code and `error` field from the run's stdout JSON
