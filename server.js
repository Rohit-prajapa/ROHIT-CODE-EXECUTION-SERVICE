const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");
const pty = require("node-pty");

const app = express();

const PORT = process.env.PORT || 10000;

const EXECUTION_TIMEOUT = 10000;

const isWindows = process.platform === "win32";

// =========================================================
// EXECUTABLE HELPERS
// =========================================================

function executableName(name) {
  return isWindows ? `${name}.exe` : name;
}

function executablePath(name) {
  return isWindows ? name : `./${name}`;
}

// =========================================================
// WINDOWS PTY EXECUTABLE RESOLVER
// =========================================================

function resolvePtyExecutable(command) {
  if (!isWindows) {
    return command;
  }

  // Already an absolute path
  if (path.isAbsolute(command)) {
    return command;
  }

  try {
    const paths = execFileSync(
      "where.exe",
      [command],
      {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }
    )
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (paths.length > 0) {
      // Prefer real installed executable over WindowsApps alias
      const installed = paths.find(
        (item) =>
          !item
            .toLowerCase()
            .includes("\\windowsapps\\")
      );

      return installed || paths[0];
    }
  } catch (error) {
    console.error(
      `❌ Could not resolve PTY executable "${command}":`,
      error.message
    );
  }

  return command;
}

// =========================================================
// MIDDLEWARE
// =========================================================

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
  })
);

app.use(
  express.json({
    limit: "1mb",
  })
);

// =========================================================
// INTERACTIVE PROCESSES
// =========================================================

const runningProcesses = new Map();

// =========================================================
// HEALTH
// =========================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message:
      "ROHIT-CODE Execution Service 🚀",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message:
      "Execution service is running",
    platform: process.platform,
    interactiveProcesses:
      runningProcesses.size,
  });
});

// =========================================================
// LANGUAGE CONFIG
// =========================================================

const LANGUAGE_CONFIG = {
  // =========================
  // C
  // =========================

  c: {
    extension: "c",

    compile: [
      "gcc",
      "main.c",
      "-O2",
      "-o",
      executableName("main"),
    ],

    run: [
      executablePath("main"),
    ],
  },

  // =========================
  // C++
  // =========================

  cpp: {
    extension: "cpp",

    compile: [
      "g++",
      "main.cpp",
      "-O2",
      "-o",
      executableName("main"),
    ],

    run: [
      executablePath("main"),
    ],
  },

  "c++": {
    extension: "cpp",

    compile: [
      "g++",
      "main.cpp",
      "-O2",
      "-o",
      executableName("main"),
    ],

    run: [
      executablePath("main"),
    ],
  },

  // =========================
  // JAVA
  // =========================

  java: {
    extension: "java",

    compile: [
      "javac",
      "Main.java",
    ],

    run: [
      "java",
      "Main",
    ],
  },

  // =========================
  // PYTHON
  // =========================

  python: {
    extension: "py",

    compile: null,

    run: [
      "python",
      "-u",
      "main.py",
    ],
  },

  python3: {
    extension: "py",

    compile: null,

    run: [
      "python",
      "-u",
      "main.py",
    ],
  },

  // =========================
  // JAVASCRIPT
  // =========================

  javascript: {
    extension: "js",

    compile: null,

    run: [
      "node",
      "main.js",
    ],
  },

  js: {
    extension: "js",

    compile: null,

    run: [
      "node",
      "main.js",
    ],
  },

  nodejs: {
    extension: "js",

    compile: null,

    run: [
      "node",
      "main.js",
    ],
  },

  // =========================
  // GO
  // =========================

  go: {
    extension: "go",

    compile: [
      "go",
      "build",
      "-o",
      executableName("main"),
      "main.go",
    ],

    run: [
      executablePath("main"),
    ],
  },

  golang: {
    extension: "go",

    compile: [
      "go",
      "build",
      "-o",
      executableName("main"),
      "main.go",
    ],

    run: [
      executablePath("main"),
    ],
  },

  // =========================
  // PHP
  // =========================

  php: {
    extension: "php",

    compile: null,

    run: [
      "php",
      "main.php",
    ],
  },

  // =========================
  // RUST
  // =========================

  rust: {
    extension: "rs",

    compile: [
      "rustc",
      "main.rs",
      "-O",
      "-o",
      executableName("main"),
    ],

    run: [
      executablePath("main"),
    ],
  },
};

