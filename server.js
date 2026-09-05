const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");
const pty = require("node-pty");

const app = express();

const PORT = process.env.PORT || 10001;
const EXECUTION_TIMEOUT = 30000;
const COMPILE_TIMEOUT = 60000;

// =========================================================
// PLATFORM
// =========================================================

const isWindows = process.platform === "win32";

// =========================================================
// DOCKER IMAGES
// =========================================================

const DOCKER_IMAGES = {
  go: "golang:1.24-alpine",
  php: "php:8.4-cli-alpine",
  rust: "rust:1.88-alpine",
  csharp: "mcr.microsoft.com/dotnet/sdk:8.0",
};

// =========================================================
// MIDDLEWARE
// =========================================================

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
  }),
);

app.use(
  express.json({
    limit: "1mb",
  }),
);

// =========================================================
// INTERACTIVE PROCESSES
// =========================================================

const runningProcesses = new Map();

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

  if (path.isAbsolute(command)) {
    return command;
  }

  try {
    const paths = execFileSync("where.exe", [command], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (paths.length > 0) {
      const installed = paths.find(
        (item) => !item.toLowerCase().includes("\\windowsapps\\"),
      );

      return installed || paths[0];
    }
  } catch (error) {
    console.error(
      `❌ Could not resolve PTY executable "${command}":`,
      error.message,
    );
  }

  return command;
}

// =========================================================
// HEALTH
// =========================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "CodeForge Execution Service 🚀",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Execution service is running",
    platform: process.platform,
    interactiveProcesses: runningProcesses.size,
  });
});

// =========================================================
// LANGUAGE CONFIG
// =========================================================

const LANGUAGE_CONFIG = {
  // =======================================================
  // C
  // =======================================================

  c: {
    extension: "c",
    type: "native",
    compile: ["gcc", "main.c", "-O2", "-o", "main"],
    run: ["./main"],
  },

  // =======================================================
  // C++
  // =======================================================

  cpp: {
    extension: "cpp",
    type: "native",
    compile: ["g++", "main.cpp", "-std=c++17", "-O2", "-o", "main"],
    run: ["./main"],
  },

  // =======================================================
  // JAVA
  // =======================================================

  java: {
    extension: "java",
    type: "native",
    compile: ["javac", "main.java"],
    run: ["java", "main"],
  },

  // =======================================================
  // PYTHON
  // =======================================================

  python: {
    extension: "py",
    type: "native",
    run: ["python3", "main.py"],
  },

  // =======================================================
  // JAVASCRIPT
  // =======================================================

  javascript: {
    extension: "js",
    type: "native",
    run: ["node", "main.js"],
  },

  // =======================================================
  // PHP
  // =======================================================

  php: {
    extension: "php",
    type: "native",
    run: ["php", "main.php"],
  },

  // =======================================================
  // RUST
  // =======================================================

  rust: {
    extension: "rs",
    type: "native",
    compile: ["rustc", "main.rs", "-O", "-o", "main"],
    run: ["./main"],
  },

  // =======================================================
  // C#
  // =======================================================

  csharp: {
    extension: "cs",
    type: "docker",
    image: DOCKER_IMAGES.csharp,
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
// JAVA FILE NAME HELPERS
// =========================================================

function normalizeJavaFileName(fileName = "Main.java") {
  let name = path.basename(String(fileName || "Main.java").trim());

  if (!name) {
    name = "Main.java";
  }

  if (!name.toLowerCase().endsWith(".java")) {
    name += ".java";
  }

  return name;
}

function getJavaClassName(fileName = "Main.java") {
  return path.basename(normalizeJavaFileName(fileName), ".java");
}

// =========================================================
// CREATE JOB DIRECTORY
// =========================================================

function createJobDirectory() {
  const jobId = crypto.randomUUID().replace(/-/g, "");

  const jobDirectory = path.join(os.tmpdir(), `rohit-code-${jobId}`);

  fs.mkdirSync(jobDirectory, {
    recursive: true,
  });

  return {
    jobId,
    jobDirectory,
  };
}

// =========================================================
// CLEANUP DIRECTORY
// =========================================================

function cleanupDirectory(directory) {
  if (!directory) {
    return;
  }

  try {
    if (fs.existsSync(directory)) {
      fs.rmSync(directory, {
        recursive: true,
        force: true,
      });
    }
  } catch (error) {
    console.error("Cleanup error:", error.message);
  }
}

// =========================================================
// NORMAL NATIVE PROCESS
// =========================================================

function runNativeProcess(
  command,
  args,
  cwd,
  input = "",
  timeout = EXECUTION_TIMEOUT,
) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;

    const child = spawn(command, args, {
      cwd,

      env: {
        ...process.env,
        HOME: cwd,
        PYTHONUNBUFFERED: "1",
      },

      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

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
        stderr: stderr + "\nExecution timed out.\n",
        exitCode: 124,
        timedOut: true,
      });
    }, timeout);

    child.stdout.on("data", (data) => {
      if (finished) {
        return;
      }

      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      if (finished) {
        return;
      }

      stderr += data.toString();
    });

    child.on("error", (error) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);

      resolve({
        success: false,
        stdout,
        stderr: stderr + "\n" + error.message,
        exitCode: 1,
        timedOut: false,
      });
    });

    child.on("close", (code) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);

      resolve({
        success: code === 0,
        stdout,
        stderr,
        exitCode: typeof code === "number" ? code : 1,
        timedOut: false,
      });
    });

    try {
      if (input !== undefined && input !== null && String(input).length > 0) {
        child.stdin.write(String(input));
      }

      child.stdin.end();
    } catch (error) {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);

      resolve({
        success: false,
        stdout,
        stderr: stderr + "\n" + error.message,
        exitCode: 1,
        timedOut: false,
      });
    }
  });
}
// =========================================================
// DOCKER NORMAL EXECUTION
// =========================================================

