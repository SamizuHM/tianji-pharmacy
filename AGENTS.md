# Repository Guidelines

## Project Structure & Module Organization

This pnpm workspace powers a pharmacy Q&A, RAG, and ticketing system. The Next.js web app lives in `app/web`, with routes in `app/web/app`, UI in `app/web/components`, and services in `app/web/lib/services`. The Python ML service is in `app/ml-service`. Shared TypeScript types and constants are in `packages/shared/src`. Prisma schema, migrations, and seed data are in `prisma/`. Tests are under `test/`, documentation in `docs/`, seed knowledge in `seed_knowledge/`, and runtime uploads in `uploads/`.

## Build, Test, and Development Commands

- `pnpm install`: install workspace dependencies.
- `pnpm dev:init`: prepare local dependencies, Python venv, database, seed data, and uploads.
- `pnpm dev`: check local prerequisites, run migrations, then start web and ML services.
- `pnpm dev:deps`: start only local PostgreSQL and Qdrant via Docker.
- `pnpm dev:web`: start only the Next.js app.
- `pnpm dev:ml`: start only the ML service.
- `pnpm build`: build the web app.
- `pnpm test`: run Vitest tests once.
- `pnpm test:watch`: run Vitest in watch mode.
- `pnpm check`: run linting, formatting checks, Python linting, and tests.
- `pnpm db:migrate`, `pnpm db:seed`, `pnpm kb:import`, `pnpm kb:rebuild`: manage data and knowledge indexes.

## Coding Style & Naming Conventions

Use TypeScript for web/shared code and Python for the ML service. Prettier formats `ts`, `tsx`, `json`, `css`, and `md`; Tailwind classes are sorted by `prettier-plugin-tailwindcss`. ESLint covers TypeScript/React, and Ruff covers Python. Prefer kebab-case file names, camelCase variables/functions, PascalCase React components, and descriptive service names such as `knowledge-index.ts`.

## Testing Guidelines

Vitest is the primary TypeScript test framework. Place tests under `test/` and mirror the source path where practical. Name test files `*.test.ts`. Add focused tests for service logic, API behavior, data transformations, and regressions. Run `pnpm test` before submitting changes; use `pnpm test:coverage` when touching shared behavior or high-risk flows.

## Commit & Pull Request Guidelines

Recent commits follow Conventional Commits, for example `feat(test): ...`, `chore(lint): ...`, `docs: ...`, and `ci: ...`. Keep messages short and scoped. Pull requests should include a concise summary, testing performed, linked issues or requirements, screenshots for UI changes, and notes about database migrations, environment variables, or knowledge-index rebuilds.

## Security & Configuration Tips

Do not commit real secrets or uploaded private data. Use `.env.example` as the configuration reference and validate local setup with `pnpm check:env`. Treat Prisma migrations, Qdrant index changes, and seed knowledge imports as operational changes that need explicit mention in reviews.
