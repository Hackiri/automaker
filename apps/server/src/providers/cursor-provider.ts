/**
 * Cursor Provider - Executes queries using cursor-agent CLI
 *
 * Spawns the cursor-agent CLI with --output-format stream-json for streaming responses.
 * Normalizes Cursor events to the AutoMaker ProviderMessage format.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BaseProvider } from './base-provider.js';
import type {
  ProviderConfig,
  ExecuteOptions,
  ProviderMessage,
  InstallationStatus,
  ModelDefinition,
  ContentBlock,
} from './types.js';
import {
  type CursorStreamEvent,
  type CursorSystemEvent,
  type CursorAssistantEvent,
  type CursorToolCallEvent,
  type CursorResultEvent,
  type CursorAuthStatus,
  CURSOR_MODEL_MAP,
} from '@automaker/types';
import { createLogger, isAbortError } from '@automaker/utils';
import {
  spawnJSONLProcess,
  type SubprocessOptions,
  isWslAvailable,
  findCliInWsl,
  createWslCommand,
  execInWsl,
  windowsToWslPath,
} from '@automaker/platform';

// Create logger for this module
const logger = createLogger('CursorProvider');

/**
 * Cursor-specific error codes for detailed error handling
 */
export enum CursorErrorCode {
  NOT_INSTALLED = 'CURSOR_NOT_INSTALLED',
  NOT_AUTHENTICATED = 'CURSOR_NOT_AUTHENTICATED',
  RATE_LIMITED = 'CURSOR_RATE_LIMITED',
  MODEL_UNAVAILABLE = 'CURSOR_MODEL_UNAVAILABLE',
  NETWORK_ERROR = 'CURSOR_NETWORK_ERROR',
  PROCESS_CRASHED = 'CURSOR_PROCESS_CRASHED',
  TIMEOUT = 'CURSOR_TIMEOUT',
  UNKNOWN = 'CURSOR_UNKNOWN_ERROR',
}

export interface CursorError extends Error {
  code: CursorErrorCode;
  recoverable: boolean;
  suggestion?: string;
}

/**
 * CursorProvider - Integrates cursor-agent CLI as an AI provider
 *
 * Uses the cursor-agent CLI with --output-format stream-json for streaming responses.
 * Normalizes Cursor events to the AutoMaker ProviderMessage format.
 */
export class CursorProvider extends BaseProvider {
  /**
   * Installation paths based on official cursor-agent install script:
   *
   * Linux/macOS:
   * - Binary: ~/.local/share/cursor-agent/versions/<version>/cursor-agent
   * - Symlink: ~/.local/bin/cursor-agent -> versions/<version>/cursor-agent
   *
   * The install script creates versioned folders like:
   *   ~/.local/share/cursor-agent/versions/2025.12.17-996666f/cursor-agent
   * And symlinks to ~/.local/bin/cursor-agent
   *
   * Windows:
   * - cursor-agent CLI only supports Linux/macOS, NOT native Windows
   * - On Windows, users must install in WSL and we invoke via wsl.exe
   */
  private static COMMON_PATHS: Record<string, string[]> = {
    linux: [
      path.join(os.homedir(), '.local/bin/cursor-agent'), // Primary symlink location
      '/usr/local/bin/cursor-agent',
    ],
    darwin: [
      path.join(os.homedir(), '.local/bin/cursor-agent'), // Primary symlink location
      '/usr/local/bin/cursor-agent',
    ],
    // Windows paths are not used - we check for WSL installation instead
    win32: [],
  };

  // Version data directory where cursor-agent stores versions
  private static VERSIONS_DIR = path.join(os.homedir(), '.local/share/cursor-agent/versions');

  private cliPath: string | null = null;

  // WSL execution mode for Windows
  private useWsl: boolean = false;
  private wslCliPath: string | null = null;
  private wslDistribution: string | undefined = undefined;

  constructor(config: ProviderConfig = {}) {
    super(config);
    this.findCliPath();
  }

  getName(): string {
    return 'cursor';
  }