function runDockerProgram({ image, language, jobDirectory, input = "" }) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;

    let command;

    switch (language) {
      case "c":
        command =
          "gcc main.c -O2 -o /code/main " +
          "&& chmod 755 /code/main " +
          "&& /code/main";
        break;

      case "cpp":
      case "c++":
        command =
          "g++ main.cpp -std=c++17 -O2 -o /code/main " +
          "&& chmod 755 /code/main " +
          "&& /code/main";
        break;

      case "java":
        command = "javac Main.java && java Main";
        break;

      case "python":
      case "python3":
        command = "python3 -u main.py";
        break;

      case "javascript":
      case "js":
      case "node":
      case "nodejs":
        command = "node main.js";
        break;

      case "go":
      case "golang":
        command =
          "GOCACHE=/tmp/go-cache " +
          "GOMODCACHE=/tmp/go-mod-cache " +
          "GOMAXPROCS=1 " +
          "go build -p 1 -o /code/main main.go " +
          "&& chmod 755 /code/main " +
          "&& /code/main";
        break;

      case "php":
        command =
          "php " +
          "-d display_errors=1 " +
          "-d display_startup_errors=1 " +
          "main.php";
        break;

      case "rust":
        command =
          "rustc main.rs -O -o /code/main " +
          "&& chmod 755 /code/main " +
          "&& /code/main";
        break;

      case "csharp":
        command =
          "dotnet new console --force -o /code/app --no-restore " +
          "&& cp main.cs /code/app/Program.cs " +
          "&& dotnet build /code/app/App.csproj --nologo " +
          "-p:RestoreIgnoreFailedSources=true -o /code/app/out " +
          "&& dotnet /code/app/out/App.dll";
        break;

      default:
        resolve({
          success: false,
          stdout: "",
          stderr: `Docker execution not configured for ${language}.`,
          exitCode: 1,
          timedOut: false,
        });

        return;
    }

    const dockerArgs = [
      "run",
      "--rm",
      "-i",

      "--memory=512m",
      "--cpus=0.5",
      "--pids-limit=100",

      "--network=none",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",

      "-v",
      `${jobDirectory}:/code:rw`,

      "-w",
      "/code",

      image,

      "sh",
      "-c",

      command,
    ];

    console.log("🐳 Docker execution:", language, image);
    console.log("🐳 Docker command:", command);

    const dockerProcess = spawn("docker", dockerArgs, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;

      console.log(`⏱ ${language} execution timed out.`);

      try {
        dockerProcess.kill("SIGKILL");
      } catch {}

      resolve({
        success: false,
        stdout,
        stderr: stderr + "\nExecution timed out after 30 seconds.\n",
        exitCode: 124,
        timedOut: true,
      });
    }, EXECUTION_TIMEOUT);

    dockerProcess.stdout.on("data", (data) => {
      if (finished) {
        return;
      }

      stdout += data.toString();
    });

    dockerProcess.stderr.on("data", (data) => {
      if (finished) {
        return;
      }

      stderr += data.toString();
    });

    dockerProcess.on("error", (error) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);

      console.error(`❌ Docker ${language} error:`, error.message);

      resolve({
        success: false,
        stdout,
        stderr: stderr + "\n" + error.message,
        exitCode: 1,
        timedOut: false,
      });
    });

    dockerProcess.on("close", (exitCode) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);

      const finalExitCode =
        typeof exitCode === "number" ? exitCode : 1;

      console.log(
        `✅ ${language} Docker process exited:`,
        finalExitCode,
      );

      resolve({
        success: finalExitCode === 0,
        stdout,
        stderr,
        exitCode: finalExitCode,
        timedOut: false,
      });
    });

    try {
      if (
        dockerProcess.stdin &&
        !dockerProcess.stdin.destroyed &&
        !dockerProcess.stdin.writableEnded
      ) {
        dockerProcess.stdin.write(String(input ?? ""));
        dockerProcess.stdin.end();
      }
    } catch (error) {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);

      try {
        dockerProcess.kill("SIGKILL");
      } catch {}

      resolve({
        success: false,
        stdout,
        stderr: stderr + "\nCould not send input: " + error.message,
        exitCode: 1,
        timedOut: false,
      });
    }
  });
}

