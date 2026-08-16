const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

require("dotenv").config();

const { generateCode } = require("./geminiService");

// =========================================
// NORMAL EXECUTION
// =========================================

const executeCode = require("./execution/executionManager");

// =========================================
// TERMINAL DOCKER
// =========================================

const {
  runTerminalCommand,
  getFilesystemSuggestions,
} = require("./terminalDockerRunner");

// =========================================
// INTERACTIVE RUNNERS
// =========================================

const {
  startPhpInteractive,
} = require("./execution/phpDockerRunner");

const {
  startCppInteractive,
} = require("./execution/dockerRunner");

const {
  startCInteractive,
} = require("./execution/cDockerRunner");

const {
  startJavaInteractive,
} = require("./execution/javaDockerRunner");

const {
  startPythonInteractive,
} = require("./execution/pythonDockerRunner");

const {
  startJavaScriptInteractive,
} = require("./execution/javascriptDockerRunner");

const {
  startGoInteractive,
} = require("./execution/goDockerRunner");

const {
  startRustInteractive,
} = require("./execution/rustDockerRunner");

// =========================================
// APP
// =========================================

const app = express();
const server = http.createServer(app);

// IMPORTANT FOR RENDER
const PORT = process.env.PORT || 5000;

// =========================================
// MIDDLEWARE
// =========================================

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

app.use(
  express.json({
    limit: "2mb",
  })
);

// =========================================
// SOCKET.IO
// =========================================

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },

  transports: ["polling", "websocket"],

  pingTimeout: 60000,
  pingInterval: 25000,
});

// =========================================
// INTERACTIVE RUNNER MAP
// =========================================

const interactiveRunners = {
  // C
  c: startCInteractive,

  // C++
  cpp: startCppInteractive,
  "c++": startCppInteractive,

  // Java
  java: startJavaInteractive,

  // Python
  python: startPythonInteractive,
  python3: startPythonInteractive,

  // JavaScript
  javascript: startJavaScriptInteractive,
  js: startJavaScriptInteractive,
  nodejs: startJavaScriptInteractive,

  // Go
  go: startGoInteractive,
  golang: startGoInteractive,

  // PHP
  php: startPhpInteractive,

  // Rust
  rust: startRustInteractive,
};

// =========================================
// HOME
// =========================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to Rohit Code Backend 🚀",
  });
});

// =========================================
// HEALTH
// =========================================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Rohit Code server is running",
  });
});

// =========================================
// NORMAL CODE EXECUTION
// =========================================

app.post("/api/execute", async (req, res) => {
  const {
    language,
    code,
    input = "",
  } = req.body;

  if (
    typeof language !== "string" ||
    typeof code !== "string" ||
    !language.trim() ||
    !code.trim()
  ) {
    return res.status(400).json({
      success: false,
      output: "Language and code are required.",
    });
  }

  console.log("--------------------------------");
  console.log("▶ Normal execution");
  console.log("Language:", language);
  console.log("Input:", JSON.stringify(input));
  console.log("--------------------------------");

  try {
    const result = await executeCode(
      language,
      code,
      input
    );

    return res.json(
      result || {
        success: false,
        output: "No execution result returned.",
      }
    );
  } catch (error) {
    console.error(
      "❌ Normal execution error:",
      error
    );

    return res.status(500).json({
      success: false,
      output:
        error?.message ||
        "Execution server error.",
    });
  }
});

// =========================================
// TERMINAL COMMAND
// =========================================

app.post("/api/terminal", async (req, res) => {
  const { command } = req.body;

  if (
    typeof command !== "string" ||
    !command.trim()
  ) {
    return res.status(400).json({
      success: false,
      output: "Command is required.",
    });
  }

  try {
    const result =
      await runTerminalCommand(command);

    return res.json(
      result || {
        success: false,
        output: "No terminal result returned.",
      }
    );
  } catch (error) {
    console.error(
      "❌ Terminal error:",
      error
    );

    return res.status(500).json({
      success: false,
      output:
        error?.message ||
        "Terminal server error.",
    });
  }
});

// =========================================
// TERMINAL AUTOCOMPLETE
// =========================================

app.post(
  "/api/terminal/suggest",
  async (req, res) => {
    const { input = "" } = req.body;

    if (
      typeof input !== "string" ||
      !input.trim()
    ) {
      return res.json({
        success: true,
        suggestions: [],
      });
    }

    try {
      const suggestions =
        await getFilesystemSuggestions(input);

      return res.json({
        success: true,
        suggestions: Array.isArray(
          suggestions
        )
          ? suggestions
          : [],
      });
    } catch (error) {
      console.error(
        "❌ Suggestion error:",
        error
      );

      return res.status(500).json({
        success: false,
        suggestions: [],
      });
    }
  }
);
// =========================================
// GEMINI AI CODE ASSISTANT
// IMPORTANT:
// THIS MUST BE OUTSIDE socket.io
// =========================================

