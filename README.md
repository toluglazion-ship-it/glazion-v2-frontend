# Glazion Apps

The web and mobile clients for Glazion, a platform for glaze research: participants mix and photograph test tiles,
admins run the lab register and review the photos, and potters search the photographed corpus by recipe.

One pnpm + Turborepo workspace: React 19 and Vite for the web apps, Expo and React Native for mobile, TypeScript
throughout.

## Contents

- [Apps](#apps)
- [Packages](#packages)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Checks](#checks)
- [Deployment](#deployment)
- [Notes](#notes)

## Apps

| App | Path | Dev port | Purpose |
| --- | --- | --- | --- |
| Capture | `apps/capture` | 3001 | PWA for participants: work through tile tasks and cup experiments, mark tiles done, photograph them, follow review status. Works offline. |
| Admin | `apps/admin` | 3002 | Lab management: users and participants, base glazes and variations, cup experiments, tasks, materials, capture codes, upload review, photo library, imports, search index and match check. |
| Main | `apps/main` | 3000 | For potters: UMF calculator, recipe-to-image search and chat. |
| Mobile | `apps/mobile` | 8081 | The Main app's features as an iOS/Android app (Expo, React Native). |

## Packages

| Package | Path | Purpose |
| --- | --- | --- |
| `@glazion/types` | `packages/types` | DTOs and enums matching the API contract |
| `@glazion/api-client` | `packages/api-client` | Typed client for the `/api/v2` API, session handling and an in-memory mock backend |
| `@glazion/ui` | `packages/ui` | Design tokens, base styles, app shell, icons and formatters |
| `@glazion/chemistry` | `packages/chemistry` | UMF calculation, materials list, target ranges per cone and cone chart |

## Repository layout

```text
.
├── apps/
│   ├── admin/          admin dashboard (Vite)
│   ├── capture/        participant PWA (Vite, offline upload queue)
│   ├── main/           potter-facing web app (Vite)
│   └── mobile/         iOS/Android app (Expo Router)
├── packages/
│   ├── api-client/     API client, session, mock backend (src/, test/)
│   ├── chemistry/      UMF engine and data (src/, test/)
│   ├── types/          shared types
│   └── ui/             shared design system
├── .github/workflows/  CI: type-check, test and build
├── package.json  pnpm-workspace.yaml  turbo.json  tsconfig.json
└── pnpm-lock.yaml
```

Each web app follows the same structure: `src/pages/` for routes, `src/layouts/` for the app shell,
`src/components/` for shared pieces, `src/lib/` for helpers, and `public/` for icons. Platform-specific code sits in a `.native.ts` (and `.web.ts` for Expo web)
file next to the shared one.

## Getting started

Requires Node 20+ and pnpm 9+.

```bash
pnpm install

pnpm --filter @glazion/admin dev
pnpm --filter @glazion/capture dev
pnpm --filter @glazion/main dev
pnpm --filter @glazion/mobile start      # scan the QR code with Expo Go
```

### Mock backend

Every app can run against an in-memory mock of the API, for UI work without an account:

```bash
pnpm --filter @glazion/admin dev:mock
pnpm --filter @glazion/capture dev:mock
pnpm --filter @glazion/main dev:mock
pnpm --filter @glazion/mobile start:mock     # web:mock opens it in a browser
```

Any password works: sign in as `admin` for the dashboard, or `adaeze` for Capture and the main app. Data resets on
reload. The mock lives in `packages/api-client/src/mock.ts` and is left out of production builds.

## Configuration

The apps use the production API by default. To point an app at another one, add an env file in its folder:

```bash
# apps/admin/.env.local
VITE_API_URL=https://staging.example.com

# apps/mobile/.env.local
EXPO_PUBLIC_API_URL=https://staging.example.com
```

Env files other than the `.env.mock` presets are git-ignored. On mobile the session is kept in the device keychain
(`expo-secure-store`).

## Checks

```bash
pnpm type-check
pnpm test
pnpm build
```

CI runs all three on every pull request and every push to `main` (`.github/workflows/ci.yml`).

The chemistry tests check the UMF engine against 40 reference recipes in `packages/chemistry/test/fixtures.json`,
the same cases the API is tested against. A failing fixture means a result changed: confirm the change with the
lab before updating it.

## Deployment

Each web app deploys as its own Vercel project from this repository, with the project's root directory set to the
app folder (`apps/admin`, `apps/capture`, `apps/main`). Each folder has its own `vercel.json` with the SPA rewrites.

| App | Domain |
| --- | --- |
| Main | `glazion.studio` |
| Capture | `capture.glazion.studio` |
| Admin | `admin.glazion.studio` |

## Notes

- **UMF calculation.** `packages/chemistry/src/chemistry.ts` is the agreed calculation, shared line for line with
  the API. Materials are always picked from the list, never typed, so a recipe can't be calculated with a near-miss
  name. Don't change the arithmetic without the lab's agreement.
- **Capture offline.** Once opened online, Capture keeps working without a connection. Uploads go through a queue
  (`apps/capture/src/lib/uploadQueue.ts`): offline photos are stored in IndexedDB and sent when the connection
  returns, with retries and a growing delay, then left for the user to retry or discard.
- **Password reset** has no API endpoint yet. The main app shows it from sample data, marked "Preview"; switch it
  over by setting `passwordReset` to `false` in `SAMPLE_DATA` (`packages/api-client/src/main.ts`).
