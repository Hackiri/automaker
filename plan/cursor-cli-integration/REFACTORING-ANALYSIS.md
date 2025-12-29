# Cursor CLI Integration - Refactoring Analysis

> Generated: 2024-12-30
> Status: Ready to merge, with recommended follow-up refactoring

## Executive Summary

**Verdict: GOOD TO MERGE** with the understanding that some refactoring would benefit future provider additions. The Cursor integration is **functional and well-implemented**, but the codebase has accumulated some technical debt that makes adding new CLI providers more difficult than it should be.

---

## Severity Levels

| Level               | Meaning                         |
| ------------------- | ------------------------------- |
| 🔴 **Critical**     | Should fix before merge         |
| 🟡 **Important**    | Should address soon after merge |
| 🟢 **Nice-to-have** | Can defer to future refactoring |

---

## Key Findings

### 1. Provider Implementation Quality ✅

**CursorProvider is well-designed:**

- Extends `BaseProvider` correctly
- Uses `spawnJSONLProcess` from `@automaker/platform`
- Has comprehensive error mapping with recovery suggestions
- Proper WSL support for Windows
- Event normalization to `ProviderMessage` format

**However, there's code that would be duplicated for new CLI providers:**

- CLI path detection (~75 lines)
- WSL execution handling (~50 lines)
- Error code mapping infrastructure (~90 lines)
- JSONL stream processing pattern

### 2. Provider Factory - Hardcoded Registration 🟡

**Current State:** Static factory with hardcoded switch statements

```typescript
// provider-factory.ts - lines 67-69
static getAllProviders(): BaseProvider[] {
  return [new ClaudeProvider(), new CursorProvider()];  // Hardcoded
}

// lines 98-108
switch (lowerName) {
  case 'claude':
  case 'anthropic':
    return new ClaudeProvider();
  case 'cursor':
    return new CursorProvider();
  // Must manually add new providers
}
```

**To add a new provider today requires editing 3+ files:**

1. Import in `provider-factory.ts`
2. Add to `getAllProviders()` array
3. Add case(s) to `getProviderByName()` switch
4. Add routing logic to `getProviderNameForModel()`
5. Extend `ModelProvider` type in `settings.ts`

### 3. Route Organization - Asymmetric Patterns 🟡

| Aspect              | Claude                    | Cursor                          |
| ------------------- | ------------------------- | ------------------------------- |
| Status endpoint     | Uses 200-line helper file | Uses CursorProvider directly ✅ |
| Config endpoints    | None                      | `/cursor-config/*` ✅           |
| Uses provider class | ❌ No                     | ✅ Yes                          |

The Claude routes have business logic scattered across files (`get-claude-status.ts`) rather than in the provider class. Cursor's pattern is cleaner.

### 4. Type Definitions - Inconsistent Metadata 🟡

| Provider | Model Definition    | Metadata                                     |
| -------- | ------------------- | -------------------------------------------- |
| Cursor   | `CursorModelConfig` | Full (label, description, hasThinking, tier) |
| Claude   | `CLAUDE_MODEL_MAP`  | Minimal (alias → model string only)          |

There's a generic `ModelDefinition` interface in the codebase that neither provider fully aligns with.

### 5. Execution Flow - Largely Provider-Agnostic ✅

The `AgentService` and `AutoModeService` use `ProviderFactory` correctly:

```typescript
const provider = ProviderFactory.getProviderForModel(effectiveModel);
const stream = provider.executeQuery(options);
```

**Minor issue:** Cursor-specific duplicate text handling is in `auto-mode-service.ts` instead of `CursorProvider.normalizeEvent()`.

### 6. Hardcoded Type Unions 🔴

```typescript
// auto-mode-service.ts line 320
provider?: 'claude' | 'cursor';  // Must manually extend

// provider-factory.ts line 22
static getProviderNameForModel(model: string): 'claude' | 'cursor'
```

---

## Refactoring Phases

### Phase 1: Quick Wins (Non-Breaking)

Small, safe changes that don't affect runtime behavior.

#### 1.1 Fix Test Expectations

- **File:** `apps/server/tests/unit/providers/provider-factory.test.ts`
- **Change:** Update test assertions from expecting 1 provider to 2
- **Risk:** None