  /**
   * Find cursor-agent CLI in PATH or common installation locations
   *
   * On Windows, uses WSL utilities from @automaker/platform since
   * cursor-agent CLI only supports Linux/macOS natively.
   */
  private findCliPath(): void {
    const wslLogger = (msg: string) => logger.debug(msg);

    // On Windows, we need to use WSL (cursor-agent has no native Windows build)
    if (process.platform === 'win32') {
      if (isWslAvailable({ logger: wslLogger })) {
        const wslResult = findCliInWsl('cursor-agent', { logger: wslLogger });
        if (wslResult) {
          this.useWsl = true;
          this.wslCliPath = wslResult.wslPath;
          this.wslDistribution = wslResult.distribution;
          this.cliPath = 'wsl.exe'; // We'll use wsl.exe to invoke
          logger.debug(
            `Using cursor-agent via WSL (${wslResult.distribution || 'default'}): ${wslResult.wslPath}`
          );
          return;
        }
      }
      logger.debug(
        'cursor-agent CLI not found (WSL not available or cursor-agent not installed in WSL)'
      );
      this.cliPath = null;
      return;
    }

    // Linux/macOS - direct execution
    // Try 'which' first
    try {
      const result = execSync('which cursor-agent', { encoding: 'utf8', timeout: 5000 })
        .trim()
        .split('\n')[0];
      if (result && fs.existsSync(result)) {
        logger.debug(`Found cursor-agent in PATH: ${result}`);
        this.cliPath = result;
        return;
      }
    } catch {
      // Not in PATH
    }

    // Check common installation paths for current platform
    const platform = process.platform as 'linux' | 'darwin' | 'win32';
    const platformPaths = CursorProvider.COMMON_PATHS[platform] || [];

    for (const p of platformPaths) {
      if (fs.existsSync(p)) {
        logger.debug(`Found cursor-agent at: ${p}`);
        this.cliPath = p;
        return;
      }
    }

    // Also check versions directory for any installed version
    if (fs.existsSync(CursorProvider.VERSIONS_DIR)) {
      try {
        const versions = fs
          .readdirSync(CursorProvider.VERSIONS_DIR)
          .filter((v) => !v.startsWith('.'))
          .sort()
          .reverse(); // Most recent first

        for (const version of versions) {
          const versionPath = path.join(CursorProvider.VERSIONS_DIR, version, 'cursor-agent');
          if (fs.existsSync(versionPath)) {
            logger.debug(`Found cursor-agent version ${version} at: ${versionPath}`);
            this.cliPath = versionPath;
            return;
          }
        }
      } catch {
        // Ignore directory read errors
      }
    }

    logger.debug('cursor-agent CLI not found');
    this.cliPath = null;
  }

  /**
   * Check if Cursor CLI is installed
   */
  async isInstalled(): Promise<boolean> {
    return this.cliPath !== null;
  }