// =========================================================
// NORMALIZE LANGUAGE
// =========================================================

function normalizeLanguage(language) {
  return String(language || "")
    .trim()
    .toLowerCase();
}

// =========================================================
// NORMAL PROCESS RUNNER
// =========================================================

function runProcess(
  command,
  args,
  cwd,
  input = "",
  timeout = EXECUTION_TIMEOUT
) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;

    const child = spawn(
      command,
      args,
      {
        cwd,

        env: {
          ...process.env,
          HOME: cwd,
        },

        shell: false,

        stdio: [
          "pipe",
          "pipe",
          "pipe",
        ],
      }
    );

    const timer = setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;

      try {
        child.kill("SIGKILL");
      } catch {}

      resolve({
        success: false,
        stdout,
        stderr:
          stderr +
          "\nExecution timed out.\n",
        exitCode: 124,
        timedOut: true,
      });
    }, timeout);

    child.stdout.on(
      "data",
      (data) => {
        stdout += data.toString();
      }
    );

    child.stderr.on(
      "data",
      (data) => {
        stderr += data.toString();
      }
    );

    child.on(
      "error",
      (error) => {
        if (finished) {
          return;
        }

        finished = true;

        clearTimeout(timer);

        resolve({
          success: false,
          stdout,
          stderr:
            stderr +
            "\n" +
            error.message,
          exitCode: 1,
        });
      }
    );

    child.on(
      "close",
      (code) => {
        if (finished) {
          return;
        }

        finished = true;

        clearTimeout(timer);

        resolve({
          success: code === 0,
          stdout,
          stderr,
          exitCode:
            typeof code === "number"
              ? code
              : 1,
        });
      }
    );

    try {
      if (
        input !== undefined &&
        input !== null &&
        String(input).length > 0
      ) {
        child.stdin.write(
          String(input)
        );
      }

      child.stdin.end();
    } catch (error) {
      console.error(
        "Input error:",
        error.message
      );

      try {
        child.stdin.end();
      } catch {}
    }
  });
}

// =========================================================
// CREATE JOB DIRECTORY
// =========================================================

function createJobDirectory() {
  const jobId = crypto
    .randomUUID()
    .replace(/-/g, "");

  const jobDirectory = path.join(
    os.tmpdir(),
    `rohit-code-${jobId}`
  );

  fs.mkdirSync(
    jobDirectory,
    {
      recursive: true,
    }
  );

  return {
    jobId,
    jobDirectory,
  };
}

// =========================================================
// COMPILE SOURCE
// =========================================================

async function compileSource(
  config,
  jobDirectory
) {
  if (!config.compile) {
    return {
      success: true,
    };
  }

  console.log(
    "🔨 Compile:",
    config.compile[0],
    config.compile.slice(1)
  );

  const result =
    await runProcess(
      config.compile[0],
      config.compile.slice(1),
      jobDirectory,
      "",
      EXECUTION_TIMEOUT
    );

  if (!result.success) {
    return {
      success: false,

      output:
        result.stderr ||
        result.stdout ||
        "Compilation failed.",

      stdout:
        result.stdout,

      stderr:
        result.stderr,

      exitCode:
        result.exitCode,
    };
  }

  return {
    success: true,
  };
}

// =========================================================
// NORMAL EXECUTION
// =========================================================

