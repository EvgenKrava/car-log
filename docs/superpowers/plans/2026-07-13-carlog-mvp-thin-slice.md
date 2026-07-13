# CarLog MVP Thin Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the full CarLog monorepo and implement one deployable vertical — a user logs in via Cognito, sees their garage, and adds a car — wired end-to-end to real AWS in `us-east-1`.

**Architecture:** pnpm + Turborepo monorepo. Zod contracts are the source of truth; a framework-independent domain package defines the `Car` entity and a `CarRepository` port; a thin Lambda behind API Gateway HTTP API (Cognito JWT authorizer) implements the port over a single DynamoDB table; a Vite/React/MUI SPA uses Cognito Hosted UI + TanStack Query. One CDK stack provisions everything; frontend ships to S3 + CloudFront.

**Tech Stack:** pnpm, Turborepo, TypeScript (strict, `moduleResolution: bundler`), Zod, Vitest, React 18, Vite, MUI, TanStack Query, React Hook Form, react-oidc-context, AWS SDK v3 (`@aws-sdk/lib-dynamodb`), AWS CDK v2.

## Global Constraints

- **Strict TypeScript, never `any`.** Prefer `type`; use `interface` only for service abstractions (ports).
- **Zod is the contract source of truth**; derive types with `z.infer`. No hand-written types duplicating a schema.
- **Domain (`packages/domain`) must not import the AWS SDK** or any framework/infra concern.
- **Thin Lambda handlers:** parse → validate → call domain/repository → shape response.
- **No TODO/stub implementations** — all four `/cars` routes and all five repository methods fully implemented.
- **Extensionless relative imports** (`moduleResolution: "bundler"`).
- **Uploads bypass Lambda** (not built in this slice, but never stream file bytes through Lambda later).
- **Conventional commits.** Commit at the end of each task.
- **AWS:** region `us-east-1`, CLI `--profile yevhenii` for all CDK/AWS operations.
- **No co-authorship trailers** in commits.
- **Car fields:** make, model, year, mileage, nickname?, vin?, licensePlate?, fuelType. `year` int in `1900..2027`; `mileage` non-negative int; `fuelType` ∈ {petrol, diesel, electric, hybrid, lpg, other}.

---

## File Structure

```
package.json                      root, pnpm workspaces + turbo scripts
pnpm-workspace.yaml
turbo.json
tsconfig.base.json                strict compiler opts, bundler resolution
.eslintrc.cjs / .prettierrc / .gitignore
packages/config/                  shared tsconfig preset (package.json, tsconfig.json)
packages/contracts/
  package.json, tsconfig.json, vitest.config.ts
  src/car.ts                      Zod schemas: FuelType, Car, CreateCar, UpdateCar
  src/index.ts                    re-exports
  src/car.test.ts
packages/domain/
  package.json, tsconfig.json, vitest.config.ts
  src/car.ts                      Car type re-export + createCar factory + errors
  src/car-repository.ts           CarRepository interface (port)
  src/id.ts                       id generator seam
  src/index.ts
  src/car.test.ts
apps/api/
  package.json, tsconfig.json, vitest.config.ts
  src/errors.ts                   NotFoundError + withErrorHandling wrapper
  src/dynamo-car-repository.ts     DynamoCarRepository implements CarRepository
  src/router.ts                    method+path routing over /cars
  src/handler.ts                   Lambda entry: build repo, delegate to router
  src/in-memory-car-repository.ts  test fake
  src/router.test.ts
infrastructure/cdk/
  package.json, tsconfig.json, cdk.json
  bin/carlog.ts                    CDK app entry
  lib/carlog-stack.ts              the single stack
apps/web/
  package.json, tsconfig.json, vite.config.ts, index.html, .env.example
  src/main.tsx                     providers: MUI theme, QueryClient, Auth, Router
  src/auth.tsx                     react-oidc-context config + RequireAuth guard
  src/api-client.ts                typed fetch wrapper (auth header + Zod parse)
  src/queries.ts                   useCars, useCreateCar hooks
  src/theme.ts                     MUI light/dark theme
  src/routes/Callback.tsx
  src/routes/Garage.tsx            cards grid + FAB
  src/components/AddCarDialog.tsx  RHF + zodResolver form
scripts/deploy-web.sh              build web with stack outputs, sync S3, invalidate CF
```

---

### Task 1: Root monorepo scaffold + shared config

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`
- Create: `packages/config/package.json`, `packages/config/tsconfig.json`

**Interfaces:**
- Produces: `tsconfig.base.json` (extended by every package); `@carlog/config` package providing a shared tsconfig preset; root scripts `pnpm turbo run build|lint|typecheck|test`.

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
out/
cdk.out/
.env
.env.local
*.tsbuildinfo
.turbo/
.DS_Store
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "infrastructure/*"
```

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "carlog",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test"
  },
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^8.8.0",
    "@typescript-eslint/parser": "^8.8.0",
    "eslint": "^8.57.0",
    "prettier": "^3.3.3",
    "turbo": "^2.1.3",
    "typescript": "^5.6.2"
  }
}
```

- [ ] **Step 4: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {},
    "test": { "dependsOn": ["^build"] }
  }
}
```

- [ ] **Step 5: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 6: Create `.prettierrc`**

```json
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }
```

