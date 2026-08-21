const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const EXECUTION_TIMEOUT = 10000;

// ============================================================
// PHP COMMAND
// ============================================================

const PHP_COMMAND =
  process.platform === "win32"
    ? "php.exe"
    : "php";

// ============================================================
// CREATE TEMP PHP FILE
// ============================================================

function createPhpTemp(code) {
  if (
    typeof code !== "string" ||
    !code.trim()
  ) {
    throw new Error("No PHP code provided.");
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "php-temp",
    `php-${id}`,
  );

  fs.mkdirSync(tempDir, {
    recursive: true,
  });

  const sourceFile = path.join(
    tempDir,
    "main.php",
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
      "PHP cleanup error:",
      error.message,
    );
  }
}

// ============================================================
// START PHP PROCESS
// ============================================================

function startPhpProcess({
  tempDir,
  input = "",
  interactive = false,
  onOutput = () => {},
  onExit = () => {},
  onError = () => {},
}) {
  const phpProcess = spawn(
    PHP_COMMAND,
    [
      "-d",
      "display_errors=1",
      "-d",
      "display_startup_errors=1",
      "main.php",
    ],
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
      phpProcess.kill("SIGKILL");
    } catch {}

    onOutput(
      "\r\n⏱ PHP program timed out after 10 seconds.\r\n",
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

  phpProcess.stdout.on(
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

  phpProcess.stderr.on(
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

  phpProcess.on(
    "error",
    (error) => {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);
      cleanup(tempDir);

      onError(
        error.message ||
          "Could not start PHP.",
      );
    },
  );

  // ==========================================================
  // PROCESS CLOSE
  // ==========================================================

  phpProcess.on(
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
  // NORMAL EXECUTION INPUT
  // ==========================================================

  if (!interactive) {
    try {
      if (
        phpProcess.stdin &&
        !phpProcess.stdin.destroyed &&
        !phpProcess.stdin.writableEnded
      ) {
        phpProcess.stdin.write(
          String(input ?? ""),
        );

        phpProcess.stdin.end();
      }
    } catch (error) {
      if (!finished) {
        finished = true;

        clearTimeout(timeout);
        cleanup(tempDir);

        onError(
          `Could not send PHP input: ${error.message}`,
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

      if (
        !phpProcess.stdin ||
        phpProcess.stdin.destroyed ||
        phpProcess.stdin.writableEnded
      ) {
        return;
      }

      try {
        phpProcess.stdin.write(
          String(input),
        );
      } catch (error) {
        onError(
          `Could not send PHP input: ${error.message}`,
        );
      }
    },

    endInput() {
      if (finished) return;

      if (
        !phpProcess.stdin ||
        phpProcess.stdin.destroyed ||
        phpProcess.stdin.writableEnded
      ) {
        return;
      }

      try {
        phpProcess.stdin.end();
      } catch (error) {
        onError(
          `Could not close PHP input: ${error.message}`,
        );
      }
    },

    stop() {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);

      try {
        phpProcess.kill("SIGKILL");
      } catch {}

      cleanup(tempDir);
    },
  };
}

// ============================================================
// NORMAL PHP EXECUTION
// ============================================================

function runPhp(
  code,
  input = "",
) {
  return new Promise((resolve) => {
    let tempDir;

    try {
      tempDir = createPhpTemp(code);
    } catch (error) {
      resolve({
        success: false,
        output:
          `Could not prepare PHP file: ${error.message}`,
      });

      return;
    }

    startPhpProcess({
      tempDir,
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
            `PHP program exited with code ${exitCode}.`,
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
  });
}

// ============================================================
// INTERACTIVE PHP
// ============================================================

function startPhpInteractive(
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
    tempDir = createPhpTemp(code);
  } catch (error) {
    onError(
      `Could not prepare PHP file: ${error.message}`,
    );

    return null;
  }

  return startPhpProcess({
    tempDir,
    interactive: true,
    onOutput,
    onExit,
    onError,
  });
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  startPhpInteractive,
  runPhp,
};