app.post(
  "/api/execute",
  async (req, res) => {
    const {
      language,
      code,
      input = "",
    } = req.body || {};

    const normalizedLanguage =
      normalizeLanguage(language);

    if (!normalizedLanguage) {
      return res
        .status(400)
        .json({
          success: false,
          output:
            "Language is required.",
        });
    }

    if (
      typeof code !== "string" ||
      !code.trim()
    ) {
      return res
        .status(400)
        .json({
          success: false,
          output:
            "Code is required.",
        });
    }

    const config =
      LANGUAGE_CONFIG[
        normalizedLanguage
      ];

    if (!config) {
      return res
        .status(400)
        .json({
          success: false,
          output:
            `Language "${language}" is not supported.`,
        });
    }

    let jobDirectory =
      null;

    try {
      const job =
        createJobDirectory();

      jobDirectory =
        job.jobDirectory;

      const sourceFile =
        path.join(
          jobDirectory,
          `main.${config.extension}`
        );

      fs.writeFileSync(
        sourceFile,
        code,
        "utf8"
      );

      const compileResult =
        await compileSource(
          config,
          jobDirectory
        );

      if (
        !compileResult.success
      ) {
        return res.json({
          success: false,

          output:
            compileResult.output,

          error:
            compileResult.stderr ||
            "Compilation failed.",

          exitCode:
            compileResult.exitCode,
        });
      }

      const result =
        await runProcess(
          config.run[0],
          config.run.slice(1),
          jobDirectory,
          input,
          EXECUTION_TIMEOUT
        );

      const output =
        result.stdout ||
        result.stderr ||
        "";

      return res.json({
        success:
          result.success,

        output,

        stdout:
          result.stdout,

        stderr:
          result.stderr,

        exitCode:
          result.exitCode,

        timedOut:
          result.timedOut ||
          false,
      });
    } catch (error) {
      console.error(
        "❌ Execution error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,

          output:
            error.message ||
            "Execution service error.",
        });
    } finally {
      if (jobDirectory) {
        try {
          fs.rmSync(
            jobDirectory,
            {
              recursive: true,
              force: true,
            }
          );
        } catch (error) {
          console.error(
            "Cleanup error:",
            error.message
          );
        }
      }
    }
  }
);

// =========================================================
// INTERACTIVE START
// =========================================================