- [ ] **Step 7: Create `.eslintrc.cjs`**

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  env: { node: true, es2022: true, browser: true },
  ignorePatterns: ['dist', 'cdk.out', 'node_modules', '*.cjs'],
  rules: { '@typescript-eslint/no-explicit-any': 'error' },
};
```

- [ ] **Step 8: Create `packages/config/package.json`**

```json
{
  "name": "@carlog/config",
  "version": "0.0.0",
  "private": true,
  "files": ["tsconfig.json"]
}
```

- [ ] **Step 9: Create `packages/config/tsconfig.json`** (re-exports base for packages to extend)

```json
{ "extends": "../../tsconfig.base.json" }
```

- [ ] **Step 10: Install and verify workspace resolves**

Run: `pnpm install`
Expected: completes, creates `pnpm-lock.yaml`, links `@carlog/config`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm+turbo monorepo with shared TS/lint config"
```

---

### Task 2: Contracts package (Zod schemas)

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/vitest.config.ts`
- Create: `packages/contracts/src/car.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/car.test.ts`

**Interfaces:**
- Produces: `CarSchema`, `CreateCarSchema`, `UpdateCarSchema`, `FuelTypeSchema` (Zod objects) and types `Car`, `CreateCarInput`, `UpdateCarInput`, `FuelType` via `z.infer`. `Car` = `{ id, ownerId, make, model, year, mileage, nickname?, vin?, licensePlate?, fuelType, createdAt, updatedAt }`. `CreateCarInput` = `Car` minus `{id, ownerId, createdAt, updatedAt}`. `UpdateCarInput` = partial of `CreateCarInput`.

- [ ] **Step 1: Create `packages/contracts/package.json`**

```json
{
  "name": "@carlog/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "@carlog/config": "workspace:*", "typescript": "^5.6.2", "vitest": "^2.1.1" }
}
```

- [ ] **Step 2: Create `packages/contracts/tsconfig.json`**

```json
{
  "extends": "@carlog/config/tsconfig.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/contracts/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node' } });
```

- [ ] **Step 4: Write the failing test — `packages/contracts/src/car.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { CreateCarSchema, CarSchema } from './car';

describe('CreateCarSchema', () => {
  const valid = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 45000, fuelType: 'petrol' };

  it('accepts a valid car', () => {
    expect(CreateCarSchema.parse(valid)).toMatchObject(valid);
  });

  it('rejects a year before 1900', () => {
    expect(() => CreateCarSchema.parse({ ...valid, year: 1899 })).toThrow();
  });

  it('rejects negative mileage', () => {
    expect(() => CreateCarSchema.parse({ ...valid, mileage: -1 })).toThrow();
  });

  it('rejects an unknown fuelType', () => {
    expect(() => CreateCarSchema.parse({ ...valid, fuelType: 'coal' })).toThrow();
  });

  it('normalizes empty optional strings to undefined', () => {
    const parsed = CreateCarSchema.parse({ ...valid, vin: '', nickname: '' });
    expect(parsed.vin).toBeUndefined();
    expect(parsed.nickname).toBeUndefined();
  });
});

