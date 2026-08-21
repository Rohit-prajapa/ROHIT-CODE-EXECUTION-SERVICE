const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const EXECUTION_TIMEOUT = 10000;

// ============================================================
// PYTHON COMMAND
// ============================================================

const PYTHON_COMMAND =
  process.platform === "win32"
    ? "python.exe"
    : "python3";

// ============================================================
// CREATE TEMP PYTHON FILE
// ============================================================

function createPythonTemp(code) {
  if (
    typeof code !== "string" ||
    !code.trim()
  ) {
    throw new Error("No Python code provided.");
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "python-temp",
    `python-${id}`,
  );

  fs.mkdirSync(tempDir, {
    recursive: true,
  });

  const sourceFile = path.join(
    tempDir,
    "main.py",
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
      "Python cleanup error:",
      error.message,
    );
  }
}

// ============================================================
// START PYTHON PROCESS
// ============================================================

function startPythonProcess({
  tempDir,
  input = "",
  interactive = false,
  onOutput = () => {},
  onExit = () => {},
  onError = () => {},
}) {
  const pythonProcess = spawn(
    PYTHON_COMMAND,
    [
      "-u",
      "main.py",
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
      pythonProcess.kill("SIGKILL");
    } catch {}

    onOutput(
      "\r\n⏱ Python program timed out after 10 seconds.\r\n",
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

  pythonProcess.stdout.on(
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

  pythonProcess.stderr.on(
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

  pythonProcess.on(
    "error",
    (error) => {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);
      cleanup(tempDir);

      onError(
        error.message ||
          "Could not start Python.",
      );
    },
  );

  // ==========================================================
  // PROCESS CLOSE
  // ==========================================================

  pythonProcess.on(
    "close",
    (exitCode) => {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);
      cleanup(tempDir);

      onExit(
        exitCode,
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
        pythonProcess.stdin &&
        !pythonProcess.stdin.destroyed
      ) {
        pythonProcess.stdin.write(
          String(input ?? ""),
        );

        pythonProcess.stdin.end();
      }
    } catch (error) {
      if (!finished) {
        finished = true;

        clearTimeout(timeout);
        cleanup(tempDir);

        onError(
          `Could not send Python input: ${error.message}`,
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
        !pythonProcess.stdin ||
        pythonProcess.stdin.destroyed ||
        pythonProcess.stdin.writableEnded
      ) {
        return;
      }

      try {
        pythonProcess.stdin.write(
          String(input),
        );
      } catch (error) {
        onError(
          `Could not send Python input: ${error.message}`,
        );
      }
    },

    stop() {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);

      try {
        pythonProcess.kill("SIGKILL");
      } catch {}

      cleanup(tempDir);
    },
  };
}

// ============================================================
// NORMAL PYTHON EXECUTION
// ============================================================

function runPython(
  code,
  input = "",
) {
  return new Promise((resolve) => {
    let tempDir;

    try {
      tempDir = createPythonTemp(code);
    } catch (error) {
      resolve({
        success: false,
        output:
          `Could not prepare Python file: ${error.message}`,
      });

      return;
    }

    startPythonProcess({
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
            `Python program exited with code ${exitCode}.`,
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
// INTERACTIVE PYTHON
// ============================================================

function startPythonInteractive(
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
    tempDir = createPythonTemp(code);
  } catch (error) {
    onError(
      `Could not prepare Python file: ${error.message}`,
    );

    return null;
  }

  return startPythonProcess({
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
  runPython,
  startPythonInteractive,
};