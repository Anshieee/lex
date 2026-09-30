# LEX

A work-in-progress offline AI workbench with local model routing, document retrieval, and human approval gates.

## Working branch

The current implementation is on `feat/sih-lex-complete-core`. This README describes that branch, not the older `main` branch. No merge to `main` has been made.

## Implementation

- FastAPI backend and LangGraph task orchestration.
- Local model inference through Ollama.
- Document ingestion and retrieval with LanceDB and BGE embeddings.
- Approval and rejection flow for gated tasks.
- Local authentication with MFA support.
- Audit-chain verification and document/report output.
- Two frontend implementations: `frontend/` and `frontend-sparkle/`.

## Repository layout

- `backend/`: API, agent orchestration, auth, retrieval, tools, and tests.
- `frontend/`: original TanStack/React interface.
- `frontend-sparkle/`: alternative React interface.
- `infra/`: infrastructure work.
- `start.sh`: existing-checkout setup and launch script.

## Current status

Frontend integration and setup still need work. The frontend API configuration and authentication contracts need to be aligned, real knowledge-base ingestion needs to be connected in the UI, and a Linux bootstrap installer is planned.

`start.sh` is not yet a tested remote one-line installer. A clean-install guide, supported hardware requirements, and an end-to-end demo will be added after these gaps are fixed.

## Offline operation

Dependency installation and model downloads require a separate provisioning step. Offline runtime must be tested with the required models and embeddings already cached. Local inference and network monitoring alone are not a guarantee that no data can leave the machine.

## Evidence and limitations

No benchmark, security certification, or complete end-to-end test pass is claimed in this README. Planned documentation includes retrieval/answer evaluation, hardware and latency measurements, and a short demo using sample documents.

This is a temporary README; collaborator contributions and the tested setup instructions still need to be documented.