describe('CarSchema', () => {
  it('requires id, ownerId and timestamps', () => {
    expect(() => CarSchema.parse({ make: 'x', model: 'y', year: 2020, mileage: 0, fuelType: 'petrol' })).toThrow();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @carlog/contracts test`
Expected: FAIL — cannot resolve `./car`.

- [ ] **Step 6: Create `packages/contracts/src/car.ts`**

```ts
import { z } from 'zod';

export const FuelTypeSchema = z.enum(['petrol', 'diesel', 'electric', 'hybrid', 'lpg', 'other']);

const emptyToUndefined = (s: z.ZodString) =>
  z.preprocess((v) => (v === '' ? undefined : v), s.optional());

export const CreateCarSchema = z.object({
  make: z.string().min(1).max(60),
  model: z.string().min(1).max(60),
  year: z.number().int().min(1900).max(2027),
  mileage: z.number().int().min(0),
  fuelType: FuelTypeSchema,
  nickname: emptyToUndefined(z.string().max(60)),
  vin: emptyToUndefined(z.string().regex(/^[A-HJ-NPR-Z0-9]{11,17}$/i, 'invalid VIN')),
  licensePlate: emptyToUndefined(z.string().max(15)),
});

export const CarSchema = CreateCarSchema.extend({
  id: z.string().uuid(),
  ownerId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const UpdateCarSchema = CreateCarSchema.partial();

export type FuelType = z.infer<typeof FuelTypeSchema>;
export type Car = z.infer<typeof CarSchema>;
export type CreateCarInput = z.infer<typeof CreateCarSchema>;
export type UpdateCarInput = z.infer<typeof UpdateCarSchema>;
```

- [ ] **Step 7: Create `packages/contracts/src/index.ts`**

```ts
export * from './car';
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @carlog/contracts test`
Expected: PASS (6 tests).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(contracts): add Car Zod schemas as contract source of truth"
```

---

### Task 3: Domain package (Car factory + repository port)

**Files:**
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/vitest.config.ts`
- Create: `packages/domain/src/id.ts`, `packages/domain/src/car.ts`, `packages/domain/src/car-repository.ts`, `packages/domain/src/index.ts`
- Test: `packages/domain/src/car.test.ts`

**Interfaces:**
- Consumes: `Car`, `CreateCarInput`, `UpdateCarInput`, `CreateCarSchema` from `@carlog/contracts`.
- Produces:
  - `createCar(ownerId: string, input: CreateCarInput, deps?: { newId?: () => string; now?: () => string }): Car` — validates input against `CreateCarSchema`, assigns `id`, `ownerId`, `createdAt`, `updatedAt`.
  - `interface CarRepository { create(car: Car): Promise<Car>; listByOwner(ownerId: string): Promise<Car[]>; getById(ownerId: string, id: string): Promise<Car | null>; update(ownerId: string, id: string, patch: UpdateCarInput): Promise<Car>; delete(ownerId: string, id: string): Promise<void>; }`
  - `class CarNotFoundError extends Error`.

- [ ] **Step 1: Create `packages/domain/package.json`**

```json
{
  "name": "@carlog/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "dependencies": { "@carlog/contracts": "workspace:*", "zod": "^3.23.8" },
  "devDependencies": { "@carlog/config": "workspace:*", "typescript": "^5.6.2", "vitest": "^2.1.1" }
}
```

- [ ] **Step 2: Create `packages/domain/tsconfig.json`**

```json
{
  "extends": "@carlog/config/tsconfig.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/domain/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node' } });
```

- [ ] **Step 4: Write the failing test — `packages/domain/src/car.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createCar } from './car';

const input = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 45000, fuelType: 'petrol' as const };
const deps = { newId: () => 'fixed-id', now: () => '2026-07-13T00:00:00.000Z' };

describe('createCar', () => {
  it('assigns id, ownerId and timestamps', () => {
    const car = createCar('user-1', input, deps);
    expect(car).toMatchObject({
      id: 'fixed-id', ownerId: 'user-1', make: 'Toyota',
      createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
    });
  });

  it('rejects invalid input (bad year)', () => {
    expect(() => createCar('user-1', { ...input, year: 1800 }, deps)).toThrow();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @carlog/domain test`
Expected: FAIL — cannot resolve `./car`.

- [ ] **Step 6: Create `packages/domain/src/id.ts`**

```ts
import { randomUUID } from 'node:crypto';
export const newId = (): string => randomUUID();
export const nowIso = (): string => new Date().toISOString();
```

- [ ] **Step 7: Create `packages/domain/src/car.ts`**

```ts
import { CreateCarSchema, type Car, type CreateCarInput } from '@carlog/contracts';
import { newId as defaultNewId, nowIso } from './id';

export type CreateCarDeps = { newId?: () => string; now?: () => string };

export function createCar(ownerId: string, input: CreateCarInput, deps: CreateCarDeps = {}): Car {
  const data = CreateCarSchema.parse(input);
  const id = (deps.newId ?? defaultNewId)();
  const timestamp = (deps.now ?? nowIso)();
  return { ...data, id, ownerId, createdAt: timestamp, updatedAt: timestamp };
}

export class CarNotFoundError extends Error {
  constructor(id: string) {
    super(`Car ${id} not found`);
    this.name = 'CarNotFoundError';
  }
}
```

- [ ] **Step 8: Create `packages/domain/src/car-repository.ts`**

```ts
import type { Car, UpdateCarInput } from '@carlog/contracts';

export interface CarRepository {
  create(car: Car): Promise<Car>;
  listByOwner(ownerId: string): Promise<Car[]>;
  getById(ownerId: string, id: string): Promise<Car | null>;
  update(ownerId: string, id: string, patch: UpdateCarInput): Promise<Car>;
  delete(ownerId: string, id: string): Promise<void>;
}
```

- [ ] **Step 9: Create `packages/domain/src/index.ts`**

```ts
export * from './car';
export * from './car-repository';
export { newId, nowIso } from './id';
```

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm --filter @carlog/domain test`
Expected: PASS (2 tests).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(domain): add createCar factory and CarRepository port"
```

---

### Task 4: API layer (router, error wrapper, in-memory fake) — tested without AWS

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`
- Create: `apps/api/src/errors.ts`, `apps/api/src/router.ts`, `apps/api/src/in-memory-car-repository.ts`
- Test: `apps/api/src/router.test.ts`

**Interfaces:**
- Consumes: `createCar`, `CarRepository`, `CarNotFoundError` from `@carlog/domain`; `CreateCarSchema`, `UpdateCarSchema`, `Car` from `@carlog/contracts`.
- Produces:
  - `type ApiEvent = { method: string; path: string; ownerId: string | null; pathParams: Record<string,string>; body: unknown }`
  - `type ApiResult = { statusCode: number; body: string }`
  - `route(repo: CarRepository, event: ApiEvent): Promise<ApiResult>` — dispatches `/cars` CRUD, wrapped in error handling.
  - `class InMemoryCarRepository implements CarRepository` (test fake).
  - `NotFoundError`, `withErrorHandling`.

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@carlog/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.658.0",
    "@aws-sdk/lib-dynamodb": "^3.658.0",
    "@carlog/contracts": "workspace:*",
    "@carlog/domain": "workspace:*",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@carlog/config": "workspace:*",
    "@types/aws-lambda": "^8.10.145",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

Note: `@carlog/api` has no `build` script — CDK's `NodejsFunction` bundles `src/handler.ts` directly with esbuild.

- [ ] **Step 2: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "@carlog/config/tsconfig.json",
  "compilerOptions": { "noEmit": true, "types": ["node"] },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node' } });
```

- [ ] **Step 4: Write the failing test — `apps/api/src/router.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { route, type ApiEvent } from './router';
import { InMemoryCarRepository } from './in-memory-car-repository';

let repo: InMemoryCarRepository;
beforeEach(() => { repo = new InMemoryCarRepository(); });

const base = { pathParams: {}, body: null } as const;
const validBody = { make: 'Toyota', model: 'Corolla', year: 2020, mileage: 45000, fuelType: 'petrol' };

describe('route', () => {
  it('POST /cars creates a car scoped to the owner', async () => {
    const res = await route(repo, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: validBody });
    expect(res.statusCode).toBe(201);
    const car = JSON.parse(res.body);
    expect(car).toMatchObject({ make: 'Toyota', ownerId: 'u1' });
    expect(car.id).toBeDefined();
  });

  it('GET /cars lists only the owner cars', async () => {
    await route(repo, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: validBody });
    await route(repo, { ...base, method: 'POST', path: '/cars', ownerId: 'u2', body: validBody });
    const res = await route(repo, { ...base, method: 'GET', path: '/cars', ownerId: 'u1' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(1);
  });

  it('returns 400 on invalid body', async () => {
    const res = await route(repo, { ...base, method: 'POST', path: '/cars', ownerId: 'u1', body: { make: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when ownerId is missing', async () => {
    const res = await route(repo, { ...base, method: 'GET', path: '/cars', ownerId: null });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 deleting a missing car', async () => {
    const res = await route(repo, { ...base, method: 'DELETE', path: '/cars/nope', ownerId: 'u1', pathParams: { id: 'nope' } });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @carlog/api test`
Expected: FAIL — cannot resolve `./router`.

- [ ] **Step 6: Create `apps/api/src/errors.ts`**

```ts
import { ZodError } from 'zod';
import { CarNotFoundError } from '@carlog/domain';

export class NotFoundError extends Error {}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Content-Type': 'application/json',
};

export type ApiResult = { statusCode: number; headers: Record<string, string>; body: string };

export function ok(statusCode: number, payload: unknown): ApiResult {
  return { statusCode, headers: CORS, body: JSON.stringify(payload ?? null) };
}

export async function withErrorHandling(fn: () => Promise<ApiResult>): Promise<ApiResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ZodError) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'ValidationError', issues: err.issues }) };
    }
    if (err instanceof CarNotFoundError || err instanceof NotFoundError) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'NotFound', message: err.message }) };
    }
    console.error('Unhandled error', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'InternalError' }) };
  }
}
```

- [ ] **Step 7: Create `apps/api/src/in-memory-car-repository.ts`**

```ts
import type { Car, UpdateCarInput } from '@carlog/contracts';
import { CarNotFoundError, type CarRepository } from '@carlog/domain';

export class InMemoryCarRepository implements CarRepository {
  private cars = new Map<string, Car>();
  private key(ownerId: string, id: string) { return `${ownerId}#${id}`; }

  async create(car: Car): Promise<Car> {
    this.cars.set(this.key(car.ownerId, car.id), car);
    return car;
  }
  async listByOwner(ownerId: string): Promise<Car[]> {
    return [...this.cars.values()].filter((c) => c.ownerId === ownerId);
  }
  async getById(ownerId: string, id: string): Promise<Car | null> {
    return this.cars.get(this.key(ownerId, id)) ?? null;
  }
  async update(ownerId: string, id: string, patch: UpdateCarInput): Promise<Car> {
    const existing = this.cars.get(this.key(ownerId, id));
    if (!existing) throw new CarNotFoundError(id);
    const updated: Car = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.cars.set(this.key(ownerId, id), updated);
    return updated;
  }
  async delete(ownerId: string, id: string): Promise<void> {
    if (!this.cars.delete(this.key(ownerId, id))) throw new CarNotFoundError(id);
  }
}
```

- [ ] **Step 8: Create `apps/api/src/router.ts`**

```ts
import { CreateCarSchema, UpdateCarSchema } from '@carlog/contracts';
import { createCar, type CarRepository } from '@carlog/domain';
import { ok, withErrorHandling, type ApiResult } from './errors';

export type ApiEvent = {
  method: string;
  path: string;
  ownerId: string | null;
  pathParams: Record<string, string>;
  body: unknown;
};

export function route(repo: CarRepository, event: ApiEvent): Promise<ApiResult> {
  return withErrorHandling(async () => {
    const { method, path, ownerId, pathParams, body } = event;
    if (!ownerId) return { statusCode: 401, headers: {}, body: JSON.stringify({ error: 'Unauthorized' }) };
    const id = pathParams.id;

    if (path === '/cars' && method === 'GET') return ok(200, await repo.listByOwner(ownerId));
    if (path === '/cars' && method === 'POST') {
      const car = createCar(ownerId, CreateCarSchema.parse(body));
      return ok(201, await repo.create(car));
    }
    if (id && method === 'PUT') return ok(200, await repo.update(ownerId, id, UpdateCarSchema.parse(body)));
    if (id && method === 'DELETE') { await repo.delete(ownerId, id); return ok(204, null); }
    if (id && method === 'GET') {
      const car = await repo.getById(ownerId, id);
      return car ? ok(200, car) : ok(404, { error: 'NotFound' });
    }
    return { statusCode: 404, headers: {}, body: JSON.stringify({ error: 'NoRoute' }) };
  });
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @carlog/api test`
Expected: PASS (5 tests).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(api): add /cars router, error wrapper, in-memory repo fake"
```

---

### Task 5: DynamoDB repository + Lambda handler

**Files:**
- Create: `apps/api/src/dynamo-car-repository.ts`, `apps/api/src/handler.ts`

**Interfaces:**
- Consumes: `CarRepository`, `CarNotFoundError` from `@carlog/domain`; `route`, `ApiEvent` from `./router`; `Car`, `UpdateCarInput` from `@carlog/contracts`.
- Produces:
  - `class DynamoCarRepository implements CarRepository` — single-table encoding `PK=USER#<ownerId>`, `SK=CAR#<id>`; constructed with `(tableName, DynamoDBDocumentClient)`.
  - `handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2>` — Lambda entry.

- [ ] **Step 1: Create `apps/api/src/dynamo-car-repository.ts`**

`update` re-writes the whole item via `PutCommand` — simplest correct approach for the
flat `Car` shape (no partial-attribute update needed). Imports match usage (no `UpdateCommand`).

```ts
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Car, UpdateCarInput } from '@carlog/contracts';
import { CarNotFoundError, type CarRepository } from '@carlog/domain';

const pk = (ownerId: string) => `USER#${ownerId}`;
const sk = (id: string) => `CAR#${id}`;

type Row = Car & { PK: string; SK: string };
const toRow = (car: Car): Row => ({ ...car, PK: pk(car.ownerId), SK: sk(car.id) });
const toCar = (row: Record<string, unknown>): Car => {
  const { PK, SK, ...car } = row as Row;
  return car;
};

export class DynamoCarRepository implements CarRepository {
  constructor(private readonly tableName: string, private readonly client: DynamoDBDocumentClient) {}

  async create(car: Car): Promise<Car> {
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(car) }));
    return car;
  }

  async listByOwner(ownerId: string): Promise<Car[]> {
    const res = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk(ownerId), ':sk': 'CAR#' },
    }));
    return (res.Items ?? []).map(toCar);
  }

  async getById(ownerId: string, id: string): Promise<Car | null> {
    const res = await this.client.send(new GetCommand({
      TableName: this.tableName, Key: { PK: pk(ownerId), SK: sk(id) },
    }));
    return res.Item ? toCar(res.Item) : null;
  }

  async update(ownerId: string, id: string, patch: UpdateCarInput): Promise<Car> {
    const existing = await this.getById(ownerId, id);
    if (!existing) throw new CarNotFoundError(id);
    const updated: Car = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this.client.send(new PutCommand({ TableName: this.tableName, Item: toRow(updated) }));
    return updated;
  }

  async delete(ownerId: string, id: string): Promise<void> {
    const existing = await this.getById(ownerId, id);
    if (!existing) throw new CarNotFoundError(id);
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: pk(ownerId), SK: sk(id) } }));
  }
}
```

- [ ] **Step 2: Create `apps/api/src/handler.ts`**

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoCarRepository } from './dynamo-car-repository';
import { route, type ApiEvent } from './router';

const tableName = process.env.TABLE_NAME ?? '';
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const repo = new DynamoCarRepository(tableName, client);

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const apiEvent: ApiEvent = {
    method: event.requestContext.http.method,
    path: event.requestContext.http.path,
    ownerId: event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined ?? null,
    pathParams: event.pathParameters ? (event.pathParameters as Record<string, string>) : {},
    body: event.body ? JSON.parse(event.body) : null,
  };
  const result = await route(repo, apiEvent);
  return { statusCode: result.statusCode, headers: result.headers, body: result.body };
}
```