// =========================================================
// COMPILE NATIVE SOURCE
// =========================================================

async function compileNativeSource(
  config,
  jobDirectory,
  compileConfig = null,
) {
  if (!config.compile) {
    return {
      success: true,
    };
  }

  const compileCommand = compileConfig || config.compile;

  console.log(
    "🔨 Compile:",
    compileCommand[0],
    compileCommand.slice(1),
  );

  const result = await runNativeProcess(
    compileCommand[0],
    compileCommand.slice(1),
    jobDirectory,
    "",
    COMPILE_TIMEOUT,
  );

  if (!result.success) {
    return {
      success: false,
      output:
        result.stderr ||
        result.stdout ||
        "Compilation failed.",
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    };
  }

  return {
    success: true,
  };
}

// =========================================================
// NORMAL EXECUTION API
// =========================================================

app.post("/api/execute", async (req, res) => {
  const {
    language,
    code,
    input = "",
    fileName = "",
  } = req.body || {};

  const normalizedLanguage = normalizeLanguage(language);

  console.log(
    "▶ Normal execution:",
    normalizedLanguage,
  );

  if (!normalizedLanguage) {
    return res.status(400).json({
      success: false,
      output: "Language is required.",
    });
  }

  if (typeof code !== "string" || !code.trim()) {
    return res.status(400).json({
      success: false,
      output: "Code is required.",
    });
  }

  const config = LANGUAGE_CONFIG[normalizedLanguage];

  if (!config) {
    return res.status(400).json({
      success: false,
      output: `Language "${language}" is not supported.`,
    });
  }

  let jobDirectory = null;

  try {
    const job = createJobDirectory();

    jobDirectory = job.jobDirectory;

    const javaFileName =
      normalizedLanguage === "java"
        ? normalizeJavaFileName(fileName)
        : null;

    const sourceFile = path.join(
      jobDirectory,
      javaFileName || `main.${config.extension}`,
    );

    fs.writeFileSync(sourceFile, code, "utf8");

    if (config.type === "docker") {
      const result = await runDockerProgram({
        image: config.image,
        language: normalizedLanguage,
        jobDirectory,
        input,
      });

      const output = result.stdout || result.stderr || "";

      return res.json({
        success: result.success,
        output,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut || false,
      });
    }

    const compileConfig =
      normalizedLanguage === "java"
        ? ["javac", javaFileName]
        : null;

    const compileResult = await compileNativeSource(
      config,
      jobDirectory,
      compileConfig,
    );

    if (!compileResult.success) {
      return res.json({
        success: false,
        output: compileResult.output,
        error:
          compileResult.stderr ||
          "Compilation failed.",
        stdout: compileResult.stdout,
        stderr: compileResult.stderr,
        exitCode: compileResult.exitCode,
        timedOut: compileResult.timedOut || false,
      });
    }

    const runConfig =
      normalizedLanguage === "java"
        ? ["java", getJavaClassName(javaFileName)]
        : config.run;

    const result = await runNativeProcess(
      runConfig[0],
      runConfig.slice(1),
      jobDirectory,
      input,
      EXECUTION_TIMEOUT,
    );

    const output = result.stdout || result.stderr || "";

    return res.json({
      success: result.success,
      output,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut || false,
    });
  } catch (error) {
    console.error("❌ Execution error:", error);

    return res.status(500).json({
      success: false,
      output:
        error.message ||
        "Execution service error.",
    });
  } finally {
    cleanupDirectory(jobDirectory);
  }
});
// =========================================================
// CREATE NATIVE PTY PROCESS
// =========================================================

