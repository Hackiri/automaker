/**
 * Automaker Backend Server
 *
 * Provides HTTP/WebSocket API for both web and Electron modes.
 * In Electron mode, this server runs locally.
 * In web mode, this server runs on a remote host.
 */

import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import dotenv from "dotenv";

import { createEventEmitter, type EventEmitter } from "./lib/events.js";
import { initAllowedPaths } from "./lib/security.js";
import { authMiddleware, getAuthStatus } from "./lib/auth.js";
import { createFsRoutes } from "./routes/fs.js";
import { createHealthRoutes } from "./routes/health.js";
import { createAgentRoutes } from "./routes/agent.js";
import { createSessionsRoutes } from "./routes/sessions.js";
import { createFeaturesRoutes } from "./routes/features.js";
import { createAutoModeRoutes } from "./routes/auto-mode.js";
import { createWorktreeRoutes } from "./routes/worktree.js";
import { createGitRoutes } from "./routes/git.js";
import { createSetupRoutes } from "./routes/setup.js";
import { createSuggestionsRoutes } from "./routes/suggestions.js";
import { createModelsRoutes } from "./routes/models.js";
import { createSpecRegenerationRoutes } from "./routes/spec-regeneration.js";
import { createRunningAgentsRoutes } from "./routes/running-agents.js";
import { createWorkspaceRoutes } from "./routes/workspace.js";
import { createTemplatesRoutes } from "./routes/templates.js";
import {
  createTerminalRoutes,
  validateTerminalToken,
  isTerminalEnabled,
  isTerminalPasswordRequired,
} from "./routes/terminal.js";
import { AgentService } from "./services/agent-service.js";
import { FeatureLoader } from "./services/feature-loader.js";
import { AutoModeService } from "./services/auto-mode-service.js";
import { getTerminalService } from "./services/terminal-service.js";

// Load environment variables
dotenv.config();

const PORT = parseInt(process.env.PORT || "3008", 10);
const DATA_DIR = process.env.DATA_DIR || "./data";

// Check for required environment variables
// Claude Agent SDK supports EITHER OAuth token (subscription) OR API key (pay-per-use)
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
const hasOAuthToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;

if (!hasAnthropicKey && !hasOAuthToken) {
  console.warn(`
╔═══════════════════════════════════════════════════════════════════════╗
║  ⚠️  WARNING: No Claude authentication configured                      ║
║                                                                       ║
║  The Claude Agent SDK requires authentication to function.            ║
║                                                                       ║
║  Option 1 - Subscription (OAuth Token):                               ║
║    export CLAUDE_CODE_OAUTH_TOKEN="your-oauth-token"                  ║
║                                                                       ║
║  Option 2 - Pay-per-use (API Key):                                    ║
║    export ANTHROPIC_API_KEY="sk-ant-..."                              ║
║                                                                       ║
║  Or use the setup wizard in Settings to configure authentication.     ║
╚═══════════════════════════════════════════════════════════════════════╝
`);
} else if (hasOAuthToken) {
  console.log(
    "[Server] ✓ CLAUDE_CODE_OAUTH_TOKEN detected (subscription auth)"
  );
} else {
  console.log("[Server] ✓ ANTHROPIC_API_KEY detected (API key auth)");
}

// Initialize security
initAllowedPaths();

// Create Express app
const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" }));

// Create shared event emitter for streaming
const events: EventEmitter = createEventEmitter();

// Create services
const agentService = new AgentService(DATA_DIR, events);
const featureLoader = new FeatureLoader();
const autoModeService = new AutoModeService(events);

// Initialize services
(async () => {
  await agentService.initialize();
  console.log("[Server] Agent service initialized");
})();

// Mount API routes - health is unauthenticated for monitoring
app.use("/api/health", createHealthRoutes());

// Apply authentication to all other routes
app.use("/api", authMiddleware);

app.use("/api/fs", createFsRoutes(events));
app.use("/api/agent", createAgentRoutes(agentService, events));
app.use("/api/sessions", createSessionsRoutes(agentService));
app.use("/api/features", createFeaturesRoutes(featureLoader));
app.use("/api/auto-mode", createAutoModeRoutes(autoModeService));
app.use("/api/worktree", createWorktreeRoutes());
app.use("/api/git", createGitRoutes());
app.use("/api/setup", createSetupRoutes());
app.use("/api/suggestions", createSuggestionsRoutes(events));
app.use("/api/models", createModelsRoutes());
app.use("/api/spec-regeneration", createSpecRegenerationRoutes(events));
app.use("/api/running-agents", createRunningAgentsRoutes(autoModeService));
app.use("/api/workspace", createWorkspaceRoutes());
app.use("/api/templates", createTemplatesRoutes());
app.use("/api/terminal", createTerminalRoutes());

// Create HTTP server
const server = createServer(app);

// WebSocket servers using noServer mode for proper multi-path support
const wss = new WebSocketServer({ noServer: true });
const terminalWss = new WebSocketServer({ noServer: true });
const terminalService = getTerminalService();