- [ ] **Step 3: Typecheck the api package**

Run: `pnpm --filter @carlog/api typecheck`
Expected: PASS, no `any`/unused errors.

- [ ] **Step 4: Re-run api tests (router still green)**

Run: `pnpm --filter @carlog/api test`
Expected: PASS (5 tests) — Dynamo repo isn't unit-tested (verified live in deploy).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): add DynamoDB car repository and Lambda handler"
```

---

### Task 6: CDK stack (Cognito, DynamoDB, HTTP API + Lambda, S3 + CloudFront)

**Files:**
- Create: `infrastructure/cdk/package.json`, `infrastructure/cdk/tsconfig.json`, `infrastructure/cdk/cdk.json`
- Create: `infrastructure/cdk/bin/carlog.ts`, `infrastructure/cdk/lib/carlog-stack.ts`

**Interfaces:**
- Consumes: `apps/api/src/handler.ts` (bundled by `NodejsFunction`).
- Produces: CloudFormation stack `CarLogStack` with outputs `ApiUrl`, `UserPoolId`, `UserPoolClientId`, `CognitoDomain`, `WebBucketName`, `DistributionId`, `WebUrl`.

- [ ] **Step 1: Create `infrastructure/cdk/package.json`**

```json
{
  "name": "@carlog/cdk",
  "version": "0.0.0",
  "private": true,
  "bin": { "carlog": "bin/carlog.ts" },
  "scripts": {
    "synth": "cdk synth",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint bin lib",
    "build": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "aws-cdk-lib": "^2.160.0",
    "constructs": "^10.3.0",
    "@carlog/api": "workspace:*"
  },
  "devDependencies": {
    "@carlog/config": "workspace:*",
    "@types/node": "^22.7.4",
    "aws-cdk": "^2.160.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.6.2"
  }
}
```

- [ ] **Step 2: Create `infrastructure/cdk/tsconfig.json`**

```json
{
  "extends": "@carlog/config/tsconfig.json",
  "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext", "types": ["node"], "noEmit": true },
  "include": ["bin", "lib"]
}
```

- [ ] **Step 3: Create `infrastructure/cdk/cdk.json`**

```json
{ "app": "npx tsx bin/carlog.ts" }
```

Add `tsx` to devDependencies:

Run: `pnpm --filter @carlog/cdk add -D tsx`
Expected: installs tsx.

- [ ] **Step 4: Create `infrastructure/cdk/bin/carlog.ts`**

```ts
import { App } from 'aws-cdk-lib';
import { CarLogStack } from '../lib/carlog-stack';