app.post(
  "/api/ai/generate",
  async (req, res) => {
    const {
      prompt,
      language,
      currentCode = "",
    } = req.body;

    if (
      typeof prompt !== "string" ||
      !prompt.trim()
    ) {
      return res.status(400).json({
        success: false,
        output: "AI prompt is required.",
      });
    }

    try {
      console.log("--------------------------------");
      console.log("🤖 Gemini AI request");
      console.log("Language:", language);
      console.log("Prompt:", prompt);
      console.log("--------------------------------");

      const code = await generateCode({
        prompt,
        language,
        currentCode,
      });

      return res.json({
        success: true,
        code,
      });
    } catch (error) {
      console.error(
        "❌ Gemini AI error:",
        error
      );

      return res.status(500).json({
        success: false,
        output:
          error?.message ||
          "Gemini AI request failed.",
      });
    }
  }
);

// =========================================
// SOCKET.IO CONNECTION
// =========================================

io.on("connection", (socket) => {
  console.log(
    "🔌 Client connected:",
    socket.id
  );

  // Each browser connection
  // gets its own running process.

  let runningProcess = null;

  // =======================================
  // RUN INTERACTIVE PROGRAM
  // =======================================

  socket.on(
    "run-interactive",
    (payload = {}) => {
      const {
        language,
        code,
      } = payload;

      const normalizedLanguage =
        String(language || "")
          .trim()
          .toLowerCase();

      // -------------------------------------
      // VALIDATION
      // -------------------------------------

      if (
        !normalizedLanguage ||
        typeof code !== "string" ||
        !code.trim()
      ) {
        socket.emit(
          "terminal-output",
          {
            data:
              "\r\n❌ Language and code are required.\r\n",
          }
        );

        socket.emit(
          "program-finished",
          {
            exitCode: 1,
          }
        );

        return;
      }

      // -------------------------------------
      // FIND RUNNER
      // -------------------------------------

      const runner =
        interactiveRunners[
          normalizedLanguage
        ];

      if (!runner) {
        socket.emit(
          "terminal-output",
          {
            data:
              `\r\n❌ Interactive execution for "${language}" is not available yet.\r\n`,
          }
        );

        socket.emit(
          "program-finished",
          {
            exitCode: 1,
          }
        );

        return;
      }

      // -------------------------------------
      // STOP PREVIOUS PROGRAM
      // -------------------------------------

      if (
        runningProcess &&
        typeof runningProcess.stop ===
          "function"
      ) {
        console.log(
          "⏹ Stopping previous program..."
        );

        try {
          runningProcess.stop();
        } catch (error) {
          console.error(
            "Previous process stop error:",
            error
          );
        }

        runningProcess = null;
      }

      // -------------------------------------
      // START MESSAGE
      // -------------------------------------

      console.log(
        `▶ Interactive ${normalizedLanguage}`
      );

      socket.emit(
        "terminal-output",
        {
          data:
            `\r\n> Running ${normalizedLanguage} program...\r\n`,
        }
      );

      // -------------------------------------
      // START RUNNER
      // -------------------------------------

      try {
        const controller = runner(code, {
          // ===============================
          // PROGRAM OUTPUT
          // ===============================

          onOutput: (data) => {
            if (!socket.connected) {
              return;
            }

            socket.emit(
              "terminal-output",
              {
                data: String(data),
              }
            );
          },

          // ===============================
          // PROGRAM EXIT
          // ===============================

          onExit: (
            exitCode,
            stdout,
            stderr
          ) => {
            if (!socket.connected) {
              return;
            }

            console.log(
              `⏹ ${normalizedLanguage} exited with code ${exitCode}`
            );

            socket.emit(
              "terminal-output",
              {
                data:
                  `\r\n> Process exited with code ${exitCode}.\r\n`,
              }
            );

            socket.emit(
              "program-finished",
              {
                exitCode:
                  typeof exitCode ===
                  "number"
                    ? exitCode
                    : 0,
              }
            );

            runningProcess = null;
          },

          // ===============================
          // PROGRAM ERROR
          // ===============================

          onError: (error) => {
            if (!socket.connected) {
              return;
            }

            console.error(
              `❌ ${normalizedLanguage} interactive error:`,
              error
            );

            socket.emit(
              "terminal-output",
              {
                data:
                  `\r\n❌ ${String(
                    error
                  )}\r\n`,
              }
            );

            socket.emit(
              "program-finished",
              {
                exitCode: 1,
              }
            );

            runningProcess = null;
          },
        });

        // ---------------------------------
        // CHECK CONTROLLER
        // ---------------------------------

        if (!controller) {
          socket.emit(
            "terminal-output",
            {
              data:
                "\r\n❌ Could not start program.\r\n",
            }
          );

          socket.emit(
            "program-finished",
            {
              exitCode: 1,
            }
          );

          runningProcess = null;

          return;
        }

        // ---------------------------------
        // SAVE CONTROLLER
        // ---------------------------------

        runningProcess = controller;

        console.log(
          `✅ ${normalizedLanguage} interactive process started`
        );
      } catch (error) {
        console.error(
          "❌ Interactive execution error:",
          error
        );

        runningProcess = null;

        socket.emit(
          "terminal-output",
          {
            data:
              `\r\n❌ ${
                error?.message ||
                "Interactive execution failed."
              }\r\n`,
          }
        );

        socket.emit(
          "program-finished",
          {
            exitCode: 1,
          }
        );
      }
    }
  );

  // =======================================
  // TERMINAL INPUT
  // =======================================

  socket.on(
    "terminal-input",
    (input) => {
      const value = String(
        input ?? ""
      );

      console.log(
        "⌨ Program input:",
        JSON.stringify(value)
      );

      if (
        !runningProcess ||
        typeof runningProcess.writeInput !==
          "function"
      ) {
        console.log(
          "⚠ No active interactive process."
        );

        return;
      }

      try {
        /*
         * IMPORTANT:
         *
         * Do NOT call .end().
         *
         * Interactive programs need stdin
         * to remain open.
         */

        runningProcess.writeInput(value);
      } catch (error) {
        console.error(
          "❌ Input error:",
          error
        );

        socket.emit(
          "terminal-output",
          {
            data:
              `\r\n❌ Input error: ${
                error?.message ||
                "Could not send input."
              }\r\n`,
          }
        );
      }
    }
  );

  // =======================================
  // STOP EXECUTION
  // =======================================

  socket.on(
    "stop-execution",
    () => {
      console.log(
        "⏹ Stop requested:",
        socket.id
      );

      if (
        runningProcess &&
        typeof runningProcess.stop ===
          "function"
      ) {
        try {
          runningProcess.stop();
        } catch (error) {
          console.error(
            "❌ Stop execution error:",
            error
          );
        }
      }

      runningProcess = null;

      socket.emit(
        "terminal-output",
        {
          data:
            "\r\n> Process stopped.\r\n",
        }
      );

      socket.emit(
        "program-finished",
        {
          exitCode: 130,
        }
      );
    }
  );

  // =======================================
  // DISCONNECT
  // =======================================

  socket.on(
    "disconnect",
    (reason) => {
      console.log(
        "🔌 Client disconnected:",
        socket.id,
        reason
      );

      if (
        runningProcess &&
        typeof runningProcess.stop ===
          "function"
      ) {
        try {
          runningProcess.stop();
        } catch (error) {
          console.error(
            "❌ Disconnect cleanup error:",
            error
          );
        }
      }

      runningProcess = null;
    }
  );
});
// =========================================
// 404
// =========================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found.",
  });
});

// =========================================
// GLOBAL ERROR
// =========================================

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "❌ Global server error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Internal server error.",
    });
  }
);

// =========================================
// START SERVER
// =========================================

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "--------------------------------"
    );

    console.log(
      "🚀 ROHIT CODE BACKEND"
    );

    console.log(
      "--------------------------------"
    );

    console.log(
      `🚀 Server listening on port ${PORT}`
    );

    console.log(
      "🔌 Socket.IO enabled ✅"
    );

    console.log(
      "🐳 Docker execution enabled ✅"
    );

    console.log(
      "▶ Interactive: C / C++ / Java / Python / JavaScript / Go / PHP / Rust"
    );

    console.log(
      "▶ Normal: C / C++ / Java / Python / JavaScript / Go / PHP / Rust"
    );

    console.log(
      "🤖 Gemini AI enabled ✅"
    );

    console.log(
      "--------------------------------"
    );
  }
);

// =========================================
// SERVER ERROR
// =========================================

server.on(
  "error",
  (error) => {
    console.error(
      "❌ Server error:",
      error
    );
  }
);