#### 1.2 Use Dynamic ModelProvider Type

- **Files:**
  - `apps/server/src/services/auto-mode-service.ts`
  - `apps/server/src/providers/provider-factory.ts`
- **Change:** Replace `'claude' | 'cursor'` with `ModelProvider` from `@automaker/types`
- **Risk:** Low (type-only change)

### Phase 2: Move Cursor Dedup Logic

#### 2.1 Move Dedup to CursorProvider

- **From:** `apps/server/src/services/auto-mode-service.ts` (lines 1999-2020)
- **To:** `apps/server/src/providers/cursor-provider.ts` in `normalizeEvent()`
- **Risk:** Low (behavior preserved, just relocated)

### Phase 3: Provider Registry Pattern

#### 3.1 Add Registry Infrastructure

- **File:** `apps/server/src/providers/provider-factory.ts`
- **Change:** Add `Map<string, () => BaseProvider>` registry with `register()` method
- **Risk:** Low (additive)

#### 3.2 Migrate Providers to Self-Register

- **Files:** `claude-provider.ts`, `cursor-provider.ts`, `provider-factory.ts`
- **Change:** Providers call `ProviderRegistry.register()` on import
- **Risk:** Medium (must maintain behavior)

### Phase 4: Create CliProvider Base Class

#### 4.1 Create CliProvider Abstract Class

- **New File:** `apps/server/src/providers/cli-provider.ts`
- **Content:** Extract common CLI patterns (path detection, WSL, JSONL spawning)
- **Risk:** Low (new file, no changes to existing)

#### 4.2 Refactor CursorProvider to Extend CliProvider

- **File:** `apps/server/src/providers/cursor-provider.ts`
- **Change:** Extend `CliProvider` instead of `BaseProvider`, remove duplicated code
- **Risk:** Medium (must preserve all behavior)

### Phase 5: Standardize Types (Optional)

#### 5.1 Create ClaudeModelConfig

- **File:** `libs/types/src/model.ts`
- **Change:** Add `ClaudeModelConfig` matching `CursorModelConfig` pattern
- **Risk:** Low (additive)

#### 5.2 Add Discriminated Union for AIProfile

- **File:** `libs/types/src/settings.ts`
- **Change:** Convert `AIProfile` to discriminated union
- **Risk:** Medium (may affect deserialization)

### Phase 6: Standardize Routes (Optional)

#### 6.1 Move Claude Detection to ClaudeProvider

- **From:** `apps/server/src/routes/setup/get-claude-status.ts`
- **To:** `apps/server/src/providers/claude-provider.ts`
- **Risk:** Medium (must preserve all behavior)

#### 6.2 Create Generic Provider Routes

- **Change:** `/provider/:name/status` instead of `/claude-status`, `/cursor-status`
- **Risk:** High (API change, needs UI updates)

---

## Commit Plan

### Commit 1: Fix test expectations

```
fix(tests): Update provider-factory tests to expect 2 providers

The tests were written when only ClaudeProvider existed.
Now that CursorProvider is added, update assertions.
```

### Commit 2: Use ModelProvider type

```
refactor(types): Use ModelProvider type instead of hardcoded union

Replace 'claude' | 'cursor' literals with ModelProvider type
from @automaker/types for better extensibility.
```

### Commit 3: Move Cursor dedup logic

```
refactor(cursor): Move stream dedup logic to CursorProvider

Move Cursor-specific duplicate text handling from
auto-mode-service.ts into CursorProvider.normalizeEvent()
where it belongs.
```

### Commit 4: Add provider registry

```
feat(providers): Add provider registry pattern

Add ProviderRegistry class with register() method.
Providers self-register on import, removing need for
hardcoded switch statements.
```

### Commit 5: Create CliProvider base class

```
feat(providers): Create CliProvider abstract base class

Extract common CLI provider patterns:
- CLI path detection with platform-specific paths
- WSL support for Windows
- JSONL subprocess spawning
- Error code mapping infrastructure
```

### Commit 6: Refactor CursorProvider to use CliProvider

