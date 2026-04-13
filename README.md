# PortalFlow

## Overview

PortalFlow is an AI-powered browser automation platform designed to carry out web-based tasks the way a human would. Its purpose is to navigate websites, complete multi-step workflows, handle interruptions such as one-time passcodes, and retrieve information or documents from online portals with a high degree of flexibility.

The vision behind PortalFlow is simple: many important digital tasks still live inside websites and apps that were built for humans, not APIs. Whether the objective is downloading a hotel folio, checking airline miles, retrieving account information, or completing a repetitive portal workflow, PortalFlow is intended to act as an intelligent operator that can understand context, adapt to changing interfaces, and interact with web applications in a natural way.

## Goal

The goal of PortalFlow is to make browser-based automation more intelligent, resilient, and usable.

Traditional automation often breaks when websites change, when flows become more dynamic, or when real-world steps such as OTP verification or conditional navigation are introduced. PortalFlow is intended to address that gap by combining browser control, AI reasoning, and tool integration into a single platform that can execute end-to-end tasks with human-like behavior and oversight.

PortalFlow is not just about clicking buttons. It is about understanding intent, navigating ambiguity, and completing outcomes.

## What PortalFlow Is Meant to Do

PortalFlow is designed to:

* Navigate websites and portals using a real browser
* Perform login and authentication flows, including OTP-related steps
* Retrieve account data, statements, records, or downloadable documents
* Execute repeatable but flexible workflows across web applications
* Use AI to interpret pages, adapt to different layouts, and decide the next action
* Expose automations through both a command-line experience and a web-based control surface
* Provide visibility into execution through logs, status, and operator controls
* Support the creation and editing of automations in a way that is practical for real operations

## Core Idea

At its core, PortalFlow is built around the idea of an AI-guided digital operator.

Instead of relying only on brittle scripts or fixed selectors, the platform is intended to combine structured automation with reasoning. This allows workflows to remain useful even when interfaces shift, pages contain unexpected content, or the process requires choices that are difficult to fully hardcode in advance.

The objective is to simulate real user interaction as closely as practical while still maintaining control, traceability, and operational discipline.

## Product Intent

PortalFlow is intended to be a platform, not a single-purpose bot.

It is meant to provide a foundation for building, running, monitoring, and improving browser automations that solve practical business and personal workflows. The platform is envisioned as a bridge between human intent and web application execution, allowing operators or systems to instruct an automation to achieve a result rather than merely replay a fixed script.

This means PortalFlow should be able to support:

* Individual task execution
* Reusable automation flows
* Human review and intervention when needed
* Connected tools and services that support real-world workflow completion
* Centralized control and observability through a web application and gateway

## Design Philosophy

PortalFlow is guided by a few principles:

### Human-like interaction

The platform should use the browser in a way that mirrors how a real person would navigate and complete tasks.

### Outcome over script

The focus is on achieving the desired result, not just replaying a rigid sequence of recorded actions.

### Resilience over fragility

Automations should be able to tolerate normal variation in layout, wording, and navigation.

### Visibility and control

Operators should be able to observe execution, review logs, and manage automations with confidence.

### Extensibility

The system should be able to work with external tools and services that are necessary to complete real workflows.

## Why It Exists

Many of the systems people depend on every day do not offer clean APIs for the tasks that matter most. Important workflows often require logging into websites, dealing with portal-specific steps, navigating inconsistent interfaces, and responding to human-oriented verification mechanisms.

PortalFlow exists to make those workflows automatable without pretending the web is cleaner or simpler than it really is. It is designed for the messy reality of real websites, real portals, and real user journeys.

## Vision

The long-term vision for PortalFlow is to become a reliable automation layer for interacting with web-based systems the same way a capable human operator would, but with greater speed, consistency, and scale.

In that vision, PortalFlow becomes a system that can understand a task, navigate the necessary digital environment, coordinate with supporting tools, and deliver a completed outcome with transparency and control.

## Summary

PortalFlow is an AI-powered platform for human-like browser automation. It is intended to navigate web applications, complete end-to-end workflows, handle real-world interruptions such as OTP steps, and provide a controllable environment for running and managing intelligent automations.

## Tools

### CLI — run and manage automations

The [`@portalflow/cli`](tools/cli/README.md) package is the primary runtime. It reads automation JSON files, executes each step in a real Chrome browser via Playwright, handles credential retrieval through `vaultcli`, fetches OTP codes through `smscli`, and reports structured results. Also ships with interactive TUIs for every command, 9 built-in LLM presets (Anthropic, OpenAI, Kimi, DeepSeek, Groq, Mistral, Together AI, OpenRouter, Ollama, plus custom endpoints), configurable storage paths, and optional video recording. See [`tools/cli/README.md`](tools/cli/README.md) for installation and usage.

### Chrome extension — record, edit, and export automations

The [`@portalflow/extension`](tools/extension/README.md) package is a Manifest V3 Chrome extension that records browser workflows, lets you edit them in a side panel (with optional LLM assist), and exports them as JSON files that the CLI can run unmodified. Auto-detects password and OTP fields and wires them to `vaultcli` and `smscli` respectively. See [`tools/extension/README.md`](tools/extension/README.md) for installation and usage.

### Automation JSON format reference

The [`docs/AUTOMATION-JSON-SPEC.md`](docs/AUTOMATION-JSON-SPEC.md) file is the authoritative reference for the automation JSON format that both the CLI and the Chrome extension use. It documents every field, every step type (including the `loop` step for bounded iteration, the `condition` step for deterministic and AI-based branching, and the `call` step for invoking reusable functions), every action shape, selector cascades, template syntax, failure policies, reusable functions and their parameter model, common patterns, three full worked examples, and a schema reference appendix.

Both the CLI and the extension produce and consume files that conform to this spec via the shared `@portalflow/schema` workspace package.
