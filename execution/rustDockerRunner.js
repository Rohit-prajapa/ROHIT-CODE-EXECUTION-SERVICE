const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const EXECUTION_TIMEOUT = 10000;

// ============================================================
// RUST COMMAND
// ============================================================

const RUST_COMMAND =
  process.platform === "win32"
    ? "rustc.exe"
    : "rustc";

// ============================================================
// CREATE TEMP RUST FILE
// ============================================================

function createRustTemp(code) {
  if (
    typeof code !== "string" ||
    !code.trim()
  ) {
    throw new Error("No Rust code provided.");
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "rust-temp",
    `rust-${id}`,
  );

  fs.mkdirSync(tempDir, {
    recursive: true,
  });

  const sourceFile = path.join(
    tempDir,
    "main.rs",
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
      "Rust cleanup error:",
      error.message,
    );
  }
}

// ============================================================
// COMPILE RUST
// ============================================================

function compileRust(
  tempDir,
  onSuccess,
  onError,
) {
  const executableName =
    process.platform === "win32"
      ? "rohit-rust-main.exe"
      : "rohit-rust-main";

  const compileProcess = spawn(
    RUST_COMMAND,
    [
      "main.rs",
      "-O",
      "-o",
      executableName,
    ],
    {
      cwd: tempDir,
      windowsHide: true,
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
          "Could not start Rust compiler.",
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
            `Rust compilation failed with exit code ${exitCode}.`,
        );

        return;
      }

      onSuccess(executableName);
    },
  );
}

// ============================================================
// START RUST EXECUTABLE
// ============================================================

function startRustExecutable({
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

  const rustProcess = spawn(
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
      rustProcess.kill("SIGKILL");
    } catch {}

    onOutput(
      "\r\n⏱ Rust program timed out after 10 seconds.\r\n",
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

  rustProcess.stdout.on(
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

  rustProcess.stderr.on(
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

  rustProcess.on(
    "error",
    (error) => {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);
      cleanup(tempDir);

      onError(
        error.message ||
          "Could not start Rust program.",
      );
    },
  );

  // ==========================================================
  // PROCESS CLOSE
  // ==========================================================

  rustProcess.on(
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
        rustProcess.stdin &&
        !rustProcess.stdin.destroyed &&
        !rustProcess.stdin.writableEnded
      ) {
        rustProcess.stdin.write(
          String(input ?? ""),
        );

        rustProcess.stdin.end();
      }
    } catch (error) {
      if (!finished) {
        finished = true;

        clearTimeout(timeout);
        cleanup(tempDir);

        onError(
          `Could not send Rust input: ${error.message}`,
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
        rustProcess.stdin;

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
          `Could not send Rust input: ${error.message}`,
        );
      }
    },

    endInput() {
      if (finished) return;

      const stdin =
        rustProcess.stdin;

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
          `Could not close Rust input: ${error.message}`,
        );
      }
    },

    stop() {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);

      try {
        rustProcess.kill("SIGKILL");
      } catch {}

      cleanup(tempDir);
    },
  };
}

// ============================================================
// NORMAL RUST EXECUTION
// ============================================================

function runRust(
  code,
  input = "",
) {
  return new Promise((resolve) => {
    let tempDir;

    try {
      tempDir = createRustTemp(code);
    } catch (error) {
      resolve({
        success: false,
        output:
          `Could not prepare Rust file: ${error.message}`,
      });

      return;
    }

    compileRust(
      tempDir,

      (executableName) => {
        startRustExecutable({
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
              success: exitCode === 0,
              output:
                stdout ||
                stderr ||
                `Rust program exited with code ${exitCode}.`,
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
            `Rust compilation error:\n${error}`,
        });
      },
    );
  });
}

// ============================================================
// INTERACTIVE RUST
// ============================================================

function startRustInteractive(
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
    tempDir = createRustTemp(code);
  } catch (error) {
    onError(
      `Could not prepare Rust file: ${error.message}`,
    );

    return null;
  }

  let controller = null;

  compileRust(
    tempDir,

    (executableName) => {
      controller =
        startRustExecutable({
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
        `Rust compilation error:\n${error}`,
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
  runRust,
  runRustDocker: runRust,
  startRustInteractive,
};