app.post(
  "/api/interactive/start",
  async (req, res) => {
    const {
      language,
      code,
    } = req.body || {};

    console.log(
      "================================"
    );

    console.log(
      "▶ Interactive start request"
    );

    console.log(
      "Language:",
      language
    );

    console.log(
      "Code length:",
      typeof code === "string"
        ? code.length
        : 0
    );

    console.log(
      "================================"
    );

    const normalizedLanguage =
      normalizeLanguage(language);

    if (!normalizedLanguage) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Language is required.",
        });
    }

    if (
      typeof code !== "string" ||
      !code.trim()
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Code is required.",
        });
    }

    const config =
      LANGUAGE_CONFIG[
        normalizedLanguage
      ];

    if (!config) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            `Language "${language}" is not supported.`,
        });
    }

    let jobDirectory =
      null;

    try {
      const job =
        createJobDirectory();

      const processId =
        job.jobId;

      jobDirectory =
        job.jobDirectory;

      const sourceFile =
        path.join(
          jobDirectory,
          `main.${config.extension}`
        );

      fs.writeFileSync(
        sourceFile,
        code,
        "utf8"
      );

      console.log(
        "📄 Source:",
        sourceFile
      );

      // =====================================================
      // COMPILE
      // =====================================================

      const compileResult =
        await compileSource(
          config,
          jobDirectory
        );

      if (
        !compileResult.success
      ) {
        try {
          fs.rmSync(
            jobDirectory,
            {
              recursive: true,
              force: true,
            }
          );
        } catch {}

        jobDirectory = null;

        return res.json({
          success: false,

          processId: null,

          output:
            compileResult.output,

          stdout:
            compileResult.stdout,

          stderr:
            compileResult.stderr,

          exitCode:
            compileResult.exitCode,
        });
      }

      console.log(
        "✅ Compilation successful"
      );

      // =====================================================
      // PTY COMMAND
      // =====================================================

      let ptyCommand =
        config.run[0];

      let ptyArgs =
        config.run.slice(1);

      const nativeLanguages = [
        "c",
        "cpp",
        "c++",
        "go",
        "golang",
        "rust",
      ];

      if (
        nativeLanguages.includes(
          normalizedLanguage
        )
      ) {
        const executableFile =
          isWindows
            ? "main.exe"
            : "main";

        ptyCommand =
          path.join(
            jobDirectory,
            executableFile
          );

        ptyArgs = [];
      }

      // =====================================================
      // IMPORTANT WINDOWS FIX
      // =====================================================

      ptyCommand =
        resolvePtyExecutable(
          ptyCommand
        );

      console.log(
        "🔧 PTY executable:",
        ptyCommand
      );

      console.log(
        "🔧 PTY args:",
        ptyArgs
      );

      // =====================================================
      // ENVIRONMENT
      // =====================================================

      const env = {
        ...process.env,

        HOME:
          jobDirectory,

        PYTHONUNBUFFERED:
          "1",
      };

      // =====================================================
      // START PTY
      // =====================================================

      const ptyProcess =
        pty.spawn(
          ptyCommand,
          ptyArgs,
          {
            name:
              "xterm-color",

            cols: 120,

            rows: 30,

            cwd:
              jobDirectory,

            env,
          }
        );

      // =====================================================
      // PROCESS INFO
      // =====================================================

      const processInfo = {
        processId,

        ptyProcess,

        jobDirectory,

        startedAt:
          Date.now(),

        finished:
          false,

        exitCode:
          null,

        signal:
          null,

        timedOut:
          false,

        outputBuffer:
          "",

        timeoutTimer:
          null,
      };

      runningProcesses.set(
        processId,
        processInfo
      );

      console.log(
        "================================"
      );

      console.log(
        "🚀 PTY PROCESS STARTED"
      );

      console.log(
        "Process ID:",
        processId
      );

      console.log(
        "Language:",
        normalizedLanguage
      );

      console.log(
        "================================"
      );

      // =====================================================
      // PTY OUTPUT
      // =====================================================

      ptyProcess.onData(
        (data) => {
          console.log(
            `📤 [${processId}]`,
            JSON.stringify(data)
          );

          processInfo.outputBuffer +=
            data;
        }
      );

      // =====================================================
      // PTY EXIT
      // =====================================================

      ptyProcess.onExit(
        ({
          exitCode,
          signal,
        }) => {
          console.log(
            "================================"
          );

          console.log(
            `⏹ PTY EXIT [${processId}]`
          );

          console.log(
            "Exit code:",
            exitCode
          );

          console.log(
            "Signal:",
            signal
          );

          console.log(
            "================================"
          );

          processInfo.finished =
            true;

          processInfo.exitCode =
            typeof exitCode ===
              "number"
              ? exitCode
              : 0;

          processInfo.signal =
            signal || null;
        }
      );

      // =====================================================
      // NO INTERACTIVE TIMEOUT
      // =====================================================

      processInfo.timeoutTimer =
        null;

      // =====================================================
      // RETURN PROCESS ID
      // =====================================================

      return res.json({
        success: true,

        processId,

        message:
          "Interactive PTY started.",
      });
    } catch (error) {
      console.error(
        "❌ Interactive start error:",
        error
      );

      if (jobDirectory) {
        try {
          fs.rmSync(
            jobDirectory,
            {
              recursive: true,
              force: true,
            }
          );
        } catch {}
      }

      return res
        .status(500)
        .json({
          success: false,

          message:
            error.message ||
            "Could not start interactive process.",
        });
    }
  }
);

// =========================================================
// SEND INTERACTIVE INPUT
// =========================================================

app.post(
  "/api/interactive/input",
  (req, res) => {
    const {
      processId,
      input,
    } = req.body || {};

    if (!processId) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "processId is required.",
        });
    }

    if (
      input === undefined ||
      input === null
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Input is required.",
        });
    }

    const processInfo =
      runningProcesses.get(
        processId
      );

    if (!processInfo) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            "Interactive process not found.",
        });
    }

    if (
      processInfo.finished
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "Process has already finished.",
        });
    }

    try {
      let value =
        String(input);

      if (
        !value.endsWith("\n") &&
        !value.endsWith("\r")
      ) {
        value += "\r";
      }

      console.log(
        `⌨ [${processId}] INPUT:`,
        JSON.stringify(value)
      );

      processInfo.ptyProcess.write(
        value
      );

      return res.json({
        success: true,

        message:
          "Input sent to PTY.",
      });
    } catch (error) {
      console.error(
        "❌ PTY input error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,

          message:
            error.message ||
            "Could not send input.",
        });
    }
  }
);