function startNativeInteractiveProcess({
  config,
  normalizedLanguage,
  jobDirectory,
  processId,
}) {
  let ptyCommand = config.run[0];
  let ptyArgs = config.run.slice(1);

  const nativeLanguages = ["c", "cpp", "c++"];

  if (nativeLanguages.includes(normalizedLanguage)) {
    const executableFile = isWindows ? "main.exe" : "main";

    ptyCommand = path.join(jobDirectory, executableFile);

    ptyArgs = [];
  }

  // =======================================================
  // JAVA
  // =======================================================

  if (
    normalizedLanguage === "java" &&
    config.__javaFileName
  ) {
    ptyCommand = "java";
    ptyArgs = [
      getJavaClassName(config.__javaFileName),
    ];
  }

  ptyCommand = resolvePtyExecutable(ptyCommand);

  console.log("🔧 PTY executable:", ptyCommand);

  console.log("🔧 PTY args:", ptyArgs);

  const env = {
    ...process.env,
    HOME: jobDirectory,
    PYTHONUNBUFFERED: "1",
  };

  const ptyProcess = pty.spawn(
    ptyCommand,
    ptyArgs,
    {
      name: "xterm-color",
      cols: 120,
      rows: 30,
      cwd: jobDirectory,
      env,
    },
  );

  return ptyProcess;
}

// =========================================================
// CREATE DOCKER INTERACTIVE PROCESS
// =========================================================

