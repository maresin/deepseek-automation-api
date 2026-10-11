# Two-agent pipeline

A client that orchestrates two DeepSeek agents in a researcher/writer
pipeline: the researcher gathers facts, the writer drafts, the
researcher critiques, the writer revises.

The two agents run as separate processes (two Chromium instances, two
isolated chats) and share only the DeepSeek cookie session. The client
treats them as two independent OpenAI-compatible HTTP endpoints.

## Prerequisites

Install and log in to the API **once**:

    cd /path/to/deepseek-automation-api
    npm install && npm run build
    mkdir -p browsers
    PLAYWRIGHT_BROWSERS_PATH=./browsers npx playwright install chromium

    npm start
    # ... log in via the browser window, then Ctrl+C

Generate a 2-agent deployment:

    ./tools/make-multi-agent.sh ~/my-project --agents 2

Start the agents:

    cd ~/my-project/deepseek-agents
    ./scripts/start-all.sh

## Run the pipeline

    pip install requests
    python demo_client.py --deployment ~/my-project/deepseek-agents

## What it does

    Deployment: /home/user/my-project/deepseek-agents
      researcher: agent-1  port 3000
      writer:     agent-2  port 3001

    Checking readiness...
      agent-1: ✓
      agent-2: ✓

    Topic: the Fermi paradox

    1/4  Researcher: gather three facts
       [agent-1] context: 604 / 2,400,000 chars (0%)
         → 1. The Fermi paradox...
    2/4  Writer: draft an introduction
       [agent-2] context: 2,144 / 2,974,630 chars (0.1%)
         → ...
    3/4  Researcher: critique the draft
       ...
    4/4  Writer: revise based on the critique
       ...

    ============================================================
    Final revision:
    ============================================================
    <text>
    ============================================================
    Total wall time: 35.8s

## Options

| Flag | Default | Meaning |
|---|---|---|
| `--deployment PATH` | `./deepseek-agents` | path to a generated deployment |
| `--topic STRING` | `the Fermi paradox` | topic for the pipeline |

## What it demonstrates

- Reading agent ports and API keys from a generated deployment.
- Waiting for readiness before the first request — polling
  `/v1/context/status` rather than `/health`, because `/health` only
  reports that the HTTP port is open, while the DeepSeek client takes
  15–30 more seconds to initialise.
- Handling every recoverable HTTP code:
    - `400` — validation error, no retry
    - `401` — bad key, abort with file path
    - `409` — context exhausted, start a fresh chat and retry
    - `503` — **two cases**:
        - `{"error": {"type": "server_busy"}}` → fatal, the agent
          exits by design
        - `{"error": "Client not ready..."}` → transient, retry
          with exponential backoff
    - `504` — timeout, retry with backoff

## Related

- Generator: [`tools/make-multi-agent.sh`](../../tools/make-multi-agent.sh)
- Multi-agent overview: [README — Multi-agent deployments](../../README.md#multi-agent-deployments)
- Full walkthrough: [Building applications](../../docs/guides/building-applications.md#мультиагентное-приложение)