  /**
   * Get Cursor CLI version
   */
  async getVersion(): Promise<string | null> {
    if (!this.cliPath) return null;

    try {
      if (this.useWsl && this.wslCliPath) {
        // Execute via WSL using utility from @automaker/platform
        const result = execInWsl(`${this.wslCliPath} --version`, {
          timeout: 5000,
          distribution: this.wslDistribution,
        });
        return result;
      }
      const result = execSync(`"${this.cliPath}" --version`, {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Check authentication status
   */
  async checkAuth(): Promise<CursorAuthStatus> {
    if (!this.cliPath) {
      return { authenticated: false, method: 'none' };
    }

    // Check for API key in environment
    if (process.env.CURSOR_API_KEY) {
      return { authenticated: true, method: 'api_key' };
    }

    // For WSL mode, check credentials inside WSL
    if (this.useWsl && this.wslCliPath) {
      const wslOpts = { timeout: 5000, distribution: this.wslDistribution };

      // Check for credentials file inside WSL (use $HOME for proper expansion)
      const wslCredPaths = [
        '$HOME/.cursor/credentials.json',
        '$HOME/.config/cursor/credentials.json',
      ];

      for (const credPath of wslCredPaths) {
        const content = execInWsl(`sh -c "cat ${credPath} 2>/dev/null || echo ''"`, wslOpts);
        if (content && content.trim()) {
          try {
            const creds = JSON.parse(content);
            if (creds.accessToken || creds.token) {
              return { authenticated: true, method: 'login', hasCredentialsFile: true };
            }
          } catch {
            // Invalid credentials file
          }
        }
      }

      // Try running --version to check if CLI works
      const versionResult = execInWsl(`${this.wslCliPath} --version`, {
        timeout: 10000,
        distribution: this.wslDistribution,
      });
      if (versionResult) {
        return { authenticated: true, method: 'login' };
      }

      return { authenticated: false, method: 'none' };
    }

    // Native mode (Linux/macOS) - check local credentials
    const credentialPaths = [
      path.join(os.homedir(), '.cursor', 'credentials.json'),
      path.join(os.homedir(), '.config', 'cursor', 'credentials.json'),
    ];

    for (const credPath of credentialPaths) {
      if (fs.existsSync(credPath)) {
        try {
          const content = fs.readFileSync(credPath, 'utf8');
          const creds = JSON.parse(content);
          if (creds.accessToken || creds.token) {
            return { authenticated: true, method: 'login', hasCredentialsFile: true };
          }
        } catch {
          // Invalid credentials file
        }
      }
    }

    // Try running a simple command to check auth
    try {
      execSync(`"${this.cliPath}" --version`, {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env },
      });
      // If we get here without error, assume authenticated
      // (actual auth check would need a real API call)
      return { authenticated: true, method: 'login' };
    } catch (error: unknown) {
      const execError = error as { stderr?: string };
      if (execError.stderr?.includes('not authenticated') || execError.stderr?.includes('log in')) {
        return { authenticated: false, method: 'none' };
      }
    }

    return { authenticated: false, method: 'none' };
  }

  /**
   * Detect installation status (required by BaseProvider)
   */
  async detectInstallation(): Promise<InstallationStatus> {
    const installed = await this.isInstalled();
    const version = installed ? await this.getVersion() : undefined;
    const auth = await this.checkAuth();

    // Determine the display path - for WSL, show the WSL path with distribution
    const displayPath =
      this.useWsl && this.wslCliPath
        ? `(WSL${this.wslDistribution ? `:${this.wslDistribution}` : ''}) ${this.wslCliPath}`
        : this.cliPath || undefined;

    return {
      installed,
      version: version || undefined,
      path: displayPath,
      method: this.useWsl ? 'wsl' : 'cli',
      hasApiKey: !!process.env.CURSOR_API_KEY,
      authenticated: auth.authenticated,
    };
  }

  /**
   * Get available Cursor models
   */
  getAvailableModels(): ModelDefinition[] {
    return Object.entries(CURSOR_MODEL_MAP).map(([id, config]) => ({
      id: `cursor-${id}`,
      name: config.label,
      modelString: id,
      provider: 'cursor',
      description: config.description,
      tier: config.tier === 'pro' ? ('premium' as const) : ('basic' as const),
      supportsTools: true,
      supportsVision: false, // Cursor CLI may not support vision
    }));
  }

  /**
   * Create a CursorError with details
   */
  private createError(
    code: CursorErrorCode,
    message: string,
    recoverable: boolean = false,
    suggestion?: string
  ): CursorError {
    const error = new Error(message) as CursorError;
    error.code = code;
    error.recoverable = recoverable;
    error.suggestion = suggestion;
    error.name = 'CursorError';
    return error;
  }

  /**
   * Map stderr/exit codes to detailed CursorError
   */
  private mapError(stderr: string, exitCode: number | null): CursorError {
    const lower = stderr.toLowerCase();

    if (
      lower.includes('not authenticated') ||
      lower.includes('please log in') ||
      lower.includes('unauthorized')
    ) {
      return this.createError(
        CursorErrorCode.NOT_AUTHENTICATED,
        'Cursor CLI is not authenticated',
        true,
        'Run "cursor-agent login" to authenticate with your browser'
      );
    }

    if (
      lower.includes('rate limit') ||
      lower.includes('too many requests') ||
      lower.includes('429')
    ) {
      return this.createError(
        CursorErrorCode.RATE_LIMITED,
        'Cursor API rate limit exceeded',
        true,
        'Wait a few minutes and try again, or upgrade to Cursor Pro'
      );
    }

    if (
      lower.includes('model not available') ||
      lower.includes('invalid model') ||
      lower.includes('unknown model')
    ) {
      return this.createError(
        CursorErrorCode.MODEL_UNAVAILABLE,
        'Requested model is not available',
        true,
        'Try using "auto" mode or select a different model'
      );
    }

    if (
      lower.includes('network') ||
      lower.includes('connection') ||
      lower.includes('econnrefused') ||
      lower.includes('timeout')
    ) {
      return this.createError(
        CursorErrorCode.NETWORK_ERROR,
        'Network connection error',
        true,
        'Check your internet connection and try again'
      );
    }

    if (exitCode === 137 || lower.includes('killed') || lower.includes('sigterm')) {
      return this.createError(
        CursorErrorCode.PROCESS_CRASHED,
        'Cursor agent process was terminated',
        true,
        'The process may have run out of memory. Try a simpler task.'
      );
    }

    return this.createError(
      CursorErrorCode.UNKNOWN,
      stderr || `Cursor agent exited with code ${exitCode}`,
      false
    );
  }

  /**
   * Deduplicate text blocks in Cursor assistant messages
   *
   * Cursor often sends:
   * 1. Duplicate consecutive text blocks (same text twice in a row)
   * 2. A final accumulated block containing ALL previous text
   *
   * This method filters out these duplicates to prevent UI stuttering.
   */
  private deduplicateTextBlocks(
    content: ContentBlock[],
    lastTextBlock: string,
    accumulatedText: string
  ): { content: ContentBlock[]; lastBlock: string; accumulated: string } {
    const filtered: ContentBlock[] = [];
    let newLastBlock = lastTextBlock;
    let newAccumulated = accumulatedText;

    for (const block of content) {
      if (block.type !== 'text' || !block.text) {
        filtered.push(block);
        continue;
      }

      const text = block.text;

      // Skip empty text
      if (!text.trim()) continue;

      // Skip duplicate consecutive text blocks
      if (text === newLastBlock) {
        continue;
      }

      // Skip final accumulated text block
      // Cursor sends one large block containing ALL previous text at the end
      if (newAccumulated.length > 100 && text.length > newAccumulated.length * 0.8) {
        const normalizedAccum = newAccumulated.replace(/\s+/g, ' ').trim();
        const normalizedNew = text.replace(/\s+/g, ' ').trim();
        if (normalizedNew.includes(normalizedAccum.slice(0, 100))) {
          // This is the final accumulated block, skip it
          continue;
        }
      }

      // This is a valid new text block
      newLastBlock = text;
      newAccumulated += text;
      filtered.push(block);
    }

    return {
      content: filtered,
      lastBlock: newLastBlock,
      accumulated: newAccumulated,
    };
  }

  /**
   * Convert Cursor event to AutoMaker ProviderMessage format
   */
  private normalizeEvent(event: CursorStreamEvent): ProviderMessage | null {
    switch (event.type) {
      case 'system':
        // System init - we capture session_id but don't yield a message
        return null;

      case 'user':
        // User message - already handled by caller
        return null;

      case 'assistant': {
        const assistantEvent = event as CursorAssistantEvent;
        return {
          type: 'assistant',
          session_id: assistantEvent.session_id,
          message: {
            role: 'assistant',
            content: assistantEvent.message.content.map((c) => ({
              type: 'text' as const,
              text: c.text,
            })),
          },
        };
      }

      case 'tool_call': {
        const toolEvent = event as CursorToolCallEvent;
        const toolCall = toolEvent.tool_call;

        // Determine tool name and input
        let toolName: string;
        let toolInput: unknown;

        if (toolCall.readToolCall) {
          // Skip if args not yet populated (partial streaming event)
          if (!toolCall.readToolCall.args) return null;
          toolName = 'Read';
          toolInput = { file_path: toolCall.readToolCall.args.path };
        } else if (toolCall.writeToolCall) {
          // Skip if args not yet populated (partial streaming event)
          if (!toolCall.writeToolCall.args) return null;
          toolName = 'Write';
          toolInput = {
            file_path: toolCall.writeToolCall.args.path,
            content: toolCall.writeToolCall.args.fileText,
          };
        } else if (toolCall.function) {
          toolName = toolCall.function.name;
          try {
            toolInput = JSON.parse(toolCall.function.arguments || '{}');
          } catch {
            toolInput = { raw: toolCall.function.arguments };
          }
        } else {
          return null;
        }

        // For started events, emit tool_use
        if (toolEvent.subtype === 'started') {
          return {
            type: 'assistant',
            session_id: toolEvent.session_id,
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  name: toolName,
                  tool_use_id: toolEvent.call_id,
                  input: toolInput,
                },
              ],
            },
          };
        }

        // For completed events, emit both tool_use and tool_result
        // This ensures the UI shows the tool call even if 'started' was skipped
        if (toolEvent.subtype === 'completed') {
          let resultContent = '';

          if (toolCall.readToolCall?.result?.success) {
            resultContent = toolCall.readToolCall.result.success.content;
          } else if (toolCall.writeToolCall?.result?.success) {
            resultContent = `Wrote ${toolCall.writeToolCall.result.success.linesCreated} lines to ${toolCall.writeToolCall.result.success.path}`;
          }

          return {
            type: 'assistant',
            session_id: toolEvent.session_id,
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  name: toolName,
                  tool_use_id: toolEvent.call_id,
                  input: toolInput,
                },
                {
                  type: 'tool_result',
                  tool_use_id: toolEvent.call_id,
                  content: resultContent,
                },
              ],
            },
          };
        }

