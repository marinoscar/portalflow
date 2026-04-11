# PortalFlow Vision

## Vision Statement

PortalFlow is intended to become a platform for intelligent, human-like browser automation that can operate web applications the way a capable person would, while remaining observable, controllable, and extensible.

The long-term vision is to create a system that can understand a user’s goal, translate that goal into a structured automation, execute the workflow in a real browser, coordinate with supporting tools such as OTP handlers, and provide full operational visibility through a web-based control plane.

PortalFlow is not intended to be just a browser bot or a script runner. It is envisioned as an automation operating platform for real-world web workflows that are too dynamic, too fragmented, or too human-oriented to be solved cleanly through APIs alone.

## Core Problem

A large number of important workflows still live inside websites, portals, and browser-based applications that were designed for humans, not machines. These workflows often involve:

* Logging into portals with usernames, passwords, and multi-factor authentication
* Navigating changing layouts and inconsistent user interfaces
* Downloading documents such as folios, statements, invoices, reports, or confirmations
* Reviewing account information that is only available through a logged-in experience
* Handling interruptions such as OTP prompts, modal dialogs, delays, redirects, or session timeouts
* Completing multi-step journeys that cannot be reliably represented as static API calls

Traditional automation struggles in these environments because it is often too brittle, too script-driven, and too disconnected from the intent of the task.

PortalFlow is meant to address this by combining browser automation, AI reasoning, structured workflow definitions, and external tools into a single system.

## Product Vision

PortalFlow should enable users and operators to define, generate, manage, and run browser automations that simulate real user behavior as closely as practical.

