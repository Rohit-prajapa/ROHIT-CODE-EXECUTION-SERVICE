const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const EXECUTION_TIMEOUT = 30000;
const PROGRAM_TIMEOUT = 15000;

// ============================================================
// GO COMMAND
// ============================================================

const GO_COMMAND =
  process.platform === "win32"
    ? "go.exe"
    : "go";

// ============================================================
// CREATE TEMP GO FILE
// ============================================================

function createGoTemp(code) {
  if (
    typeof code !== "string" ||
    !code.trim()
  ) {
    throw new Error("No Go code provided.");
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "go-temp",
    `go-${id}`,
  );

  fs.mkdirSync(tempDir, {
    recursive: true,
  });

  const sourceFile = path.join(
    tempDir,
    "main.go",
  );

  fs.writeFileSync(
    sourceFile,
    code,
    "utf8",
  );

  return tempDir;
}

// ============================================================
// CLEANUP
// ============================================================

function cleanup(tempDir) {
  try {
    if (
      tempDir &&
      fs.existsSync(tempDir)
    ) {
      fs.rmSync(tempDir, {
        recursive: true,
        force: true,
      });
    }
  } catch (error) {
    console.error(
      "Go cleanup error:",
      error.message,
    );
  }
}

// ============================================================
// COMPILE GO
// ============================================================

function compileGo(
  tempDir,
  onSuccess,
  onError,
) {
  const outputName =
    process.platform === "win32"
      ? "rohit-go-main.exe"
      : "rohit-go-main";

  const compileProcess = spawn(
    GO_COMMAND,
    [
      "build",
      "-p",
      "1",
      "-o",
      outputName,
      "main.go",
    ],
    {
      cwd: tempDir,
      windowsHide: true,
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        GOCACHE: path.join(
          tempDir,
          "go-cache",
        ),
        GOMODCACHE: path.join(
          tempDir,
          "go-mod-cache",
        ),
        GOMAXPROCS: "1",
      },
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    },
  );

  let stdout = "";
  let stderr = "";
  let finished = false;

  compileProcess.stdout.on(
    "data",
    (data) => {
      stdout += data.toString();
    },
  );

  compileProcess.stderr.on(
    "data",
    (data) => {
      stderr += data.toString();
    },
  );

  compileProcess.on(
    "error",
    (error) => {
      if (finished) return;

      finished = true;

      onError(
        error.message ||
          "Could not start Go compiler.",
      );
    },
  );

  compileProcess.on(
    "close",
    (exitCode) => {
      if (finished) return;

      finished = true;

      if (exitCode !== 0) {
        onError(
          stderr ||
            stdout ||
            `Go compilation failed with exit code ${exitCode}.`,
        );

        return;
      }

      onSuccess(outputName);
    },
  );
}

// ============================================================
// START COMPILED GO PROGRAM
// ============================================================

