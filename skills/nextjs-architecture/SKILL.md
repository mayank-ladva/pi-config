---
name: nextjs-architecture
description: Design, review, or refactor Next.js applications using modular App Router architecture, feature boundaries, Server/Client Component discipline, secure data access, predictable state, and maintainable project structure. Use when structuring a new Next.js app or evaluating an existing one.
---

# Next.js architecture

## Operating principles

1. Inspect the existing `package.json`, `tsconfig.json`, router choice, and directory conventions before changing structure.
2. Preserve a working convention rather than introducing a second architecture.
3. Do not create every possible top-level folder up front. Add a boundary when there is a real ownership or dependency reason.
4. Prefer the smallest change that improves discoverability, testability, or runtime behavior.
5. Keep route composition, feature behavior, shared UI, and infrastructure separate.

## Baseline structure

Use this as a starting point, not a mandatory template:

```text
src/
├── app/                    # Routes, layouts, metadata, route handlers
│   ├── (marketing)/        # URL-free route group
│   ├── dashboard/
│   │   ├── layout.tsx
│   │   ├── loading.tsx
│   │   ├── error.tsx
│   │   ├── page.tsx
│   │   └── settings/page.tsx
│   └── api/                # Only when an HTTP endpoint is needed
├── features/               # Business capabilities and their UI
│   ├── auth/
│   ├── dashboard/
│   └── billing/
├── components/             # Cross-feature UI only
│   ├── ui/                 # Buttons, inputs, dialogs
│   ├── layout/             # Header, navigation, shell
│   └── feedback/           # Alerts, empty states, toasts
├── lib/                    # Cross-cutting infrastructure and small utilities
├── config/                 # Validated environment and app configuration
├── hooks/                  # Cross-feature client hooks only
├── store/                  # Truly global client state only
├── types/                  # Types shared across unrelated modules
└── styles/
```

For small applications, prefer route-local files and a few shared folders over an elaborate `features` system:

```text
src/app/
├── (marketing)/
│   ├── _components/
│   └── page.tsx
└── dashboard/
    ├── _components/
    ├── _lib/
    ├── actions.ts
    ├── error.tsx
    ├── loading.tsx
    └── page.tsx
```

Next.js does not require a particular organization. Files may be colocated inside `app`; only `page` and `route` files expose public entry points. Use route groups `(group)` to organize routes or share a layout without changing the URL. Use private folders `_folder` when an explicit non-route implementation boundary helps.

## Boundaries and dependency direction

Prefer this direction:

```text
app routes → features → shared UI/lib → infrastructure
```

- A route should compose a feature and provide route concerns; it should not contain a large business workflow.
- A feature owns its components, schemas, actions, data access, and types when those are not shared.
- `components/` contains UI that has no feature ownership. Move feature-specific components back into the feature.
- Shared modules must not import from a feature. Avoid circular dependencies and “god” utility modules.
- Keep types near their owner. Promote a type to `types/` only when multiple unrelated features genuinely share it.
- Use `services/` only for a real cross-feature integration boundary. A feature-local `api.ts` or `data.ts` is clearer than a central folder with one-off wrappers.
- Do not add factories, interfaces, repositories, or configuration layers without a second implementation or a real testing/integration need.

## App Router conventions

Use framework file conventions deliberately:

- `layout.tsx`: persistent UI and shared segment structure.
- `page.tsx`: route entry and composition.
- `loading.tsx`: instant segment loading UI; prefer meaningful skeletons.
- `error.tsx`: segment error boundary; it must be a Client Component.
- `not-found.tsx`: not-found UI for the segment.
- `route.ts`: HTTP APIs, webhooks, callbacks, or consumers that need an HTTP contract.
- `template.tsx`: only when a layout must remount on navigation.
- `generateMetadata` and metadata files: route-aware SEO, sharing, icons, sitemap, and robots.

Keep route files thin. Colocate route-only components and queries when they are not reused. Use route groups for sections such as `(marketing)`, `(app)`, or `(admin)` rather than encoding layout concerns in URL names.

## Server and Client Components

- Treat Server Components as the default. Pages and layouts are Server Components unless marked otherwise.
- Add `'use client'` only at the smallest interactive leaf that needs state, event handlers, effects, browser APIs, or a client-only hook.
- A Client Component directive pulls its imported module graph into the client bundle. Do not mark an entire page or layout client-side just to support one widget.
- Pass serializable props across the boundary. Pass Server Components as `children` or slots when that preserves server rendering.
- Keep providers as deep as practical; do not wrap the whole document in a Client Component without need.
- Mark sensitive modules with `import 'server-only'` when accidental client imports would be dangerous. Keep browser-only modules separate as `client-only` when useful.
- Do not import database clients, secrets, filesystem access, or server credentials into Client Components.