const app = new App();
new CarLogStack(app, 'CarLogStack', {
  env: { region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' },
});
```

- [ ] **Step 5: Create `infrastructure/cdk/lib/carlog-stack.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CfnOutput, Duration, RemovalPolicy, Stack, type StackProps,
} from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import {
  AccountRecovery, OAuthScope, UserPool, UserPoolClient, UserPoolClientIdentityProvider,
} from 'aws-cdk-lib/aws-cognito';
import { HttpApi, CorsHttpMethod, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import type { Construct } from 'constructs';

const __dirnameLocal = dirname(fileURLToPath(import.meta.url));

export class CarLogStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const table = new Table(this, 'CarLogTable', {
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const userPool = new UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const domain = userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: `carlog-${this.account}` },
    });

    // Web origin known after distribution is created; use placeholder callback that we
    // reconcile post-deploy via CLI, plus localhost for dev.
    const client = new UserPoolClient(this, 'UserPoolClient', {
      userPool,
      generateSecret: false,
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        callbackUrls: ['http://localhost:5173/callback'],
        logoutUrls: ['http://localhost:5173'],
      },
    });

    const fn = new NodejsFunction(this, 'CarsFn', {
      runtime: Runtime.NODEJS_20_X,
      entry: join(__dirnameLocal, '../../../apps/api/src/handler.ts'),
      handler: 'handler',
      environment: { TABLE_NAME: table.tableName },
      timeout: Duration.seconds(10),
      logRetention: RetentionDays.ONE_WEEK,
      bundling: { format: undefined },
    });
    table.grantReadWriteData(fn);

    const authorizer = new HttpJwtAuthorizer('JwtAuthorizer', userPool.userPoolProviderUrl, {
      jwtAudience: [client.userPoolClientId],
    });

    const httpApi = new HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PUT, CorsHttpMethod.DELETE, CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });
    const integration = new HttpLambdaIntegration('CarsIntegration', fn);
    httpApi.addRoutes({ path: '/cars', methods: [HttpMethod.GET, HttpMethod.POST], integration, authorizer });
    httpApi.addRoutes({ path: '/cars/{id}', methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE], integration, authorizer });

    const webBucket = new Bucket(this, 'WebBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new Distribution(this, 'WebDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'CognitoDomain', { value: domain.baseUrl() });
    new CfnOutput(this, 'WebBucketName', { value: webBucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'WebUrl', { value: `https://${distribution.distributionDomainName}` });
  }
}
```

- [ ] **Step 6: Synth the stack**

Run: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk synth`
Expected: PASS — prints CloudFormation template, no synth errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(cdk): add CarLog stack (Cognito, DynamoDB, HTTP API, S3+CloudFront)"
```

---

### Task 7: Deploy backend + reconcile Cognito callback URLs

**Files:**
- Create: `scripts/deploy-web.sh`

**Interfaces:**
- Consumes: CDK stack outputs.
- Produces: a deployed stack; `scripts/deploy-web.sh` that builds the web app with real outputs, syncs to S3, invalidates CloudFront.

- [ ] **Step 1: Bootstrap CDK (once per account/region)**

Run: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk exec cdk bootstrap aws://unknown/us-east-1`
Expected: bootstrap stack created or "already bootstrapped". (If account id needed, resolve via `aws sts get-caller-identity --profile yevhenii`.)

