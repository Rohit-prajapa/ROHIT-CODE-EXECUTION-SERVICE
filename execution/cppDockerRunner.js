const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const EXECUTION_TIMEOUT = 10000;

// ============================================================
// C++ COMMAND
// ============================================================

const CPP_COMMAND =
  process.platform === "win32"
    ? "g++"
    : "g++";

// ============================================================
// CREATE TEMP C++ FILE
// ============================================================

function createCppTemp(code) {
  if (
    typeof code !== "string" ||
    !code.trim()
  ) {
    throw new Error("No C++ code provided.");
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "cpp-temp",
    `cpp-${id}`,
  );

  fs.mkdirSync(tempDir, {
    recursive: true,
  });

  const sourceFile = path.join(
    tempDir,
    "main.cpp",
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
      "C++ cleanup error:",
      error.message,
    );
  }
}

// ============================================================
// START C++ PROCESS
// ============================================================

function startCppProcess({
  tempDir,
  input = "",
  interactive = false,
  onOutput = () => {},
  onExit = () => {},
  onError = () => {},
}) {
  const executableName =
    process.platform === "win32"
      ? "main.exe"
      : "./main";

  const compileCommand =
    process.platform === "win32"
      ? "g++ main.cpp -std=c++17 -O2 -o main.exe"
      : "g++ main.cpp -std=c++17 -O2 -o main";

  const runCommand =
    process.platform === "win32"
      ? "main.exe"
      : "./main";

  // ==========================================================
  // COMPILE FIRST
  // ==========================================================

  const compileProcess = spawn(
    CPP_COMMAND,
    [
      "main.cpp",
      "-std=c++17",
      "-O2",
      "-o",
      executableName,
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

  let compileStdout = "";
  let compileStderr = "";
  let compileFinished = false;

  compileProcess.stdout.on(
    "data",
    (data) => {
      compileStdout += data.toString();
    },
  );

  compileProcess.stderr.on(
    "data",
    (data) => {
      compileStderr += data.toString();
    },
  );

  compileProcess.on(
    "error",
    (error) => {
      if (compileFinished) return;

      compileFinished = true;

      cleanup(tempDir);

      onError(
        error.message ||
          "Could not start C++ compiler.",
      );
    },
  );

  compileProcess.on(
    "close",
    (exitCode) => {
      if (compileFinished) return;

      compileFinished = true;

      // ======================================================
      // COMPILATION FAILED
      // ======================================================

      if (exitCode !== 0) {
        cleanup(tempDir);

        onOutput(
          compileStderr ||
            compileStdout ||
            "C++ compilation failed.",
        );

        onExit(
          exitCode,
          "",
          compileStderr,
        );

        return;
      }

      // ======================================================
      // COMPILATION SUCCESSFUL
      // ======================================================

      startCppExecutable({
        tempDir,
        runCommand,
        input,
        interactive,
        onOutput,
        onExit,
        onError,
      });
    },
  );
}

// ============================================================
// START COMPILED C++ PROGRAM
// ============================================================

function startCppExecutable({
  tempDir,
  runCommand,
  input = "",
  interactive = false,
  onOutput = () => {},
  onExit = () => {},
  onError = () => {},
}) {
  const cppProcess = spawn(
    runCommand,
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
      cppProcess.kill("SIGKILL");
    } catch {}

    onOutput(
      "\r\n⏱ C++ program timed out after 10 seconds.\r\n",
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

  cppProcess.stdout.on(
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

  cppProcess.stderr.on(
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

  cppProcess.on(
    "error",
    (error) => {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);
      cleanup(tempDir);

      onError(
        error.message ||
          "Could not start C++ program.",
      );
    },
  );

  // ==========================================================
  // PROCESS CLOSE
  // ==========================================================

  cppProcess.on(
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
        cppProcess.stdin &&
        !cppProcess.stdin.destroyed
      ) {
        cppProcess.stdin.write(
          String(input ?? ""),
        );

        cppProcess.stdin.end();
      }
    } catch (error) {
      if (!finished) {
        finished = true;

        clearTimeout(timeout);
        cleanup(tempDir);

        onError(
          `Could not send C++ input: ${error.message}`,
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
        !cppProcess.stdin ||
        cppProcess.stdin.destroyed ||
        cppProcess.stdin.writableEnded
      ) {
        return;
      }

      try {
        cppProcess.stdin.write(
          String(input),
        );
      } catch (error) {
        onError(
          `Could not send C++ input: ${error.message}`,
        );
      }
    },

    stop() {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);

      try {
        cppProcess.kill("SIGKILL");
      } catch {}

      cleanup(tempDir);
    },
  };
}

// ============================================================
// NORMAL C++ EXECUTION
// ============================================================

function runCppNormal(
  code,
  input = "",
) {
  return new Promise((resolve) => {
    let tempDir;

    try {
      tempDir = createCppTemp(code);
    } catch (error) {
      resolve({
        success: false,
        output:
          `Could not prepare C++ file: ${error.message}`,
      });

      return;
    }

    startCppProcess({
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
            `C++ program exited with code ${exitCode}.`,
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
// INTERACTIVE C++ EXECUTION
// ============================================================

function startCppInteractive(
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
    tempDir = createCppTemp(code);
  } catch (error) {
    onError(
      `Could not prepare C++ file: ${error.message}`,
    );

    return null;
  }

  return startCppProcess({
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
  runCppNormal,
  startCppInteractive,
};