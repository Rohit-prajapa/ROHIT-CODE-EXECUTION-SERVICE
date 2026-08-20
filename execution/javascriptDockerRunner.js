const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const JAVASCRIPT_IMAGE = "node:24-alpine";
const EXECUTION_TIMEOUT = 10000;

// =========================================
// INTERACTIVE JAVASCRIPT
// =========================================

function startJavaScriptInteractive(code, handlers = {}) {
  const {
    onOutput = () => {},
    onExit = () => {},
    onError = () => {},
  } = handlers;

  return createJavaScriptProcess({
    code,
    input: "",
    interactive: true,
    onOutput,
    onExit,
    onError,
  });
}

// =========================================
// NORMAL JAVASCRIPT
// =========================================

function runJavaScript(code, input = "") {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let resolved = false;

    const resolveOnce = (result) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const controller = createJavaScriptProcess({
      code,
      input,
      interactive: false,

      onOutput: (data) => {
        stdout += String(data);
      },

      onExit: (exitCode) => {
        resolveOnce({
          success: exitCode === 0,
          output:
            stdout ||
            stderr ||
            `Process exited with code ${exitCode}.`,
        });
      },

      onError: (error) => {
        resolveOnce({
          success: false,
          output: String(error),
        });
      },
    });

    if (!controller) {
      resolveOnce({
        success: false,
        output: "Could not start JavaScript process.",
      });
    }
  });
}

// =========================================
// CREATE JAVASCRIPT PROCESS
// =========================================

function createJavaScriptProcess({
  code,
  input = "",
  interactive = true,
  onOutput = () => {},
  onExit = () => {},
  onError = () => {},
}) {
  if (typeof code !== "string" || !code.trim()) {
    onError("No JavaScript code provided.");
    return null;
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "docker-temp",
    `javascript-${id}`
  );

  const sourceFile = path.join(
    tempDir,
    "main.js"
  );

  // =========================================
  // PREPARE SOURCE FILE
  // =========================================

  try {
    fs.mkdirSync(tempDir, {
      recursive: true,
    });

    fs.writeFileSync(
      sourceFile,
      code,
      "utf8"
    );
  } catch (error) {
    cleanup(tempDir);

    onError(
      `Could not prepare JavaScript file: ${error.message}`
    );

    return null;
  }

  // =========================================
  // DOCKER COMMAND
  // =========================================

  const dockerArgs = [
    "run",
    "--rm",

    // Keep stdin open for interactive programs.
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

    // Source directory
    "-v",
    `${tempDir}:/code:rw`,

    // Working directory
    "-w",
    "/code",

    // Image
    JAVASCRIPT_IMAGE,

    // Execute JavaScript
    "node",
    "main.js",
  ];

  const jsProcess = spawn(
    "docker",
    dockerArgs,
    {
      windowsHide: true,

      stdio: [
        "pipe",
        "pipe",
        "pipe",
      ],
    }
  );

  let finished = false;
  let stdout = "";
  let stderr = "";

  // =========================================
  // FINISH HELPER
  // =========================================

  const finish = (
    exitCode,
    callExit = true
  ) => {
    if (finished) return;

    finished = true;

    clearTimeout(timeout);

    cleanup(tempDir);

    if (callExit) {
      onExit(
        typeof exitCode === "number"
          ? exitCode
          : 0,
        stdout,
        stderr
      );
    }
  };

  // =========================================
  // TIMEOUT
  // =========================================

  const timeout = setTimeout(() => {
    if (finished) return;

    console.log(
      "⏱ JavaScript execution timeout."
    );

    try {
      if (
        jsProcess.stdin &&
        !jsProcess.stdin.destroyed
      ) {
        jsProcess.stdin.destroy();
      }
    } catch {}

    try {
      jsProcess.kill("SIGKILL");
    } catch {}

    cleanup(tempDir);

    finished = true;

    onOutput(
      "\r\n⏱ Program timed out after 10 seconds.\r\n"
    );

    onExit(
      124,
      stdout,
      stderr
    );
  }, EXECUTION_TIMEOUT);

  // =========================================
  // STDOUT
  // =========================================

  jsProcess.stdout.on(
    "data",
    (data) => {
      if (finished) return;

      const text = data.toString();

      stdout += text;

      onOutput(text);
    }
  );

  // =========================================
  // STDERR
  // =========================================

  jsProcess.stderr.on(
    "data",
    (data) => {
      if (finished) return;

      const text = data.toString();

      stderr += text;

      onOutput(text);
    }
  );

  // =========================================
  // DOCKER PROCESS ERROR
  // =========================================

  jsProcess.on(
    "error",
    (error) => {
      if (finished) return;

      clearTimeout(timeout);

      cleanup(tempDir);

      finished = true;

      onError(
        error.message ||
          "Could not start Docker."
      );
    }
  );

  // =========================================
  // DOCKER PROCESS CLOSE
  // =========================================

  jsProcess.on(
    "close",
    (exitCode) => {
      if (finished) return;

      finish(
        exitCode === null
          ? 0
          : exitCode
      );
    }
  );

  // =========================================
  // DOCKER PROCESS EXIT
  // =========================================

  jsProcess.on(
    "exit",
    (exitCode) => {
      if (finished) return;

      /*
       * Docker should normally emit "close"
       * after all stdout/stderr streams finish.
       *
       * Give close event priority.
       */
      setImmediate(() => {
        if (finished) return;

        finish(
          exitCode === null
            ? 0
            : exitCode
        );
      });
    }
  );

  // =========================================
  // NORMAL MODE INPUT
  // =========================================

  if (!interactive) {
    const programInput =
      typeof input === "string"
        ? input
        : String(input ?? "");

    try {
      if (
        jsProcess.stdin &&
        !jsProcess.stdin.destroyed
      ) {
        jsProcess.stdin.write(
          programInput
        );

        jsProcess.stdin.end();
      }
    } catch (error) {
      onError(
        `Could not send input: ${error.message}`
      );
    }
  }

  // =========================================
  // INTERACTIVE CONTROLLER
  // =========================================

  return {
    writeInput(input) {
      if (finished) return;

      if (
        !jsProcess.stdin ||
        jsProcess.stdin.destroyed ||
        jsProcess.stdin.writableEnded
      ) {
        return;
      }

      try {
        jsProcess.stdin.write(
          String(input)
        );
      } catch (error) {
        onError(
          `Could not send input: ${error.message}`
        );
      }
    },

    stop() {
      if (finished) return;

      clearTimeout(timeout);

      try {
        if (
          jsProcess.stdin &&
          !jsProcess.stdin.destroyed
        ) {
          jsProcess.stdin.destroy();
        }
      } catch {}

      try {
        jsProcess.kill("SIGKILL");
      } catch {}

      cleanup(tempDir);

      finished = true;
    },
  };
}

// =========================================
// CLEANUP
// =========================================

function cleanup(tempDir) {
  try {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, {
        recursive: true,
        force: true,
      });
    }
  } catch (error) {
    console.error(
      "JavaScript Docker cleanup error:",
      error.message
    );
  }
}

// =========================================
// EXPORT
// =========================================

module.exports = {
  startJavaScriptInteractive,
  runJavaScript,
};