function startDockerInteractiveProcess({
  config,
  normalizedLanguage,
  jobDirectory,
}) {
  let command;

  if (
    normalizedLanguage === "go" ||
    normalizedLanguage === "golang"
  ) {
    command =
      "GOCACHE=/tmp/go-cache " +
      "GOMODCACHE=/tmp/go-mod-cache " +
      "GOMAXPROCS=1 " +
      "go build -p 1 -o /code/main main.go " +
      "&& chmod 755 /code/main " +
      "&& /code/main";
  } else if (normalizedLanguage === "php") {
    command =
      "php " +
      "-d display_errors=1 " +
      "-d display_startup_errors=1 " +
      "main.php";
  } else if (normalizedLanguage === "rust") {
    command =
      "rustc main.rs -O -o /code/main " +
      "&& chmod 755 /code/main " +
      "&& /code/main";
  } else if (normalizedLanguage === "csharp") {
    command =
      "dotnet new console --force -o /code/app --no-restore " +
      "&& cp main.cs /code/app/Program.cs " +
      "&& dotnet build /code/app/App.csproj --nologo " +
      "-p:RestoreIgnoreFailedSources=true -o /code/app/out " +
      "&& dotnet /code/app/out/App.dll";
  } else {
    throw new Error(
      `Docker interactive execution not configured for ${normalizedLanguage}.`,
    );
  }

  const dockerArgs = [
    "run",
    "--rm",
    "-i",

    "--memory=512m",
    "--cpus=0.5",
    "--pids-limit=100",

    "--network=none",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",

    "-v",
    `${jobDirectory}:/code:rw`,

    "-w",
    "/code",

    config.image,

    "sh",
    "-c",

    command,
  ];

  console.log(
    "🐳 Starting Docker interactive:",
    config.image,
  );

  return spawn("docker", dockerArgs, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// =========================================================
// INTERACTIVE START API
// =========================================================

app.post(
  "/api/interactive/start",
  async (req, res) => {
    const {
      language,
      code,
      fileName = "",
    } = req.body || {};

    console.log("================================");

    console.log(
      "▶ Interactive start request",
    );

    console.log("Language:", language);

    console.log("File name:", fileName);

    console.log(
      "Code length:",
      typeof code === "string"
        ? code.length
        : 0,
    );

    console.log("================================");

    const normalizedLanguage =
      normalizeLanguage(language);

    if (!normalizedLanguage) {
      return res.status(400).json({
        success: false,
        message: "Language is required.",
      });
    }

    if (
      typeof code !== "string" ||
      !code.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Code is required.",
      });
    }

    const config =
      LANGUAGE_CONFIG[normalizedLanguage];

    if (!config) {
      return res.status(400).json({
        success: false,
        message:
          `Language "${language}" is not supported.`,
      });
    }

    let jobDirectory = null;

    try {
      const job = createJobDirectory();

      const processId = job.jobId;

      jobDirectory = job.jobDirectory;

      const javaFileName =
        normalizedLanguage === "java"
          ? normalizeJavaFileName(fileName)
          : null;

      const sourceFile = path.join(
        jobDirectory,
        javaFileName ||
          `main.${config.extension}`,
      );

      fs.writeFileSync(
        sourceFile,
        code,
        "utf8",
      );

      console.log(
        "📄 Source:",
        sourceFile,
      );

      // =====================================================
      // DOCKER INTERACTIVE
      // =====================================================

      if (config.type === "docker") {
        const dockerProcess =
          startDockerInteractiveProcess({
            config,
            normalizedLanguage,
            jobDirectory,
          });

        const processInfo = {
          processId,
          type: "docker",
          language: normalizedLanguage,
          process: dockerProcess,
          jobDirectory,
          startedAt: Date.now(),
          finished: false,
          exitCode: null,
          signal: null,
          timedOut: false,
          outputBuffer: "",
          stderrBuffer: "",
        };

        runningProcesses.set(
          processId,
          processInfo,
        );

        dockerProcess.stdout.on(
          "data",
          (data) => {
            if (processInfo.finished) {
              return;
            }

            const text = data.toString();

            console.log(
              `📤 [${processId}]`,
              JSON.stringify(text),
            );

            processInfo.outputBuffer += text;
          },
        );

        dockerProcess.stderr.on(
          "data",
          (data) => {
            if (processInfo.finished) {
              return;
            }

            const text = data.toString();

            console.log(
              `⚠️ [${processId}]`,
              JSON.stringify(text),
            );

            processInfo.outputBuffer += text;

            processInfo.stderrBuffer += text;
          },
        );

        dockerProcess.on(
          "error",
          (error) => {
            if (processInfo.finished) {
              return;
            }

            console.error(
              `❌ Docker process error [${processId}]:`,
              error.message,
            );

            processInfo.finished = true;

            processInfo.exitCode = 1;

            processInfo.outputBuffer +=
              `\r\n${error.message}\r\n`;
          },
        );

        dockerProcess.on(
          "close",
          (exitCode) => {
            if (processInfo.finished) {
              return;
            }

            console.log(
              `⏹ Docker process exit [${processId}]`,
              exitCode,
            );

            processInfo.finished = true;

            processInfo.exitCode =
              typeof exitCode === "number"
                ? exitCode
                : 0;
          },
        );

        return res.json({
          success: true,
          processId,
          message:
            "Interactive Docker process started.",
          executionType: "docker",
        });
      }

      // =====================================================
      // NATIVE INTERACTIVE
      // =====================================================

      const compileConfig =
        normalizedLanguage === "java"
          ? ["javac", javaFileName]
          : null;

      const compileResult =
        await compileNativeSource(
          config,
          jobDirectory,
          compileConfig,
        );

      if (!compileResult.success) {
        cleanupDirectory(jobDirectory);

        jobDirectory = null;

        return res.json({
          success: false,
          processId: null,
          output: compileResult.output,
          stdout: compileResult.stdout,
          stderr: compileResult.stderr,
          exitCode: compileResult.exitCode,
        });
      }

      console.log(
        "✅ Compilation successful",
      );

      const interactiveConfig =
        normalizedLanguage === "java"
          ? {
              ...config,
              __javaFileName:
                javaFileName,
            }
          : config;

      const ptyProcess =
        startNativeInteractiveProcess({
          config: interactiveConfig,
          normalizedLanguage,
          jobDirectory,
          processId,
        });

      const processInfo = {
        processId,
        type: "native",
        language: normalizedLanguage,
        ptyProcess,
        jobDirectory,
        startedAt: Date.now(),
        finished: false,
        exitCode: null,
        signal: null,
        timedOut: false,
        outputBuffer: "",
      };

      runningProcesses.set(
        processId,
        processInfo,
      );

      ptyProcess.onData((data) => {
        console.log(
          `📤 [${processId}]`,
          JSON.stringify(data),
        );

        processInfo.outputBuffer += data;
      });

      ptyProcess.onExit(
        ({ exitCode, signal }) => {
          console.log("================================");

          console.log(
            `⏹ PTY EXIT [${processId}]`,
          );

          console.log(
            "Exit code:",
            exitCode,
          );

          console.log(
            "Signal:",
            signal,
          );

          console.log("================================");

          processInfo.finished = true;

          processInfo.exitCode =
            typeof exitCode === "number"
              ? exitCode
              : 0;

          processInfo.signal =
            signal || null;
        },
      );

      return res.json({
        success: true,
        processId,
        message: "Interactive PTY started.",
        executionType: "native",
      });
    } catch (error) {
      console.error(
        "❌ Interactive start error:",
        error,
      );

      cleanupDirectory(jobDirectory);

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Could not start interactive process.",
      });
    }
  },
);
// =========================================================
// SEND INTERACTIVE INPUT
// =========================================================