function startGoExecutable({
  tempDir,
  executableName,
  input = "",
  interactive = false,
  onOutput = () => {},
  onExit = () => {},
  onError = () => {},
}) {
  const executablePath = path.join(
    tempDir,
    executableName,
  );

  const goProcess = spawn(
    executablePath,
    [],
    {
      cwd: tempDir,
      windowsHide: true,
      stdio: [
        "pipe",
        "pipe",
        "pipe",
      ],
    },
  );

  let finished = false;
  let stdout = "";
  let stderr = "";

  // ==========================================================
  // TIMEOUT
  // ==========================================================

  const timeout = setTimeout(() => {
    if (finished) return;

    finished = true;

    try {
      goProcess.kill("SIGKILL");
    } catch {}

    onOutput(
      "\r\n⏱ Go program timed out after 30 seconds.\r\n",
    );

    cleanup(tempDir);

    onExit(
      124,
      stdout,
      stderr,
    );
  }, EXECUTION_TIMEOUT);

  // ==========================================================
  // STDOUT
  // ==========================================================

  goProcess.stdout.on(
    "data",
    (data) => {
      if (finished) return;

      const text = data.toString();

      stdout += text;

      onOutput(text);
    },
  );

  // ==========================================================
  // STDERR
  // ==========================================================

  goProcess.stderr.on(
    "data",
    (data) => {
      if (finished) return;

      const text = data.toString();

      stderr += text;

      onOutput(text);
    },
  );

  // ==========================================================
  // PROCESS ERROR
  // ==========================================================

  goProcess.on(
    "error",
    (error) => {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);
      cleanup(tempDir);

      onError(
        error.message ||
          "Could not start Go program.",
      );
    },
  );

  // ==========================================================
  // PROCESS CLOSE
  // ==========================================================

  goProcess.on(
    "close",
    (exitCode) => {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);
      cleanup(tempDir);

      onExit(
        exitCode === null
          ? 0
          : exitCode,
        stdout,
        stderr,
      );
    },
  );

  // ==========================================================
  // NORMAL INPUT
  // ==========================================================

  if (!interactive) {
    try {
      if (
        goProcess.stdin &&
        !goProcess.stdin.destroyed &&
        !goProcess.stdin.writableEnded
      ) {
        goProcess.stdin.write(
          String(input ?? ""),
        );

        goProcess.stdin.end();
      }
    } catch (error) {
      if (!finished) {
        finished = true;

        clearTimeout(timeout);
        cleanup(tempDir);

        onError(
          `Could not send Go input: ${error.message}`,
        );
      }
    }
  }

  // ==========================================================
  // CONTROLLER
  // ==========================================================

  return {
    writeInput(input) {
      if (finished) return;

      const stdin =
        goProcess.stdin;

      if (
        !stdin ||
        stdin.destroyed ||
        stdin.writableEnded
      ) {
        return;
      }

      try {
        stdin.write(
          String(input ?? ""),
        );
      } catch (error) {
        onError(
          `Could not send Go input: ${error.message}`,
        );
      }
    },

    endInput() {
      if (finished) return;

      const stdin =
        goProcess.stdin;

      if (
        !stdin ||
        stdin.destroyed ||
        stdin.writableEnded
      ) {
        return;
      }

      try {
        stdin.end();
      } catch (error) {
        onError(
          `Could not close Go input: ${error.message}`,
        );
      }
    },

    stop() {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);

      try {
        goProcess.kill("SIGKILL");
      } catch {}

      cleanup(tempDir);
    },
  };
}

// ============================================================
// NORMAL GO EXECUTION
// ============================================================

function runGo(
  code,
  input = "",
) {
  return new Promise((resolve) => {
    let tempDir;

    try {
      tempDir = createGoTemp(code);
    } catch (error) {
      resolve({
        success: false,
        output:
          `Could not prepare Go file: ${error.message}`,
      });

      return;
    }

    compileGo(
      tempDir,

      (executableName) => {
        startGoExecutable({
          tempDir,
          executableName,
          input,
          interactive: false,

          onOutput: () => {},

          onExit: (
            exitCode,
            stdout,
            stderr,
          ) => {
            resolve({
              success:
                exitCode === 0,
              output:
                stdout ||
                stderr ||
                `Go program exited with code ${exitCode}.`,
            });
          },

          onError: (error) => {
            cleanup(tempDir);

            resolve({
              success: false,
              output: String(error),
            });
          },
        });
      },

      (error) => {
        cleanup(tempDir);

        resolve({
          success: false,
          output:
            `Go compilation error:\n${error}`,
        });
      },
    );
  });
}

// ============================================================
// INTERACTIVE GO
// ============================================================

function startGoInteractive(
  code,
  handlers = {},
) {
  const {
    onOutput = () => {},
    onExit = () => {},
    onError = () => {},
  } = handlers;

  let tempDir;

  try {
    tempDir = createGoTemp(code);
  } catch (error) {
    onError(
      `Could not prepare Go file: ${error.message}`,
    );

    return null;
  }

  let controller = null;

  compileGo(
    tempDir,

    (executableName) => {
      controller =
        startGoExecutable({
          tempDir,
          executableName,
          interactive: true,
          onOutput,
          onExit,
          onError,
        });
    },

    (error) => {
      cleanup(tempDir);

      onError(
        `Go compilation error:\n${error}`,
      );
    },
  );

  return {
    writeInput(input) {
      if (controller) {
        controller.writeInput(input);
      }
    },

    endInput() {
      if (controller) {
        controller.endInput();
      }
    },

    stop() {
      if (controller) {
        controller.stop();
      } else {
        cleanup(tempDir);
      }
    },
  };
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  startGoInteractive,
  runGo,
};