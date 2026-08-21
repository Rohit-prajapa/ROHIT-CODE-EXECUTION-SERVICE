const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const EXECUTION_TIMEOUT = 10000;

// ============================================================
// PLATFORM COMMANDS
// ============================================================

const JAVAC_COMMAND =
  process.platform === "win32"
    ? "javac.exe"
    : "javac";

const JAVA_COMMAND =
  process.platform === "win32"
    ? "java.exe"
    : "java";

// ============================================================
// CREATE TEMP JAVA FILE
// ============================================================

function createJavaTemp(code) {
  if (
    typeof code !== "string" ||
    !code.trim()
  ) {
    throw new Error("No Java code provided.");
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "java-temp",
    `java-${id}`,
  );

  fs.mkdirSync(tempDir, {
    recursive: true,
  });

  const sourceFile = path.join(
    tempDir,
    "Main.java",
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
      "Java cleanup error:",
      error.message,
    );
  }
}

// ============================================================
// COMPILE JAVA
// ============================================================

function compileJava(
  tempDir,
  onSuccess,
  onError,
) {
  const compileProcess = spawn(
    JAVAC_COMMAND,
    [
      "-encoding",
      "UTF-8",
      "Main.java",
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
      onError(
        error.message ||
          "Could not start javac.",
      );
    },
  );

  compileProcess.on(
    "close",
    (exitCode) => {
      if (exitCode === 0) {
        onSuccess();
        return;
      }

      onError(
        stderr ||
          stdout ||
          `Java compilation failed with exit code ${exitCode}.`,
      );
    },
  );
}

// ============================================================
// START JAVA PROCESS
// ============================================================

function startJavaProcess({
  tempDir,
  input = "",
  interactive = false,
  onOutput = () => {},
  onExit = () => {},
  onError = () => {},
}) {
  const javaProcess = spawn(
    JAVA_COMMAND,
    [
      "-Dfile.encoding=UTF-8",
      "Main",
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

  const timeout = setTimeout(() => {
    if (finished) return;

    finished = true;

    try {
      javaProcess.kill("SIGKILL");
    } catch {}

    onOutput(
      "\r\n⏱ Java program timed out after 10 seconds.\r\n",
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

  javaProcess.stdout.on(
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

  javaProcess.stderr.on(
    "data",
    (data) => {
      if (finished) return;

      const text = data.toString();

      stderr += text;

      onOutput(text);
    },
  );

  // ==========================================================
  // ERROR
  // ==========================================================

  javaProcess.on(
    "error",
    (error) => {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);
      cleanup(tempDir);

      onError(
        error.message ||
          "Could not start Java.",
      );
    },
  );

  // ==========================================================
  // CLOSE
  // ==========================================================

  javaProcess.on(
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
        javaProcess.stdin &&
        !javaProcess.stdin.destroyed
      ) {
        javaProcess.stdin.write(
          String(input ?? ""),
        );

        javaProcess.stdin.end();
      }
    } catch (error) {
      if (!finished) {
        finished = true;

        clearTimeout(timeout);
        cleanup(tempDir);

        onError(
          `Could not send Java input: ${error.message}`,
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
        !javaProcess.stdin ||
        javaProcess.stdin.destroyed ||
        javaProcess.stdin.writableEnded
      ) {
        return;
      }

      try {
        javaProcess.stdin.write(
          String(input),
        );
      } catch (error) {
        onError(
          `Could not send Java input: ${error.message}`,
        );
      }
    },

    stop() {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);

      try {
        javaProcess.kill("SIGKILL");
      } catch {}

      cleanup(tempDir);
    },
  };
}

// ============================================================
// INTERACTIVE JAVA
// ============================================================

function startJavaInteractive(
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
    tempDir = createJavaTemp(code);
  } catch (error) {
    onError(
      `Could not prepare Java file: ${error.message}`,
    );

    return null;
  }

  // ==========================================================
  // COMPILE FIRST
  // ==========================================================

  let controller = null;

  compileJava(
    tempDir,
    () => {
      controller = startJavaProcess({
        tempDir,
        interactive: true,
        onOutput,
        onExit,
        onError,
      });
    },
    (error) => {
      cleanup(tempDir);

      onError(
        `Java compilation error:\n${error}`,
      );
    },
  );

  // ==========================================================
  // CONTROLLER
  // ==========================================================

  return {
    writeInput(input) {
      if (controller) {
        controller.writeInput(input);
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
// NORMAL JAVA
// ============================================================

function runJava(
  code,
  input = "",
) {
  return new Promise((resolve) => {
    let tempDir;

    try {
      tempDir = createJavaTemp(code);
    } catch (error) {
      resolve({
        success: false,
        output:
          `Could not prepare Java file: ${error.message}`,
      });

      return;
    }

    compileJava(
      tempDir,
      () => {
        startJavaProcess({
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
                `Java program exited with code ${exitCode}.`,
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
            `Java compilation error:\n${error}`,
        });
      },
    );
  });
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  startJavaInteractive,
  runJava,
};