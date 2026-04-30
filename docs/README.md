# Documentation Guide

This directory documents the repository as it exists now, not as it was first proposed.

## Recommended Reading Order

1. [Root README](../README.md)
2. [CLAUDE.md](./CLAUDE.md)
3. [product.md](./product.md)
4. [feature.md](./feature.md)
5. [architecture.md](./architecture.md)
6. [backend.md](./backend.md)
7. [development.md](./development.md)
8. [windows-packaging.md](./windows-packaging.md)
9. [presentation/](./presentation/)

## Document Map

- [CLAUDE.md](./CLAUDE.md)
  Shared coding-agent behavioral prompt. Every agent should read it before changing code in this repository.

- [product.md](./product.md)
  Current product scope, implemented features, and gaps between the original idea and the shipped code.

- [feature.md](./feature.md)
  Working functional requirements used for implementation planning and review.

- [architecture.md](./architecture.md)
  Runtime boundaries, startup flow, request paths, persistence ownership, and extension rules.

- [backend.md](./backend.md)
  Python backend structure, API endpoints, data model, agent runtime, and storage details.

- [development.md](./development.md)
  Local setup, config handling, testing, and contributor workflows.

- [windows-packaging.md](./windows-packaging.md)
  Windows installer workflow, bundled Python runtime expectations, and post-install verification.

- [presentation/](./presentation/)
  Course presentation deliverables, including the historical proposal and design documents.

## Maintenance Rule

When implementation changes, update:

- `README.md` if the user-facing story or setup steps changed
- one or more files in `docs/` if architecture, APIs, or developer workflows changed
- one or more files in `docs/presentation/` if course deliverables or historical planning docs changed

This doc set is intentionally small. Each file should stay focused on one job so teammates can find answers quickly.