```
refactor(cursor): Extend CliProvider base class

Refactor CursorProvider to extend CliProvider instead of
BaseProvider. Removes ~400 lines of duplicated infrastructure.
```

---

## Files Affected by Phase

### Phase 1 (Quick Wins)

- `apps/server/tests/unit/providers/provider-factory.test.ts`
- `apps/server/src/services/auto-mode-service.ts`
- `apps/server/src/providers/provider-factory.ts`

### Phase 2 (Dedup Move)

- `apps/server/src/services/auto-mode-service.ts`
- `apps/server/src/providers/cursor-provider.ts`

### Phase 3 (Registry)

- `apps/server/src/providers/provider-factory.ts`
- `apps/server/src/providers/claude-provider.ts`
- `apps/server/src/providers/cursor-provider.ts`
- `apps/server/src/providers/index.ts`

### Phase 4 (CliProvider)

- `apps/server/src/providers/cli-provider.ts` (new)
- `apps/server/src/providers/cursor-provider.ts`
- `apps/server/src/providers/index.ts`

### Phase 5 (Types)

- `libs/types/src/model.ts`
- `libs/types/src/settings.ts`
- `libs/types/src/index.ts`

### Phase 6 (Routes)

- `apps/server/src/routes/setup/get-claude-status.ts`
- `apps/server/src/providers/claude-provider.ts`
- `apps/server/src/routes/setup/index.ts`
- `apps/server/src/routes/setup/routes/*.ts`

---

## Testing Strategy

After each phase:

1. Run `pnpm typecheck` - Verify no type errors
2. Run `pnpm test` in `apps/server` - Verify unit tests pass
3. Manual test: Start agent session with Claude model
4. Manual test: Start agent session with Cursor model (if CLI installed)

---

## Rollback Plan

Each phase is independently deployable. If issues arise:

1. Revert the specific commit
2. Phases are designed to be backward compatible
3. No database migrations or breaking API changes in phases 1-4

---

## Appendix: Detailed Code Duplication Analysis

### CLI Path Detection (Would Be Duplicated)

```typescript
// cursor-provider.ts lines 123-199
private findCliPath(): void {
  if (process.platform === 'win32') {
    if (isWslAvailable({ logger: wslLogger })) {
      const wslResult = findCliInWsl('cursor-agent', { logger: wslLogger });
      // ...
    }
    return;
  }

  // Try 'which' first
  try {
    const result = execSync('which cursor-agent', ...);
  } catch {}

  // Check common paths
  const platformPaths = CursorProvider.COMMON_PATHS[platform] || [];
  for (const p of platformPaths) {
    if (fs.existsSync(p)) {
      this.cliPath = p;
      return;
    }
  }
}
```

### WSL Execution (Would Be Duplicated)

```typescript
// cursor-provider.ts lines 658-679
if (this.useWsl && this.wslCliPath) {
  const wslCmd = createWslCommand(this.wslCliPath, cliArgs, {
    distribution: this.wslDistribution,
  });
  command = wslCmd.command;
  const wslCwd = windowsToWslPath(cwd);

  if (this.wslDistribution) {
    args = ['-d', this.wslDistribution, '--cd', wslCwd, this.wslCliPath, ...cliArgs];
  } else {
    args = ['--cd', wslCwd, this.wslCliPath, ...cliArgs];
  }
}
```

### Error Mapping Infrastructure (Would Be Duplicated)

```typescript
// cursor-provider.ts lines 365-452
private createError(code: CursorErrorCode, message: string, ...): CursorError {
  const error = new Error(message) as CursorError;
  error.code = code;
  error.recoverable = recoverable;
  error.suggestion = suggestion;
  return error;
}

private mapError(stderr: string, exitCode: number | null): CursorError {
  const lower = stderr.toLowerCase();
  if (lower.includes('not authenticated') || ...) {
    return this.createError(CursorErrorCode.NOT_AUTHENTICATED, ...);
  }
  // ... 70 more lines of error mapping
}
```

---

## Appendix: Proposed CliProvider Interface

### Spawn Strategy Types

Different CLI tools require different spawn strategies on Windows:

| Strategy | Example       | Windows Behavior              |
| -------- | ------------- | ----------------------------- |
| `wsl`    | cursor-agent  | Requires WSL, path conversion |
| `npx`    | some-ai-cli   | Uses `npx some-ai-cli`        |
| `direct` | opencode      | Direct command in PATH        |
| `cmd`    | some-tool.cmd | Windows batch file            |

### Proposed Interface

```typescript
// cli-provider.ts (proposed)

/** Spawn strategy for CLI tools on Windows */
type SpawnStrategy = 'wsl' | 'npx' | 'direct' | 'cmd';

interface CliSpawnConfig {
  /** How to spawn on Windows */
  windowsStrategy: SpawnStrategy;
  /** NPX package name (if strategy is 'npx') */
  npxPackage?: string;
  /** WSL distribution preference (if strategy is 'wsl') */
  wslDistribution?: string;
  /** Common installation paths per platform */
  commonPaths: Record<string, string[]>;
}

export abstract class CliProvider extends BaseProvider {
  protected cliPath: string | null = null;
  protected spawnConfig: CliSpawnConfig;

  // WSL-specific (only used when strategy is 'wsl')
  protected useWsl: boolean = false;
  protected wslCliPath: string | null = null;

  // Abstract: CLI-specific implementations
  abstract getCliName(): string;
  abstract getSpawnConfig(): CliSpawnConfig;
  abstract buildCliArgs(options: ExecuteOptions): string[];
  abstract normalizeEvent(event: unknown): ProviderMessage | null;

  // Shared: CLI detection with strategy awareness
  protected findCliPath(): void {
    const config = this.getSpawnConfig();

    if (process.platform === 'win32') {
      switch (config.windowsStrategy) {
        case 'wsl':
          this.findCliInWsl();
          break;
        case 'npx':
          this.cliPath = 'npx';
          this.npxArgs = [config.npxPackage!];
          break;
        case 'direct':
        case 'cmd':
          this.findCliInPath();
          break;
      }
    } else {
      // Linux/macOS - direct spawn
      this.findCliInPath();
    }
  }

  // Shared: Execution with strategy-aware spawning
  async *executeQuery(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    const cliArgs = this.buildCliArgs(options);
    const subprocessOptions = this.buildSubprocessOptions(options, cliArgs);

    for await (const rawEvent of spawnJSONLProcess(subprocessOptions)) {
      const normalized = this.normalizeEvent(rawEvent);
      if (normalized) yield normalized;
    }
  }

  // Shared: Build subprocess options based on strategy
  protected buildSubprocessOptions(options: ExecuteOptions, cliArgs: string[]): SubprocessOptions {
    const config = this.getSpawnConfig();

    if (process.platform === 'win32' && config.windowsStrategy === 'wsl') {
      return this.buildWslSubprocessOptions(options, cliArgs);
    }

    if (config.windowsStrategy === 'npx') {
      return {
        command: 'npx',
        args: [config.npxPackage!, ...cliArgs],
        cwd: options.cwd,
        // ...
      };
    }

    return {
      command: this.cliPath!,
      args: cliArgs,
      cwd: options.cwd,
      // ...
    };
  }
}
```

### Example: CursorProvider with SpawnConfig

```typescript
class CursorProvider extends CliProvider {
  getSpawnConfig(): CliSpawnConfig {
    return {
      windowsStrategy: 'wsl', // Cursor needs WSL on Windows
      wslDistribution: undefined, // Use default
      commonPaths: {
        linux: ['/usr/local/bin/cursor-agent', '~/.cursor/bin/cursor-agent'],
        darwin: ['/usr/local/bin/cursor-agent', '~/.cursor/bin/cursor-agent'],
        // No win32 paths - uses WSL
      },
    };
  }
}
```

### Example: Future NPX-based Provider

```typescript
class SomeNpxProvider extends CliProvider {
  getSpawnConfig(): CliSpawnConfig {
    return {
      windowsStrategy: 'npx',
      npxPackage: '@some-org/ai-cli',
      commonPaths: {
        // NPX handles installation, but can check for global install
        linux: ['/usr/local/bin/some-cli'],
        darwin: ['/usr/local/bin/some-cli'],
        win32: ['C:\\Program Files\\some-cli\\some-cli.exe'],
      },
    };
  }
}
```