// Handle HTTP upgrade requests manually to route to correct WebSocket server
server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(
    request.url || "",
    `http://${request.headers.host}`
  );

  if (pathname === "/api/events") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else if (pathname === "/api/terminal/ws") {
    terminalWss.handleUpgrade(request, socket, head, (ws) => {
      terminalWss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Events WebSocket connection handler
wss.on("connection", (ws: WebSocket) => {
  console.log("[WebSocket] Client connected");

  // Subscribe to all events and forward to this client
  const unsubscribe = events.subscribe((type, payload) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  });

  ws.on("close", () => {
    console.log("[WebSocket] Client disconnected");
    unsubscribe();
  });

  ws.on("error", (error) => {
    console.error("[WebSocket] Error:", error);
    unsubscribe();
  });
});

// Track WebSocket connections per session
const terminalConnections: Map<string, Set<WebSocket>> = new Map();

// Terminal WebSocket connection handler
terminalWss.on(
  "connection",
  (ws: WebSocket, req: import("http").IncomingMessage) => {
    // Parse URL to get session ID and token
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("sessionId");
    const token = url.searchParams.get("token");

    console.log(`[Terminal WS] Connection attempt for session: ${sessionId}`);

    // Check if terminal is enabled
    if (!isTerminalEnabled()) {
      console.log("[Terminal WS] Terminal is disabled");
      ws.close(4003, "Terminal access is disabled");
      return;
    }

    // Validate token if password is required
    if (
      isTerminalPasswordRequired() &&
      !validateTerminalToken(token || undefined)
    ) {
      console.log("[Terminal WS] Invalid or missing token");
      ws.close(4001, "Authentication required");
      return;
    }

    if (!sessionId) {
      console.log("[Terminal WS] No session ID provided");
      ws.close(4002, "Session ID required");
      return;
    }

    // Check if session exists
    const session = terminalService.getSession(sessionId);
    if (!session) {
      console.log(`[Terminal WS] Session ${sessionId} not found`);
      ws.close(4004, "Session not found");
      return;
    }

    console.log(`[Terminal WS] Client connected to session ${sessionId}`);

    // Track this connection
    if (!terminalConnections.has(sessionId)) {
      terminalConnections.set(sessionId, new Set());
    }
    terminalConnections.get(sessionId)!.add(ws);

    // Subscribe to terminal data
    const unsubscribeData = terminalService.onData((sid, data) => {
      if (sid === sessionId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });

    // Subscribe to terminal exit
    const unsubscribeExit = terminalService.onExit((sid, exitCode) => {
      if (sid === sessionId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "exit", exitCode }));
        ws.close(1000, "Session ended");
      }
    });

    // Handle incoming messages
    ws.on("message", (message) => {
      try {
        const msg = JSON.parse(message.toString());

        switch (msg.type) {
          case "input":
            // Write user input to terminal
            terminalService.write(sessionId, msg.data);
            break;

          case "resize":
            // Resize terminal
            if (msg.cols && msg.rows) {
              terminalService.resize(sessionId, msg.cols, msg.rows);
            }
            break;

          case "ping":
            // Respond to ping
            ws.send(JSON.stringify({ type: "pong" }));
            break;

          default:
            console.warn(`[Terminal WS] Unknown message type: ${msg.type}`);
        }
      } catch (error) {
        console.error("[Terminal WS] Error processing message:", error);
      }
    });

    ws.on("close", () => {
      console.log(
        `[Terminal WS] Client disconnected from session ${sessionId}`
      );
      unsubscribeData();
      unsubscribeExit();

      // Remove from connections tracking
      const connections = terminalConnections.get(sessionId);
      if (connections) {
        connections.delete(ws);
        if (connections.size === 0) {
          terminalConnections.delete(sessionId);
        }
      }
    });

    ws.on("error", (error) => {
      console.error(`[Terminal WS] Error on session ${sessionId}:`, error);
      unsubscribeData();
      unsubscribeExit();
    });

    // Send initial connection success
    ws.send(
      JSON.stringify({
        type: "connected",
        sessionId,
        shell: session.shell,
        cwd: session.cwd,
      })
    );

    // Send scrollback buffer to replay previous output
    const scrollback = terminalService.getScrollback(sessionId);
    if (scrollback && scrollback.length > 0) {
      ws.send(
        JSON.stringify({
          type: "scrollback",
          data: scrollback,
        })
      );
    }
  }
);

// Start server with error handling for port conflicts
const startServer = (port: number) => {
  server.listen(port, () => {
    const terminalStatus = isTerminalEnabled()
      ? isTerminalPasswordRequired()
        ? "enabled (password protected)"
        : "enabled"
      : "disabled";
    const portStr = port.toString().padEnd(4);
    console.log(`
╔═══════════════════════════════════════════════════════╗
║           Automaker Backend Server                    ║
╠═══════════════════════════════════════════════════════╣
║  HTTP API:    http://localhost:${portStr}                 ║
║  WebSocket:   ws://localhost:${portStr}/api/events        ║
║  Terminal:    ws://localhost:${portStr}/api/terminal/ws   ║
║  Health:      http://localhost:${portStr}/api/health      ║
║  Terminal:    ${terminalStatus.padEnd(37)}║
╚═══════════════════════════════════════════════════════╝
`);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`
╔═══════════════════════════════════════════════════════╗
║  ❌ ERROR: Port ${port} is already in use              ║
╠═══════════════════════════════════════════════════════╣
║  Another process is using this port.                  ║
║                                                       ║
║  To fix this, try one of:                             ║
║                                                       ║
║  1. Kill the process using the port:                  ║
║     lsof -ti:${port} | xargs kill -9                   ║
║                                                       ║
║  2. Use a different port:                             ║
║     PORT=${port + 1} npm run dev:server                ║
║                                                       ║
║  3. Use the init.sh script which handles this:        ║
║     ./init.sh                                         ║
╚═══════════════════════════════════════════════════════╝
`);
      process.exit(1);
    } else {
      console.error("[Server] Error starting server:", error);
      process.exit(1);
    }
  });
};

startServer(PORT);

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down...");
  terminalService.cleanup();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down...");
  terminalService.cleanup();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
