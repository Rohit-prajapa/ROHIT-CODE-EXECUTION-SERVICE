const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const JAVASCRIPT_IMAGE = "node:24-alpine";
const EXECUTION_TIMEOUT = 10000;

// =========================================
// NORMAL JAVASCRIPT EXECUTION
// =========================================

function runJavaScript(code, input = "") {
  return new Promise((resolve) => {
    if (
      typeof code !== "string" ||
      !code.trim()
    ) {
      resolve({
        success: false,
        output: "No JavaScript code provided.",
      });
      return;
    }

    const id = uuidv4();

    const tempDir = path.join(
      __dirname,
      "docker-temp",
      `javascript-${id}`,
    );

    const sourceFile = path.join(
      tempDir,
      "main.js",
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
          `Could not prepare JavaScript file: ${error.message}`,
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

      JAVASCRIPT_IMAGE,

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
      },
    );

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) return;

      finished = true;

      try {
        jsProcess.kill("SIGKILL");
      } catch {}

      cleanup(tempDir);

      resolve({
        success: false,
        output:
          "⏱ JavaScript program timed out after 10 seconds.",
      });
    }, EXECUTION_TIMEOUT);

    jsProcess.stdout.on(
      "data",
      (data) => {
        stdout += data.toString();
      },
    );

    jsProcess.stderr.on(
      "data",
      (data) => {
        stderr += data.toString();
      },
    );

    jsProcess.on(
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

    jsProcess.on(
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
              `JavaScript program exited with code ${exitCode}.`,
          });
        }
      },
    );

    try {
      if (
        jsProcess.stdin &&
        !jsProcess.stdin.destroyed
      ) {
        jsProcess.stdin.write(
          String(input ?? ""),
        );

        jsProcess.stdin.end();
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
// INTERACTIVE JAVASCRIPT
// =========================================

function startJavaScriptInteractive(
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
    onError("No JavaScript code provided.");
    return null;
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "docker-temp",
    `javascript-interactive-${id}`,
  );

  const sourceFile = path.join(
    tempDir,
    "main.js",
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

    onError(
      `Could not prepare JavaScript file: ${error.message}`,
    );

    return null;
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

    JAVASCRIPT_IMAGE,

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
    },
  );

  let finished = false;
  let stdout = "";
  let stderr = "";

  const timeout = setTimeout(() => {
    if (finished) return;

    finished = true;

    try {
      jsProcess.kill("SIGKILL");
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

  jsProcess.stdout.on(
    "data",
    (data) => {
      if (finished) return;

      const text = data.toString();

      stdout += text;

      onOutput(text);
    },
  );

  jsProcess.stderr.on(
    "data",
    (data) => {
      if (finished) return;

      const text = data.toString();

      stderr += text;

      onOutput(text);
    },
  );

  jsProcess.on(
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

  jsProcess.on(
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
        jsProcess.kill("SIGKILL");
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
      "JavaScript Docker cleanup error:",
      error.message,
    );
  }
}

// =========================================
// EXPORT
// =========================================

module.exports = {
  runJavaScript,
  startJavaScriptInteractive,
};