// =========================================================
// GET INTERACTIVE OUTPUT
// =========================================================

app.get(
  "/api/interactive/output/:processId",
  (req, res) => {
    const {
      processId,
    } = req.params;

    const processInfo =
      runningProcesses.get(
        processId
      );

    if (!processInfo) {
      return res
        .status(404)
        .json({
          success: false,

          message:
            "Interactive process not found.",
        });
    }

    const output =
      processInfo.outputBuffer ||
      "";

    processInfo.outputBuffer =
      "";

    return res.json({
      success: true,

      processId,

      output,

      finished:
        processInfo.finished,

      timedOut:
        processInfo.timedOut,

      exitCode:
        processInfo.exitCode,

      signal:
        processInfo.signal,
    });
  }
);

// =========================================================
// STOP INTERACTIVE PROCESS
// =========================================================

app.post(
  "/api/interactive/stop",
  (req, res) => {
    const {
      processId,
    } = req.body || {};

    if (!processId) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            "processId is required.",
        });
    }

    const processInfo =
      runningProcesses.get(
        processId
      );

    if (!processInfo) {
      return res
        .status(404)
        .json({
          success: false,

          message:
            "Interactive process not found.",
        });
    }

    console.log(
      "⏹ Stopping process:",
      processId
    );

    try {
      processInfo.ptyProcess.kill();
    } catch {}

    processInfo.finished =
      true;

    processInfo.exitCode =
      130;

    try {
      if (
        processInfo.jobDirectory &&
        fs.existsSync(
          processInfo.jobDirectory
        )
      ) {
        fs.rmSync(
          processInfo.jobDirectory,
          {
            recursive: true,
            force: true,
          }
        );
      }
    } catch (error) {
      console.error(
        "Cleanup error:",
        error.message
      );
    }

    runningProcesses.delete(
      processId
    );

    return res.json({
      success: true,

      message:
        "Interactive process stopped.",
    });
  }
);

// =========================================================
// LIST INTERACTIVE PROCESSES
// =========================================================

app.get(
  "/api/interactive/processes",
  (req, res) => {
    const processes =
      Array.from(
        runningProcesses.values()
      ).map(
        (processInfo) => ({
          processId:
            processInfo.processId,

          finished:
            processInfo.finished,

          timedOut:
            processInfo.timedOut,

          exitCode:
            processInfo.exitCode,

          startedAt:
            processInfo.startedAt,

          outputLength:
            processInfo.outputBuffer
              .length,
        })
      );

    return res.json({
      success: true,

      count:
        processes.length,

      processes,
    });
  }
);

// =========================================================
// 404
// =========================================================

app.use(
  (req, res) => {
    res.status(404).json({
      success: false,

      message:
        "Route not found.",
    });
  }
);

// =========================================================
// GLOBAL ERROR
// =========================================================

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

    if (
      res.headersSent
    ) {
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

// =========================================================
// START SERVER
// =========================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "================================"
    );

    console.log(
      "🚀 ROHIT-CODE EXECUTION SERVICE"
    );

    console.log(
      "================================"
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      "Platform:",
      process.platform
    );

    console.log(
      "Languages:"
    );

    console.log(
      "C / C++ / Java / Python / JavaScript / Go / PHP / Rust"
    );

    console.log(
      "================================"
    );

    console.log(
      "Interactive execution: ENABLED ✅"
    );

    console.log(
      "PTY terminal: ENABLED ✅"
    );

    console.log(
      "Interactive stdin: ENABLED ✅"
    );

    console.log(
      "Windows executable support: ENABLED ✅"
    );

    console.log(
      "Interactive timeout: DISABLED ✅"
    );

    console.log(
      "Process persistence: ENABLED ✅"
    );

    console.log(
      "================================"
    );
  }
);