- [ ] **Step 2: Deploy the stack**

Run: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk exec cdk deploy --require-approval never`
Expected: deploys; prints the 7 outputs. Record them.

- [ ] **Step 3: Create `scripts/deploy-web.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
export AWS_PROFILE=yevhenii
STACK=CarLogStack
out() { aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }

API_URL=$(out ApiUrl)
POOL_ID=$(out UserPoolId)
CLIENT_ID=$(out UserPoolClientId)
COGNITO_DOMAIN=$(out CognitoDomain)
BUCKET=$(out WebBucketName)
DIST_ID=$(out DistributionId)
WEB_URL=$(out WebUrl)

cat > apps/web/.env.production <<EOF
VITE_API_URL=$API_URL
VITE_COGNITO_AUTHORITY=https://cognito-idp.us-east-1.amazonaws.com/$POOL_ID
VITE_COGNITO_CLIENT_ID=$CLIENT_ID
VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN
VITE_REDIRECT_URI=$WEB_URL/callback
VITE_LOGOUT_URI=$WEB_URL
EOF

# Reconcile Cognito callback/logout URLs to the live CloudFront URL
aws cognito-idp update-user-pool-client --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
  --callback-urls "$WEB_URL/callback" "http://localhost:5173/callback" \
  --logout-urls "$WEB_URL" "http://localhost:5173" \
  --allowed-o-auth-flows code --allowed-o-auth-scopes openid email profile \
  --allowed-o-auth-flows-user-pool-client \
  --supported-identity-providers COGNITO >/dev/null

pnpm --filter @carlog/web build
aws s3 sync apps/web/dist "s3://$BUCKET" --delete
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null
echo "Deployed web to $WEB_URL"
```

Run: `chmod +x scripts/deploy-web.sh`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: add web deploy script and reconcile Cognito URLs"
```

Note: `scripts/deploy-web.sh` is run in Task 9 after the web app exists.

---

