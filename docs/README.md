# Documentation Guide

This directory documents the repository as it exists now, not as it was first proposed.

## Recommended Reading Order

1. [Root README](../README.md)
2. [product.md](./product.md)
3. [architecture.md](./architecture.md)
4. [backend.md](./backend.md)
5. [development.md](./development.md)
6. [PROPOSAL.md](./PROPOSAL.md)

## Document Map

- [product.md](./product.md)
  Current product scope, implemented features, and gaps between the original idea and the shipped code.

- [architecture.md](./architecture.md)
  Runtime boundaries, startup flow, request paths, persistence ownership, and extension rules.

- [backend.md](./backend.md)
  Python backend structure, API endpoints, data model, agent runtime, and storage details.

- [development.md](./development.md)
  Local setup, config handling, testing, and contributor workflows.

- [PROPOSAL.md](./PROPOSAL.md)
  Historical project proposal. Keep it unchanged as the original planning artifact.

## Maintenance Rule

When implementation changes, update:

- `README.md` if the user-facing story or setup steps changed
- one or more files in `docs/` if architecture, APIs, or developer workflows changed

This doc set is intentionally small. Each file should stay focused on one job so teammates can find answers quickly.