app.post("/api/interactive/input", (req, res) => {
  const { processId, input } = req.body || {};

  if (!processId) {
    return res.status(400).json({
      success: false,
      message: "processId is required.",
    });
  }

  if (input === undefined || input === null) {
    return res.status(400).json({
      success: false,
      message: "Input is required.",
    });
  }

  const processInfo = runningProcesses.get(processId);

  if (!processInfo) {
    return res.status(404).json({
      success: false,
      message: "Interactive process not found.",
    });
  }

  if (processInfo.finished) {
    return res.status(400).json({
      success: false,
      message: "Process has already finished.",
    });
  }

  try {
    let value = String(input);

    if (processInfo.type === "docker") {
      const stdin = processInfo.process.stdin;

      if (
        !stdin ||
        stdin.destroyed ||
        stdin.writableEnded
      ) {
        return res.status(400).json({
          success: false,
          message: "Process stdin is unavailable.",
        });
      }

      stdin.write(value);
    } else {
      if (
        !value.endsWith("\n") &&
        !value.endsWith("\r")
      ) {
        value += "\r";
      }

      processInfo.ptyProcess.write(value);
    }

    console.log(
      `⌨ [${processId}] INPUT:`,
      JSON.stringify(value),
    );

    return res.json({
      success: true,
      message: "Input sent to process.",
    });
  } catch (error) {
    console.error(
      "❌ Interactive input error:",
      error.message,
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Could not send input.",
    });
  }
});

// =========================================================
// END INTERACTIVE INPUT
// =========================================================

app.post(
  "/api/interactive/end-input",
  (req, res) => {
    const { processId } = req.body || {};

    if (!processId) {
      return res.status(400).json({
        success: false,
        message: "processId is required.",
      });
    }

    const processInfo =
      runningProcesses.get(processId);

    if (!processInfo) {
      return res.status(404).json({
        success: false,
        message: "Interactive process not found.",
      });
    }

    try {
      if (processInfo.type === "docker") {
        const stdin =
          processInfo.process.stdin;

        if (
          stdin &&
          !stdin.destroyed &&
          !stdin.writableEnded
        ) {
          stdin.end();
        }
      }

      return res.json({
        success: true,
        message: "Input stream closed.",
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Could not close input.",
      });
    }
  },
);

// =========================================================
// GET INTERACTIVE OUTPUT
// =========================================================

app.get(
  "/api/interactive/output/:processId",
  (req, res) => {
    const { processId } = req.params;

    const processInfo =
      runningProcesses.get(processId);

    if (!processInfo) {
      return res.status(404).json({
        success: false,
        message: "Interactive process not found.",
      });
    }

    const output =
      processInfo.outputBuffer || "";

    processInfo.outputBuffer = "";

    return res.json({
      success: true,
      processId,
      output,
      finished: processInfo.finished,
      timedOut: processInfo.timedOut,
      exitCode: processInfo.exitCode,
      signal: processInfo.signal,
      language: processInfo.language,
    });
  },
);

