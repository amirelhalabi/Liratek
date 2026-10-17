# Frontend Source — Codex Instructions

Read the root [`AGENTS.md`](../../../AGENTS.md) and [`CLAUDE.md`](CLAUDE.md) before changing frontend source. The scoped Claude guide contains detailed `useApi()`, transport parity, component, and test-mocking patterns.

- Feature code uses `useApi()` from `@liratek/ui`; `backendApi.ts` is the transport boundary. Do not add raw `window.api.*` calls or desktop/web transport branches to features.
- Define a payload once using the shared core schema input type and pass that same payload through the API adapter.
- Follow existing React Query and component patterns in the nearest feature. Keep UI derivations and submitted values sourced from one shared computation.
- If changing a React or Next.js performance pattern, consult the `vercel-react-best-practices` skill available in `.agents/skills/`.