## Data fetching and mutations

- Fetch data in Server Components or server-side data modules using `fetch`, an ORM, or a database client. Do not make a Client Component fetch its initial page data in `useEffect` by default.
- Start independent requests before awaiting them and use `Promise.all` when failure semantics allow it. Use request memoization or `React.cache` only when duplicate reads are a demonstrated concern.
- Make cache behavior explicit. Decide whether data is request-time, cached, or revalidated; do not assume framework defaults, which vary by Next.js version and configuration.
- Use `loading.tsx` and focused `Suspense` boundaries to stream slow sections instead of blocking the whole route.
- Use Server Actions/Server Functions for UI mutations when appropriate. Use Route Handlers for public HTTP contracts, webhooks, or integrations that need an endpoint.
- Every Server Action and Route Handler is an untrusted entry point: authenticate, authorize ownership, validate all input, rate-limit sensitive operations, and return only data the client needs.
- After a mutation, use the narrowest correct invalidation (`updateTag`, `revalidateTag`, `revalidatePath`, or `refresh`) and place revalidation before `redirect`.
- Keep data access separate from presentation. A component may call a feature data function, but should not contain raw SQL, authorization policy, or repeated transport parsing.

## State management

Choose the narrowest owner:

1. Component state for local interaction.
2. URL search params/path for shareable, bookmarkable, or navigation state such as filters and pagination.
3. Server state for database/API data; use the framework or an existing client cache deliberately.
4. Context for genuinely cross-cutting values such as theme or session-facing UI state.
5. Zustand, Redux Toolkit, or another installed store only when state is truly cross-route and needs that tool’s capabilities.

Do not use global state to avoid passing two props. Avoid duplicating server data in a client store unless synchronization and invalidation are explicit.

## Type safety, configuration, and security

- Keep TypeScript strict. Avoid `any`; model API success and error shapes explicitly.
- Validate environment variables at startup or server-module load. Never expose secrets through `NEXT_PUBLIC_*`; only intentionally public values use that prefix.
- Keep environment access in a small server-only config module rather than reading `process.env` throughout the UI.
- Validate external input at the boundary (forms, query parameters, headers, webhooks, and action arguments). Use an already-installed schema library or small explicit checks; do not add a dependency for trivial validation.
- Do not trust client-provided records, roles, ownership, or prices. Re-read sensitive facts from an authenticated server-side source.

## UI quality and performance

- Use `next/image`, `next/font`, and `next/link` where they solve the actual problem.
- Prefer semantic HTML, keyboard operation, visible focus, labels, useful empty/error states, and accessible names.
- Add route-level `loading`, `error`, and `not-found` states for user-facing asynchronous routes.
- Use dynamic imports for genuinely heavy client-only modules after measuring or identifying a clear bundle boundary.
- Avoid unnecessary hydration, provider depth, prop serialization, duplicate requests, and layout shifts.
- Keep metadata and canonical URL behavior close to the route that owns it.

## Conventions and tooling

- Use one naming and import convention consistently; configure `@/*` aliases only if the project already uses or benefits from them.
- ESLint, TypeScript checks, formatting, and tests should run in CI. Do not make barrel exports a blanket rule: use them selectively and avoid barrels that mix server/client modules or create cycles.
- Test at the boundary that matters: pure feature logic with unit tests, route behavior with integration tests, and critical journeys with end-to-end tests.
- Use a monorepo only when multiple deployables or independently shared packages justify the operational cost. Turborepo or Nx is not a prerequisite for a single app.

## Review checklist

Before approving a structure or refactor, check:

- Is each route easy to find and is its route file mostly composition?
- Does each feature own its business behavior and avoid imports from unrelated features?
- Are Server/Client boundaries minimal and intentional?
- Are data reads, mutations, cache policy, validation, and authorization visible?
- Is state stored at the narrowest useful scope?
- Are loading, error, not-found, metadata, accessibility, and test boundaries covered?
- Did the change avoid speculative folders, wrappers, dependencies, and broad migrations?

## Official references

- [Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure)
- [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Fetching data](https://nextjs.org/docs/app/getting-started/fetching-data)
- [Server Actions and Mutations](https://nextjs.org/docs/app/guides/server-actions)