// =========================================================
// STOP INTERACTIVE PROCESS
// =========================================================

app.post(
  "/api/interactive/stop",
  (req, res) => {
    const { processId } = req.body || {};

    if (!processId) {
      return res.status(400).json({
        success: false,
        message: "processId is required.",
      });
    }

    const processInfo =
      runningProcesses.get(processId);

    if (!processInfo) {
      return res.status(404).json({
        success: false,
        message: "Interactive process not found.",
      });
    }

    console.log(
      "⏹ Stopping process:",
      processId,
    );

    try {
      if (processInfo.type === "docker") {
        try {
          if (
            processInfo.process.stdin &&
            !processInfo.process.stdin.destroyed
          ) {
            processInfo.process.stdin.destroy();
          }
        } catch {}

        try {
          processInfo.process.kill(
            "SIGKILL",
          );
        } catch {}
      } else {
        try {
          processInfo.ptyProcess.kill();
        } catch {}
      }
    } catch (error) {
      console.error(
        "Stop process error:",
        error.message,
      );
    }

    processInfo.finished = true;

    processInfo.exitCode = 130;

    cleanupDirectory(
      processInfo.jobDirectory,
    );

    runningProcesses.delete(processId);

    return res.json({
      success: true,
      message: "Interactive process stopped.",
    });
  },
);

// =========================================================
// LIST INTERACTIVE PROCESSES
// =========================================================

app.get(
  "/api/interactive/processes",
  (req, res) => {
    const processes =
      Array.from(
        runningProcesses.values(),
      ).map((processInfo) => ({
        processId:
          processInfo.processId,
        type: processInfo.type,
        language:
          processInfo.language,
        finished:
          processInfo.finished,
        timedOut:
          processInfo.timedOut,
        exitCode:
          processInfo.exitCode,
        startedAt:
          processInfo.startedAt,
        outputLength:
          processInfo.outputBuffer.length,
      }));

    return res.json({
      success: true,
      count: processes.length,
      processes,
    });
  },
);

// =========================================================
// CLEANUP FINISHED PROCESSES
// =========================================================

setInterval(() => {
  const now = Date.now();

  for (
    const [processId, processInfo]
    of runningProcesses
  ) {
    if (!processInfo.finished) {
      continue;
    }

    const age =
      now - processInfo.startedAt;

    if (age > 60000) {
      cleanupDirectory(
        processInfo.jobDirectory,
      );

      runningProcesses.delete(
        processId,
      );

      console.log(
        "🧹 Removed finished process:",
        processId,
      );
    }
  }
}, 30000);

// =========================================================
// 404
// =========================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found.",
  });
});

// =========================================================
// GLOBAL ERROR
// =========================================================

app.use(
  (error, req, res, next) => {
    console.error(
      "❌ Global server error:",
      error,
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
  },
);

// =========================================================
// START SERVER
// =========================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "================================",
    );

    console.log(
      "🚀 CodeForge EXECUTION SERVICE",
    );

    console.log(
      "================================",
    );

    console.log(`Port: ${PORT}`);

    console.log(
      "Platform:",
      process.platform,
    );

    console.log("Languages:");

    console.log(
      "C / C++ / Java / Python / JavaScript / Go / PHP / Rust / C#",
    );

    console.log(
      "================================",
    );

    console.log(
      "Interactive execution: ENABLED ✅",
    );

    console.log(
      "PTY terminal: ENABLED ✅",
    );

    console.log(
      "Interactive stdin: ENABLED ✅",
    );

    console.log(
      "Windows executable support: ENABLED ✅",
    );

    console.log(
      "Docker Go execution: ENABLED ✅",
    );

    console.log(
      "Docker PHP execution: ENABLED ✅",
    );

    console.log(
      "Docker Rust execution: ENABLED ✅",
    );

    console.log(
      "Docker C# execution: ENABLED ✅",
    );

    console.log(
      "Interactive timeout: DISABLED ✅",
    );

    console.log(
      "Process persistence: ENABLED ✅",
    );

    console.log(
      "================================",
    );
  },
);