For real-world integrations, PortalFlow should rely on dedicated companion CLI tools rather than reinventing every supporting capability inside the core platform. In particular, SMS and OTP retrieval should rely on [`smscli`](https://github.com/marinoscar/sink/blob/main/tools/smscli/README.md), the Sink SMS CLI, which is designed for agent-friendly access to SMS messages and OTP extraction from an Android device via the Sink API. Secrets and credentials management should rely on [`vaultcli`](https://github.com/marinoscar/vault/blob/main/tools/vaultcli/README.md), the Vault CLI, which is designed for both humans and AI agents to securely access secrets through the Vault API with encrypted storage behind it.

The platform should make it possible to:

* Automate end-to-end browser workflows in a real Chrome-based environment using [Playwright](https://playwright.dev/)
* Prefer desktop-based, headed browser execution rather than headless automation for real-world portal reliability
* Use LLMs to assist with planning, generation, adaptation, and execution of automations
* Connect to multiple LLM providers that are compatible with Anthropic-style and OpenAI-style APIs
* Represent automations in a structured JSON format that can be stored, reviewed, edited, versioned, and executed
* Run a CLI-based execution environment connected to a gateway and a web application
* Provide a central web interface for creating new automations, managing existing ones, reviewing logs, and controlling execution
* Incorporate external tools such as SMS or OTP integrations when a workflow requires them
* Use [`smscli`](https://github.com/marinoscar/sink/blob/main/tools/smscli/README.md) as the primary integration for SMS retrieval and OTP handling
* Use [`vaultcli`](https://github.com/marinoscar/vault/blob/main/tools/vaultcli/README.md) as the primary integration for secrets and credentials access
* Operate initially with Ubuntu as the primary target runtime environment

PortalFlow should bridge the gap between human intent and browser execution.

## What PortalFlow Should Become

PortalFlow should evolve into a browser automation control system with four major capabilities:

### 1. Intelligent automation authoring

Users should be able to create automations not only by manually defining steps, but also by describing the desired outcome in natural language and using an LLM to assist in producing a first version of the automation.

The web application should help the user create new automations by:

* Capturing the intent of the task
* Suggesting automation structures
* Generating or refining the JSON definition
* Explaining the proposed workflow in understandable terms
* Allowing the user to review and edit the automation before execution

The goal is not to eliminate structure. The goal is to make structure easier to produce.

### 2. Reliable browser execution

PortalFlow should use a real browser environment to execute automations in a way that is close to human navigation. [Playwright](https://playwright.dev/) should provide the core mechanism to navigate websites, manipulate pages, inspect application state, interact with elements, and execute browser actions in a controlled and observable way.

This includes handling:

* Page navigation
* Form filling
* Clicks and selections
* Authentication flows
* Conditional paths
* Document downloads
* Session handling
* Delays and waits
* Retry scenarios
* Tool-assisted steps such as OTP retrieval

AI should complement that deterministic browser layer by helping decide the next step, when to call tools, how to interpret changing page structures, and how to identify the right elements when websites evolve. This is critical because websites change constantly, and rigid browser scripts alone tend to break when labels move, layouts shift, or flows are slightly reorganized.

Execution should remain grounded in a structured automation format so that the platform can preserve determinism, auditability, and operational control. The objective is not to let the AI rediscover the workflow from scratch on every run. The objective is to give the runtime a high-level deterministic process flow while using AI selectively to absorb expected variability in interfaces that were designed for human use rather than software bots.

This hybrid model is central to PortalFlow. Deterministic process guidance should reduce unnecessary exploration, lower token consumption, improve repeatability, and produce more consistent outcomes, while AI should provide the resilience needed to keep flows working as websites naturally change over time.

### 3. Centralized orchestration and visibility

PortalFlow should provide a web-based control plane that acts as the operational center of the system.

This interface should allow users to:

* Create new automations
* Edit automation definitions
* Launch and monitor runs
* Review logs and step-level outcomes
* Inspect failures and partial completions
* See which tools and LLMs were used
* Understand why an automation made certain decisions
* Maintain a catalog of available automations

The gateway and CLI runtime should connect cleanly to this control plane so that execution and management remain unified.

### 4. Multi-LLM flexibility

PortalFlow should avoid being tightly coupled to a single model vendor.

The platform should support multiple LLM providers through interfaces compatible with Anthropic-style and OpenAI-style APIs. This allows PortalFlow to:

* Choose different models for different tasks
* Swap providers without redesigning the platform
* Support user or operator preferences
* Improve resilience and cost flexibility
* Adapt as the model ecosystem changes over time

This is a strategic requirement, not a convenience feature.

## Guiding Principles

### Human-like behavior

PortalFlow should interact with websites in a way that reflects how a human operator would move through the application. The objective is not theatrical imitation, but practical behavioral similarity that improves compatibility with real-world web workflows.

For that reason, PortalFlow should favor desktop execution with a headed browser session. A headless-first model often increases robot checks, compatibility issues, and detection risk, which makes it a poor default for the kinds of websites PortalFlow is meant to automate.

### Intent-driven automation

The system should focus on completing outcomes, not merely replaying rigid step sequences. Automations should remain structured, but the platform should understand why the automation exists and what it is trying to achieve.

### Structure with intelligence

LLMs are valuable for interpretation, generation, and adaptation, but the automation itself should remain grounded in a structured format. The system should combine reasoning with explicit definitions rather than depend entirely on opaque agent behavior.

PortalFlow should be deliberately designed as a hybrid between deterministic workflow execution and AI-guided adaptation. The structured flow should provide high-level guidance about the intended journey, expected checkpoints, tool usage, and success conditions. AI should then help handle the variability inside that structure, rather than replace the structure entirely.

### Operational control

Browser automation without logs, traceability, and control is not enough. PortalFlow should make execution visible and manageable so that users can trust it in practical settings.

### Provider flexibility

The platform should treat LLM integration as an abstraction layer, not a hardcoded dependency on one vendor.

### Ubuntu-first execution

PortalFlow should initially target Ubuntu as its main runtime environment. This provides a clear deployment focus and simplifies the design of browser execution, gateway services, CLI tooling, and system-level integrations.

## Product Scope

At a high level, PortalFlow is envisioned as consisting of the following major parts.

## CLI Runtime

The CLI runtime is intended to be the execution engine and operator-facing command-line interface.

It should be responsible for:

* Loading automation definitions from JSON
* Launching browser-based executions
* Connecting to the gateway and reporting status
* Writing logs and run artifacts
* Accessing configured tools and LLM providers
* Supporting local execution and operational tasks
* Acting as a practical entry point for developers, operators, and automation runners

The CLI should feel like a serious operational tool, not just a demo utility.

## Gateway

The gateway is intended to be the coordination layer between the CLI runtime, the web UI, and supporting services.

Its role should include:

* Managing communication between clients and execution environments
* Routing run requests and status updates
* Exposing APIs used by the web application
* Handling authentication and session boundaries
* Coordinating access to logs, artifacts, and execution metadata
* Serving as the integration point for remote control and centralized management

The gateway should make it possible for distributed execution and centralized visibility to coexist cleanly.

## Web Application

The web application is intended to be the main management surface for PortalFlow.

It should allow users to:

* Browse available automations
* Create new automations
* Edit structured automation definitions
* Use LLM assistance to draft or improve automations
* Trigger executions
* Review execution history
* Inspect logs, outcomes, downloads, and errors
* Configure LLM providers and tool connections
* Manage the overall automation lifecycle

The web application is not just an admin screen. It is meant to be the control center of the platform.

A key part of this experience should be guided, step-by-step automation authoring. Instead of forcing users to define automations as raw JSON from the start, the web UI should help them describe the workflow as an ordered series of business steps. The platform should then use LLM assistance to help translate those guided steps into a structured automation definition that remains reviewable, editable, and executable.

This means the UI should feel closer to building a runbook than writing an unstructured prompt. A user should be able to express what they want to happen step by step, while PortalFlow turns that guidance into a structured automation with explicit actions, tool calls, validation points, and expected outcomes.

The goal is to reduce ambiguity without removing flexibility. Users should guide the journey, the platform should provide the structure, and AI should help fill in the uncertain parts.

## Automation Definition Format

PortalFlow should use JSON as the automation definition format in the initial version.

This JSON-based approach should make automations:

* Portable
* Readable
* Editable
* Versionable
* Easy to validate
* Suitable for generation by an LLM with human review
* Suitable for execution by deterministic runtime components

The automation JSON should capture all relevant details needed to understand and execute a workflow.

Where a workflow depends on external operational capabilities, the JSON definition should be able to reference those dependencies explicitly, including integrations such as [`smscli`](https://github.com/marinoscar/sink/blob/main/tools/smscli/README.md) for SMS and OTP handling and [`vaultcli`](https://github.com/marinoscar/vault/blob/main/tools/vaultcli/README.md) for secret and credential resolution.

That likely includes areas such as:

* Metadata about the automation
* Goal or intended outcome
* Required inputs
* Browser steps and action sequences
* Conditions and branching behavior
* Tool usage definitions
* OTP or MFA handling requirements
* Retry or timeout expectations
* Output expectations
* Logging or evidence capture preferences

Over time, this format may evolve, but the near-term vision is to keep the automation definition explicit and structured.

The automation format should also be able to preserve high-level guided steps that describe the intended business journey, along with checkpoints and AI guidance fields that help the runtime handle expected website variability without forcing repeated discovery cycles during every run.

## Role of LLMs

LLMs should play an important but bounded role in PortalFlow.

They are intended to help with:

* Interpreting user intent
* Assisting in the creation of new automations
* Explaining or refining JSON definitions
* Understanding page content and navigation choices
* Deciding the next best action inside a guided process
* Determining when external tools should be called
* Helping identify target elements when sites change or selectors become unreliable
* Supporting adaptive behavior when strict scripting is insufficient
* Helping generate summaries, logs, or operator-facing explanations

However, PortalFlow should not assume that raw autonomous reasoning alone is enough. The system should combine LLM assistance with structured automation logic and controlled tool usage.

This balance is important. Pure agent behavior may be flexible, but it can be difficult to govern, expensive to run, and inconsistent from one execution to another. Pure scripting may be governable, but it is often too brittle. PortalFlow should sit in the middle.

The product should aim to avoid repeated discovery cycles where the model has to continuously re-figure-out the website during every run. That pattern wastes tokens, slows down execution, and increases variance in outcomes. Instead, PortalFlow should provide high-level steps and process guidance that narrow the decision space while still letting AI absorb the normal variability of human-oriented web applications.

In practical terms, Playwright should provide deterministic browser control, while AI should provide decision-making, interpretation, and resilience. That division of responsibilities is one of the key ideas behind the platform.

## Multi-Provider LLM Strategy

PortalFlow should support multiple LLM backends from the start, using integration patterns compatible with both Anthropic-style and OpenAI-style APIs.

This strategy should allow the platform to:

* Configure multiple providers simultaneously
* Associate different models with different use cases
* Support fallback strategies when a provider is unavailable
* Optimize for quality, speed, or cost depending on the task
* Avoid lock-in to any single vendor or interface style

Examples of areas where different model choices may matter include:

* Automation creation assistance
* Page interpretation during execution
* Error recovery suggestions
* Natural language explanations in the web UI
* Automation validation and improvement

PortalFlow should treat models as configurable components of the system.

## External Tool Strategy

PortalFlow should treat certain operational capabilities as tool integrations rather than native reimplementations.

### SMS and OTP handling via `smscli`

For SMS-based verification, one-time passcodes, and related retrieval flows, PortalFlow should rely on [`smscli`](https://github.com/marinoscar/sink/blob/main/tools/smscli/README.md) from the Sink project. The role of `smscli` is to provide agent-friendly access to SMS messages and OTP extraction from an Android device through the Sink API. This makes it a strong fit for browser automations that encounter MFA or verification prompts and need a controlled way to obtain the required code.

Within PortalFlow, `smscli` should be treated as the standard mechanism for:

* Waiting for OTP codes during login or verification flows
* Filtering messages by sender or other criteria
* Returning machine-friendly values back into the automation runtime
* Supporting AI-guided workflows that need SMS as part of task completion

### Secrets and credentials via `vaultcli`

For credentials, secrets, and sensitive inputs, PortalFlow should rely on [`vaultcli`](https://github.com/marinoscar/vault/blob/main/tools/vaultcli/README.md) from the Vault project. The role of `vaultcli` is to provide secure, agent-friendly access to secrets managed through the Vault API. This makes it the right integration point for usernames, passwords, tokens, account secrets, and other sensitive values used during browser automations.

Within PortalFlow, `vaultcli` should be treated as the standard mechanism for:

* Retrieving login credentials and tokens for automations
* Accessing structured secrets required by specific workflows
* Keeping sensitive data outside of raw automation JSON whenever possible
* Enabling secure secret resolution at runtime instead of embedding credentials directly into automations

This approach keeps PortalFlow focused on orchestration and execution while delegating SMS retrieval and secret access to purpose-built tools.

## Initial Runtime Focus: Ubuntu

PortalFlow should initially aim to run on Ubuntu.

This matters because the platform depends on real browser automation, runtime services, and system-level coordination. By focusing first on Ubuntu, PortalFlow can simplify its early architecture around:

* Desktop-based Chrome or Chromium execution
* [Playwright](https://playwright.dev/)-based browser control
* Headed browser sessions rather than headless-first execution
* CLI tooling and local execution
* Gateway hosting
* File and artifact handling
* Service management patterns
* Predictable operational behavior

Additional environments may be supported later, but Ubuntu should be the design center in the first phase.

## Illustrative Example: Retrieving a Phone Bill PDF

A strong example of PortalFlow’s intended operating model is a workflow to retrieve the latest phone bill PDF from a carrier website.

In a guided authoring experience, a user might describe the workflow in simple business steps such as:

* Get credentials for the phone account from `vaultcli`
* Navigate to the billing history page
* Enter the username and continue
* Enter the password and sign in
* Select a phone number for OTP verification
* Wait for the verification code using `smscli`
* Enter the OTP and continue
* Confirm the browser is on the correct billing page
* Analyze the page and select the latest bill by date
* Download the PDF version of the bill
* Upload and share the PDF back to the user through a file-sharing tool

This example captures the core philosophy of PortalFlow.

The user provides the intended journey in structured, high-level steps. PortalFlow should then turn that guidance into a formal automation definition.

Within that execution:

* Deterministic structure defines the expected business flow
* [Playwright](https://playwright.dev/) performs the browser navigation, page interaction, and inspection
* AI helps decide how to identify the right elements, interpret changing page content, choose the next action, and recover from expected variability
* [`vaultcli`](https://github.com/marinoscar/vault/blob/main/tools/vaultcli/README.md) provides credentials securely at runtime
* [`smscli`](https://github.com/marinoscar/sink/blob/main/tools/smscli/README.md) provides OTP retrieval when verification is required
* Artifact-sharing tooling can return the downloaded document back to the user

This is exactly the kind of hybrid model PortalFlow is meant to support. The system should not force the LLM to rediscover the full website flow from scratch during every run. Instead, the automation should already contain the intended process, checkpoints, and tool expectations. AI is then used selectively to absorb the normal variability of human-oriented web applications.

That distinction is critical. It improves reliability, lowers token usage, reduces execution drift, and makes automations easier to debug, review, and refine over time.

## Example Use Cases

PortalFlow is intended for workflows such as:

* Logging into a hotel portal and downloading a folio
* Logging into an airline portal and checking points or miles status
* Retrieving statements or downloadable records from account portals
* Navigating a vendor or partner site to collect structured information
* Completing repetitive but high-variation browser workflows that do not expose useful APIs

These use cases illustrate the broader goal: automate the websites that people actually use, even when those websites were never designed for machine integration.

## Desired User Experience

The desired user experience for PortalFlow should feel like giving a capable digital operator a job to complete.

A user should be able to:

1. Describe the outcome they want
2. Have the platform help generate or refine the automation
3. Review the resulting JSON workflow
4. Execute it through the CLI or web UI
5. Observe progress and logs through the control surface
6. Inspect outputs, downloads, or retrieved data
7. Improve the automation over time

This should feel practical, controlled, and understandable.

## Non-Goals for the Vision

PortalFlow is not intended to be defined primarily as:

* A generic RPA clone
* A toy browser agent with no structure
* A hardcoded script recorder
* A single-provider LLM wrapper
* A pure research experiment detached from operational reality

The platform should be opinionated about combining structured execution, AI assistance, and operational oversight.

## Long-Term Direction

Over time, PortalFlow should mature into a platform where:

* Automations can be authored faster with AI support
* Execution becomes more resilient across changing websites
* Tool integrations become richer and more standardized
* Multi-model strategies improve performance and flexibility
* Operators gain stronger observability and control
* The system becomes a dependable layer for interacting with web applications that lack practical APIs

The long-term ambition is for PortalFlow to become a serious operating system for AI-guided browser automation.

## Summary

PortalFlow is envisioned as an Ubuntu-first, AI-powered browser automation platform that uses Chrome, [Playwright](https://playwright.dev/), structured JSON automations, external tools, and multi-provider LLM support to execute human-like web workflows.

Its purpose is to help users create, manage, and run real-world browser automations through a CLI runtime, a gateway, and a web-based control center. The platform should combine deterministic process guidance with AI-driven decision-making so that browser automation becomes more resilient, cost-aware, repeatable, and operationally trustworthy.

In PortalFlow’s vision, Playwright provides the controlled browser execution layer, while AI provides the reasoning layer needed to deal with changing interfaces, ambiguous page states, and tool decisions. The result should be a practical hybrid model: structured enough to be dependable, but adaptive enough to survive the variability of websites built for humans rather than bots.