        return null;
      }

      case 'result': {
        const resultEvent = event as CursorResultEvent;

        if (resultEvent.is_error) {
          return {
            type: 'error',
            session_id: resultEvent.session_id,
            error: resultEvent.error || resultEvent.result || 'Unknown error',
          };
        }

        return {
          type: 'result',
          subtype: 'success',
          session_id: resultEvent.session_id,
          result: resultEvent.result,
        };
      }

      default:
        return null;
    }
  }

  /**
   * Execute a prompt using Cursor CLI with streaming
   */
  async *executeQuery(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    if (!this.cliPath) {
      // Provide platform-specific installation instructions
      const installSuggestion =
        process.platform === 'win32'
          ? 'cursor-agent requires WSL on Windows. Install WSL, then run in WSL: curl https://cursor.com/install -fsS | bash'
          : 'Install with: curl https://cursor.com/install -fsS | bash';

      throw this.createError(
        CursorErrorCode.NOT_INSTALLED,
        'Cursor CLI is not installed',
        true,
        installSuggestion
      );
    }

    // Extract model from options (strip 'cursor-' prefix if present)
    let model = options.model || 'auto';
    logger.debug(`CursorProvider.executeQuery called with model: "${model}"`);
    if (model.startsWith('cursor-')) {
      const originalModel = model;
      model = model.substring(7);
      logger.debug(`Stripped cursor- prefix: "${originalModel}" -> "${model}"`);
    }

    const cwd = options.cwd || process.cwd();

    // Build prompt content
    let promptText: string;
    if (typeof options.prompt === 'string') {
      promptText = options.prompt;
    } else if (Array.isArray(options.prompt)) {
      promptText = options.prompt
        .filter((p) => p.type === 'text' && p.text)
        .map((p) => p.text)
        .join('\n');
    } else {
      throw new Error('Invalid prompt format');
    }

    // Build CLI arguments for cursor-agent
    const cliArgs: string[] = [
      '-p', // Print mode (non-interactive)
      '--force', // Allow file modifications
      '--output-format',
      'stream-json',
      '--stream-partial-output', // Real-time streaming
    ];

    // Add model if not auto
    if (model !== 'auto') {
      cliArgs.push('--model', model);
    }

    // Add the prompt
    cliArgs.push(promptText);

    // Determine command and args based on WSL mode
    let command: string;
    let args: string[];
    let workingDir: string;

    if (this.useWsl && this.wslCliPath) {
      // Build WSL command with --cd flag to change directory inside WSL
      const wslCmd = createWslCommand(this.wslCliPath, cliArgs, {
        distribution: this.wslDistribution,
      });
      command = wslCmd.command;
      const wslCwd = windowsToWslPath(cwd);

      // Construct args with --cd flag inserted before the CLI path
      // createWslCommand returns: ['-d', distro, cliPath, ...cliArgs] or [cliPath, ...cliArgs]
      if (this.wslDistribution) {
        // With distribution: wsl.exe -d <distro> --cd <path> <cli> <args>
        args = ['-d', this.wslDistribution, '--cd', wslCwd, this.wslCliPath, ...cliArgs];
      } else {
        // Without distribution: wsl.exe --cd <path> <cli> <args>
        args = ['--cd', wslCwd, this.wslCliPath, ...cliArgs];
      }

      // Keep Windows path for spawn's cwd (spawn runs on Windows)
      workingDir = cwd;
      logger.debug(
        `Executing via WSL (${this.wslDistribution || 'default'}): ${command} ${args.slice(0, 6).join(' ')}...`
      );
    } else {
      command = this.cliPath;
      args = cliArgs;
      workingDir = cwd;
      logger.debug(`Executing: ${command} ${args.slice(0, 6).join(' ')}...`);
    }

    // Use spawnJSONLProcess from @automaker/platform for JSONL streaming
    // This handles line buffering, timeouts, and abort signals automatically
    // Filter out undefined values from process.env to satisfy TypeScript
    const filteredEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        filteredEnv[key] = value;
      }
    }

    const subprocessOptions: SubprocessOptions = {
      command,
      args,
      cwd: workingDir,
      env: filteredEnv,
      abortController: options.abortController,
      timeout: 120000, // 2 min timeout for CLI operations (may take longer than default 30s)
    };

    let sessionId: string | undefined;

    // Dedup state for Cursor-specific text block handling
    let lastTextBlock = '';
    let accumulatedText = '';

    try {
      // spawnJSONLProcess yields parsed JSON objects, handles errors
      for await (const rawEvent of spawnJSONLProcess(subprocessOptions)) {
        const event = rawEvent as CursorStreamEvent;

        // Capture session ID from system init
        if (event.type === 'system' && (event as CursorSystemEvent).subtype === 'init') {
          sessionId = event.session_id;
          logger.debug(`Session started: ${sessionId}`);
        }

        // Normalize and yield the event
        const normalized = this.normalizeEvent(event);
        if (normalized) {
          // Ensure session_id is always set
          if (!normalized.session_id && sessionId) {
            normalized.session_id = sessionId;
          }

          // Apply Cursor-specific dedup for assistant text messages
          if (normalized.type === 'assistant' && normalized.message?.content) {
            const dedupedContent = this.deduplicateTextBlocks(
              normalized.message.content,
              lastTextBlock,
              accumulatedText
            );

            if (dedupedContent.content.length === 0) {
              // All blocks were duplicates, skip this message
              continue;
            }

            // Update state
            lastTextBlock = dedupedContent.lastBlock;
            accumulatedText = dedupedContent.accumulated;

            // Update the message with deduped content
            normalized.message.content = dedupedContent.content;
          }

          yield normalized;
        }
      }
    } catch (error) {
      // Use isAbortError from @automaker/utils for abort detection
      if (isAbortError(error)) {
        logger.debug('Query aborted');
        return; // Clean abort, don't throw
      }

      // Map CLI errors to CursorError
      if (error instanceof Error && 'stderr' in error) {
        throw this.mapError(
          (error as { stderr?: string }).stderr || error.message,
          (error as { exitCode?: number | null }).exitCode ?? null
        );
      }
      throw error;
    }
  }

  /**
   * Check if a feature is supported
   */
  supportsFeature(feature: string): boolean {
    const supported = ['tools', 'text', 'streaming'];
    return supported.includes(feature);
  }
}