### Task 8: Web app (auth, garage, add-car) — build passes locally

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/.env.example`
- Create: `apps/web/src/main.tsx`, `apps/web/src/theme.ts`, `apps/web/src/auth.tsx`, `apps/web/src/api-client.ts`, `apps/web/src/queries.ts`
- Create: `apps/web/src/routes/Callback.tsx`, `apps/web/src/routes/Garage.tsx`, `apps/web/src/components/AddCarDialog.tsx`

**Interfaces:**
- Consumes: `CarSchema`, `CreateCarSchema`, `Car`, `CreateCarInput`, `FuelTypeSchema` from `@carlog/contracts`.
- Produces: a Vite SPA whose `pnpm --filter @carlog/web build` succeeds.

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@carlog/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src",
    "preview": "vite preview"
  },
  "dependencies": {
    "@carlog/contracts": "workspace:*",
    "@emotion/react": "^11.13.3",
    "@emotion/styled": "^11.13.0",
    "@hookform/resolvers": "^3.9.0",
    "@mui/icons-material": "^6.1.2",
    "@mui/material": "^6.1.2",
    "@tanstack/react-query": "^5.59.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.53.0",
    "react-oidc-context": "^3.2.0",
    "react-router-dom": "^6.26.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@carlog/config": "workspace:*",
    "@types/react": "^18.3.10",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.2",
    "typescript": "^5.6.2",
    "vite": "^5.4.8"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "@carlog/config/tsconfig.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["vite/client"], "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/web/vite.config.ts`**

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({ plugins: [react()] });
```

- [ ] **Step 4: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CarLog</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `apps/web/.env.example`**

```
VITE_API_URL=
VITE_COGNITO_AUTHORITY=
VITE_COGNITO_CLIENT_ID=
VITE_COGNITO_DOMAIN=
VITE_REDIRECT_URI=http://localhost:5173/callback
VITE_LOGOUT_URI=http://localhost:5173
```

- [ ] **Step 6: Create `apps/web/src/theme.ts`**

```ts
import { createTheme } from '@mui/material/styles';
export const buildTheme = (mode: 'light' | 'dark') =>
  createTheme({ palette: { mode, primary: { main: '#1565c0' } } });
```

- [ ] **Step 7: Create `apps/web/src/auth.tsx`**

```tsx
import { type ReactNode } from 'react';
import { AuthProvider, useAuth, type AuthProviderProps } from 'react-oidc-context';
import { CircularProgress, Box } from '@mui/material';

const oidcConfig: AuthProviderProps = {
  authority: import.meta.env.VITE_COGNITO_AUTHORITY,
  client_id: import.meta.env.VITE_COGNITO_CLIENT_ID,
  redirect_uri: import.meta.env.VITE_REDIRECT_URI,
  post_logout_redirect_uri: import.meta.env.VITE_LOGOUT_URI,
  response_type: 'code',
  scope: 'openid email profile',
  // Cognito uses its own domain for authorize/token; metadata is served at the authority.
};

export function AppAuthProvider({ children }: { children: ReactNode }) {
  return <AuthProvider {...oidcConfig}>{children}</AuthProvider>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.isLoading) {
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
  }
  if (!auth.isAuthenticated) {
    void auth.signinRedirect();
    return null;
  }
  return <>{children}</>;
}
```

- [ ] **Step 8: Create `apps/web/src/api-client.ts`**

```ts
import { z } from 'zod';
import { CarSchema, type Car, type CreateCarInput } from '@carlog/contracts';

const CarListSchema = z.array(CarSchema);
const API_URL = import.meta.env.VITE_API_URL as string;

async function request<T>(token: string, path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  if (res.status === 204) return undefined as T;
  return schema.parse(await res.json());
}

export const listCars = (token: string) => request(token, '/cars', CarListSchema);
export const createCar = (token: string, input: CreateCarInput): Promise<Car> =>
  request(token, '/cars', CarSchema, { method: 'POST', body: JSON.stringify(input) });
```

- [ ] **Step 9: Create `apps/web/src/queries.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from 'react-oidc-context';
import type { CreateCarInput } from '@carlog/contracts';
import { createCar, listCars } from './api-client';

export function useCars() {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  return useQuery({ queryKey: ['cars'], queryFn: () => listCars(token), enabled: Boolean(token) });
}

export function useCreateCar() {
  const auth = useAuth();
  const token = auth.user?.access_token ?? '';
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCarInput) => createCar(token, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cars'] }),
  });
}
```

- [ ] **Step 10: Create `apps/web/src/components/AddCarDialog.tsx`**

```tsx
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField,
} from '@mui/material';
import { CreateCarSchema, FuelTypeSchema, type CreateCarInput } from '@carlog/contracts';
import { useCreateCar } from '../queries';

const FUEL_TYPES = FuelTypeSchema.options;

