const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const PYTHON_IMAGE = "python:3.12-slim";
const EXECUTION_TIMEOUT = 10000;

// =========================================
// NORMAL PYTHON EXECUTION
// =========================================

function runPython(code, input = "") {
  return new Promise((resolve) => {
    if (
      typeof code !== "string" ||
      !code.trim()
    ) {
      resolve({
        success: false,
        output: "No Python code provided.",
      });
      return;
    }

    const id = uuidv4();

    const tempDir = path.join(
      __dirname,
      "docker-temp",
      `python-normal-${id}`,
    );

    const sourceFile = path.join(
      tempDir,
      "main.py",
    );

    try {
      fs.mkdirSync(tempDir, {
        recursive: true,
      });

      fs.writeFileSync(
        sourceFile,
        code,
        "utf8",
      );
    } catch (error) {
      cleanup(tempDir);

      resolve({
        success: false,
        output:
          `Could not prepare Python file: ${error.message}`,
      });

      return;
    }

    const dockerArgs = [
      "run",
      "--rm",
      "-i",

      "--memory=256m",
      "--cpus=0.5",
      "--pids-limit=50",

      "--network=none",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",

      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=32m",

      "-v",
      `${tempDir}:/code:rw`,

      "-w",
      "/code",

      PYTHON_IMAGE,

      "python3",
      "-u",
      "main.py",
    ];

    const pythonProcess = spawn(
      "docker",
      dockerArgs,
      {
        windowsHide: true,
        stdio: [
          "pipe",
          "pipe",
          "pipe",
        ],
      },
    );

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) return;

      finished = true;

      try {
        pythonProcess.kill("SIGKILL");
      } catch {}

      cleanup(tempDir);

      resolve({
        success: false,
        output:
          "⏱ Python program timed out after 10 seconds.",
      });
    }, EXECUTION_TIMEOUT);

    pythonProcess.stdout.on(
      "data",
      (data) => {
        stdout += data.toString();
      },
    );

    pythonProcess.stderr.on(
      "data",
      (data) => {
        stderr += data.toString();
      },
    );

    pythonProcess.on(
      "error",
      (error) => {
        if (finished) return;

        finished = true;

        clearTimeout(timeout);
        cleanup(tempDir);

        resolve({
          success: false,
          output:
            error.message ||
            "Could not start Docker.",
        });
      },
    );

    pythonProcess.on(
      "close",
      (exitCode) => {
        if (finished) return;

        finished = true;

        clearTimeout(timeout);
        cleanup(tempDir);

        if (exitCode === 0) {
          resolve({
            success: true,
            output:
              stdout ||
              "Program finished with no output.",
          });
        } else {
          resolve({
            success: false,
            output:
              stderr ||
              stdout ||
              `Python program exited with code ${exitCode}.`,
          });
        }
      },
    );

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
      if (finished) return;

      finished = true;

      clearTimeout(timeout);
      cleanup(tempDir);

      resolve({
        success: false,
        output:
          `Could not send input: ${error.message}`,
      });
    }
  });
}

// =========================================
// INTERACTIVE PYTHON EXECUTION
// =========================================

function startPythonInteractive(
  code,
  handlers = {},
) {
  const {
    onOutput = () => {},
    onExit = () => {},
    onError = () => {},
  } = handlers;

  if (
    typeof code !== "string" ||
    !code.trim()
  ) {
    onError("No Python code provided.");
    return null;
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "docker-temp",
    `python-interactive-${id}`,
  );

  const sourceFile = path.join(
    tempDir,
    "main.py",
  );

  // =========================================
  // PREPARE SOURCE
  // =========================================

  try {
    fs.mkdirSync(tempDir, {
      recursive: true,
    });

    fs.writeFileSync(
      sourceFile,
      code,
      "utf8",
    );
  } catch (error) {
    cleanup(tempDir);

    onError(
      `Could not prepare Python file: ${error.message}`,
    );

    return null;
  }

  // =========================================
  // DOCKER
  // =========================================

  const dockerArgs = [
    "run",
    "--rm",
    "-i",

    // Resource limits
    "--memory=256m",
    "--cpus=0.5",
    "--pids-limit=50",

    // Security
    "--network=none",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",

    // Temporary filesystem
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=32m",

    // Source
    "-v",
    `${tempDir}:/code:rw`,

    // Working directory
    "-w",
    "/code",

    // Python image
    PYTHON_IMAGE,

    // Unbuffered output
    "python3",
    "-u",
    "main.py",
  ];

  const pythonProcess = spawn(
    "docker",
    dockerArgs,
    {
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

  // =========================================
  // TIMEOUT
  // =========================================

  const timeout = setTimeout(() => {
    if (finished) return;

    finished = true;

    try {
      pythonProcess.kill("SIGKILL");
    } catch {}

    cleanup(tempDir);

    onOutput(
      "\r\n⏱ Program timed out after 10 seconds.\r\n",
    );

    onExit(
      124,
      stdout,
      stderr,
    );
  }, EXECUTION_TIMEOUT);

  // =========================================
  // STDOUT
  // =========================================

  pythonProcess.stdout.on(
    "data",
    (data) => {
      if (finished) return;

      const text = data.toString();

      stdout += text;

      onOutput(text);
    },
  );

  // =========================================
  // STDERR
  // =========================================

  pythonProcess.stderr.on(
    "data",
    (data) => {
      if (finished) return;

      const text = data.toString();

      stderr += text;

      onOutput(text);
    },
  );

  // =========================================
  // PROCESS ERROR
  // =========================================

  pythonProcess.on(
    "error",
    (error) => {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);
      cleanup(tempDir);

      onError(
        error.message ||
          "Could not start Docker.",
      );
    },
  );

  // =========================================
  // PROCESS CLOSE
  // =========================================

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

  // =========================================
  // CONTROLLER
  // =========================================

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
          `Could not send input: ${error.message}`,
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

// =========================================
// CLEANUP
// =========================================

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
      "Python Docker cleanup error:",
      error.message,
    );
  }
}

// =========================================
// EXPORT
// =========================================

module.exports = {
  runPython,
  startPythonInteractive,
};