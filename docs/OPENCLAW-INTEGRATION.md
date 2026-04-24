# OpenClaw Integration

This is the landing page for OpenClaw users who want to drive portalflow automations from an OpenClaw agent. The underlying flag and exit-code mechanics are in [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md); this document covers the OpenClaw-specific on-ramp only.

For the skill body that OpenClaw reads directly, see `tools/cli/skills/portalflow/SKILL.md`. For installation details and the full troubleshooting reference, see `tools/cli/skills/portalflow/README.md`.

---

## Prerequisites

Before installing the skill, confirm these three things:

1. **`portalflow` on PATH.** Run `portalflow --version`. If missing, install it:

   ```bash
   npm install -g @portalflow/cli
   ```

2. **LLM provider key.** Set `ANTHROPIC_API_KEY` in the shell that OpenClaw launches subprocesses from. The skill's `requires.env: ["ANTHROPIC_API_KEY"]` line causes OpenClaw to surface this requirement before the first run. Other providers also work — set the appropriate key and run `portalflow provider config` to register it.

3. **One-time Chrome profile setup.** The runner refuses to launch without knowing which Chrome profile to use. Run the interactive setup once:

   ```bash
   portalflow settings extension
   ```

   This choice is persisted to `~/.portalflow/config.json`. Without it every run produces a pre-flight failure with exit code `1`.

---

## Installing the bundled skill

The portalflow repository ships an OpenClaw skill at `tools/cli/skills/portalflow/`. Copy it to OpenClaw's skills directory so it is available in every project:

```bash
cp -r tools/cli/skills/portalflow ~/.openclaw/skills/portalflow
```

For workspace-only use (one project, isolated from other projects):

```bash
mkdir -p .agents/skills && cp -r tools/cli/skills/portalflow .agents/skills/portalflow
```

OpenClaw reloads skills on the next conversation; no restart needed.

The full precedence chain OpenClaw uses when resolving skill names is documented in `tools/cli/skills/portalflow/README.md`.

---

## Three worked scenarios

Each scenario below shows the exact command the agent runs. For the full annotated transcript including parse steps and the agent's reply to the user, see `tools/cli/skills/portalflow/examples/walkthrough.md`.

### 1. Discover the schema and tools (one-shot startup)

At the start of a session, the agent caches the schema and tool inventory so it can author automations correctly without guessing field names.

```bash
portalflow schema --pretty
portalflow tools list --pretty
```

The agent runs these once and holds the output in context. Both commands emit stable JSON documents; the content does not change within a single CLI version.

### 2. Validate an existing automation file

Before launching a real browser session (which takes 10–30 seconds), the agent validates the JSON to catch typos cheaply.

```bash
portalflow validate ./my-automation.json
```

Exit code `0` means OK. Exit code `2` means schema validation failed; stderr contains a structured error tree the agent can show the user. The agent should not retry without editing the file.

### 3. Run an automation and parse the JSON result

```bash
RESULT=$(portalflow run ./my-automation.json --json --no-color)
echo "$RESULT" | jq -r '.outputs.page_title'
echo "$RESULT" | jq -r '.artifacts[0]'
```

The agent checks the process exit code first, then parses `RESULT` for `outputs`, `artifacts`, and `errors`. See [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) for the full `RunResult` field reference and the exit code reaction map.

---

## Troubleshooting summary

**Skill never triggers.** OpenClaw uses the `description` field in `SKILL.md` as its trigger predicate. If your typical phrasing isn't covered (e.g. "scrape", "download a file"), edit the description to include those keywords and start a new conversation to pick up the change.

**`requires.bins` failing.** Run `which portalflow` and `portalflow --version`. If the binary is in a non-standard location, ensure that path is on `PATH` for the shell OpenClaw uses to launch subprocesses.

**Exit code 3 on every run.** Provider auth failure — `ANTHROPIC_API_KEY` is missing, expired, or wrong. Run `portalflow provider list` to see the current configuration.

**Exit code 4 on every run.** Chrome or extension handshake failure. Close all Chrome windows and rerun, or pass `--kill-chrome`. On macOS, `portalflow settings extension --profile-mode dedicated` may also help.

For the long-form version of each item, see `tools/cli/skills/portalflow/README.md`.

---

## Updating the skill

When portalflow ships a new version, replace the skill directory in-place:

```bash
rm -rf ~/.openclaw/skills/portalflow
cp -r tools/cli/skills/portalflow ~/.openclaw/skills/portalflow
```

The SKILL.md documents any new commands or flags relevant to the agent. Read the root `CHANGELOG.md` to see what changed — not every CLI release affects the skill body.

---

## Reporting issues

If the skill doesn't behave the way `SKILL.md` claims, file an issue against portalflow with:

- The exact user request you sent OpenClaw
- The SKILL.md version (commit hash if installed from source, or `portalflow --version`)
- The failing exit code and the `error` field from the run's stdout JSON
- Your OS, Chrome version, and Node.js version