export function AddCarDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mutateAsync, isPending } = useCreateCar();
  const { control, handleSubmit, reset, formState: { errors } } = useForm<CreateCarInput>({
    resolver: zodResolver(CreateCarSchema),
    defaultValues: { make: '', model: '', year: 2020, mileage: 0, fuelType: 'petrol' },
  });

  const onSubmit = handleSubmit(async (data) => { await mutateAsync(data); reset(); onClose(); });

  const text = (name: keyof CreateCarInput, label: string, type = 'text') => (
    <Controller name={name} control={control} render={({ field }) => (
      <TextField {...field} label={label} type={type} fullWidth
        value={field.value ?? ''}
        onChange={(e) => field.onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
        error={Boolean(errors[name])} helperText={errors[name]?.message as string | undefined} />
    )} />
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={onSubmit}>
        <DialogTitle>Add a car</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {text('make', 'Make')}
            {text('model', 'Model')}
            {text('year', 'Year', 'number')}
            {text('mileage', 'Mileage', 'number')}
            {text('nickname', 'Nickname')}
            {text('vin', 'VIN')}
            {text('licensePlate', 'License plate')}
            <Controller name="fuelType" control={control} render={({ field }) => (
              <TextField {...field} select label="Fuel type" fullWidth>
                {FUEL_TYPES.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
              </TextField>
            )} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isPending}>Save</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 11: Create `apps/web/src/routes/Garage.tsx`**

```tsx
import { useState } from 'react';
import { useAuth } from 'react-oidc-context';
import {
  AppBar, Box, Button, Card, CardContent, CircularProgress, Container, Fab, Grid,
  Toolbar, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useCars } from '../queries';
import { AddCarDialog } from '../components/AddCarDialog';

export function Garage() {
  const auth = useAuth();
  const { data: cars, isLoading } = useCars();
  const [open, setOpen] = useState(false);

  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>CarLog</Typography>
          <Button color="inherit" onClick={() => void auth.signoutRedirect()}>Sign out</Button>
        </Toolbar>
      </AppBar>
      <Container sx={{ py: 3 }}>
        {isLoading ? <CircularProgress /> : !cars?.length ? (
          <Typography color="text.secondary">Add your first car.</Typography>
        ) : (
          <Grid container spacing={2}>
            {cars.map((car) => (
              <Grid item xs={12} sm={6} md={4} key={car.id}>
                <Card>
                  <CardContent>
                    <Typography variant="h6">{car.nickname || `${car.make} ${car.model}`}</Typography>
                    <Typography color="text.secondary">{car.year} · {car.mileage.toLocaleString()} mi</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Container>
      <Fab color="primary" onClick={() => setOpen(true)} sx={{ position: 'fixed', bottom: 24, right: 24 }}>
        <AddIcon />
      </Fab>
      <AddCarDialog open={open} onClose={() => setOpen(false)} />
      <Box sx={{ height: 80 }} />
    </>
  );
}
```

- [ ] **Step 12: Create `apps/web/src/routes/Callback.tsx`**

```tsx
import { useEffect } from 'react';
import { useAuth } from 'react-oidc-context';
import { useNavigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';

export function Callback() {
  const auth = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!auth.isLoading && auth.isAuthenticated) navigate('/', { replace: true });
  }, [auth.isLoading, auth.isAuthenticated, navigate]);
  return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
}
```

- [ ] **Step 13: Create `apps/web/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useMediaQuery, CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppAuthProvider, RequireAuth } from './auth';
import { buildTheme } from './theme';
import { Garage } from './routes/Garage';
import { Callback } from './routes/Callback';

const queryClient = new QueryClient();

function Root() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  return (
    <ThemeProvider theme={buildTheme(prefersDark ? 'dark' : 'light')}>
      <CssBaseline />
      <AppAuthProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route path="/callback" element={<Callback />} />
              <Route path="/" element={<RequireAuth><Garage /></RequireAuth>} />
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </AppAuthProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
```

- [ ] **Step 14: Install new deps and typecheck**

Run: `pnpm install && pnpm --filter @carlog/web typecheck`
Expected: PASS.

- [ ] **Step 15: Build the web app**

Run: `cp apps/web/.env.example apps/web/.env && pnpm --filter @carlog/web build`
Expected: `vite build` succeeds, emits `apps/web/dist`. (Env values are placeholders; real ones come from Task 9.)

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "feat(web): add Cognito auth, garage, and add-car vertical"
```

---

### Task 9: Full verification (repo gates + deploy web + live smoke test)

**Files:** none (verification + deploy).

- [ ] **Step 1: Run all repo gates**

Run: `pnpm install && pnpm turbo run typecheck lint test`
Expected: all packages PASS.

- [ ] **Step 2: Deploy the web app with live outputs**

Run: `AWS_PROFILE=yevhenii ./scripts/deploy-web.sh`
Expected: builds web with real env, syncs to S3, invalidates CloudFront, prints `Deployed web to https://<cf-domain>`.

- [ ] **Step 3: Live smoke test (definition of done)**

Open the printed CloudFront URL in a browser:
1. Redirected to Cognito Hosted UI.
2. Sign up + confirm a test user (email code).
3. Land on the empty Garage ("Add your first car.").
4. Tap the FAB → fill Add Car form → Save.
5. Card appears in the garage.
6. Reload the page → car persists.

Expected: all six steps pass. This proves auth → authorized API → DynamoDB write → read end-to-end.

- [ ] **Step 4: Update CLAUDE.md Commands section**

Replace the "Commands" placeholder in `CLAUDE.md` with the real commands:

```markdown
## Commands

- Install: `pnpm install`
- All gates: `pnpm turbo run build lint typecheck test`
- Single package test: `pnpm --filter @carlog/domain test`
- Single test file: `pnpm --filter @carlog/domain test src/car.test.ts`
- CDK synth: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk synth`
- Deploy backend: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk exec cdk deploy --require-approval never`
- Deploy web: `AWS_PROFILE=yevhenii ./scripts/deploy-web.sh`
- Teardown: `AWS_PROFILE=yevhenii pnpm --filter @carlog/cdk exec cdk destroy`
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: record real build/deploy commands in CLAUDE.md"
```

---

## Self-Review Notes

- **Spec coverage:** monorepo (T1), contracts (T2), domain + port (T3), API router/errors/fake (T4), Dynamo repo + handler (T5), CDK stack incl. Cognito/DynamoDB/HTTP API/JWT authorizer/S3+CloudFront (T6), deploy + Cognito URL reconciliation (T7), web auth/garage/add-car (T8), gates + live smoke test + Commands doc (T9). All spec sections mapped.
- **No TODO rule honored:** all four `/cars` routes and all five repository methods implemented (T4/T5), UI exercises create+list only.
- **Type consistency:** `createCar(ownerId, input, deps?)`, `CarRepository` five methods, `route(repo, event)`, `ApiEvent`/`ApiResult` shapes, and contract type names are used identically across T3–T8.
- **Known deploy caveat:** Cognito callback URL depends on the CloudFront domain, which only exists after deploy — handled by seeding a localhost callback in CDK (T6) and reconciling to the live URL post-deploy via CLI in `deploy-web.sh` (T7).
