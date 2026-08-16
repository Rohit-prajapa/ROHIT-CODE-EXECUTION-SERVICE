const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const RUST_IMAGE = "rust:1.88-alpine";
const EXECUTION_TIMEOUT = 10000;

// =========================================
// NORMAL RUST EXECUTION
// =========================================

function runRustDocker(code, input = "") {
  return new Promise((resolve) => {
    if (
      typeof code !== "string" ||
      !code.trim()
    ) {
      resolve({
        success: false,
        output: "No Rust code provided.",
      });
      return;
    }

    const id = uuidv4();

    const tempDir = path.join(
      __dirname,
      "docker-temp",
      `rust-${id}`,
    );

    const sourceFile = path.join(
      tempDir,
      "main.rs",
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
          `Could not prepare Rust file: ${error.message}`,
      });

      return;
    }

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

      // Image
      RUST_IMAGE,

      "sh",
      "-c",
      "rustc main.rs -O -o main && ./main",
    ];

    const rustProcess = spawn(
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
        rustProcess.kill("SIGKILL");
      } catch {}

      cleanup(tempDir);

      resolve({
        success: false,
        output:
          "⏱ Rust program timed out after 10 seconds.",
      });
    }, EXECUTION_TIMEOUT);

    rustProcess.stdout.on(
      "data",
      (data) => {
        stdout += data.toString();
      },
    );

    rustProcess.stderr.on(
      "data",
      (data) => {
        stderr += data.toString();
      },
    );

    rustProcess.on(
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

    rustProcess.on(
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
              `Rust program exited with code ${exitCode}.`,
          });
        }
      },
    );

    // Send input
    try {
      if (
        rustProcess.stdin &&
        !rustProcess.stdin.destroyed
      ) {
        rustProcess.stdin.write(
          String(input ?? ""),
        );

        rustProcess.stdin.end();
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
// INTERACTIVE RUST EXECUTION
// =========================================

function startRustInteractive(
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
    onError("No Rust code provided.");
    return null;
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "docker-temp",
    `rust-interactive-${id}`,
  );

  const sourceFile = path.join(
    tempDir,
    "main.rs",
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
      `Could not prepare Rust file: ${error.message}`,
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

    RUST_IMAGE,

    "sh",
    "-c",
    "rustc main.rs -O -o main && ./main",
  ];

  const rustProcess = spawn(
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
      rustProcess.kill("SIGKILL");
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

  rustProcess.stdout.on(
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

  rustProcess.stderr.on(
    "data",
    (data) => {
      if (finished) return;

      const text = data.toString();

      stderr += text;

      onOutput(text);
    },
  );

  // =========================================
  // ERROR
  // =========================================

  rustProcess.on(
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
  // CLOSE
  // =========================================

  rustProcess.on(
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
        !rustProcess.stdin ||
        rustProcess.stdin.destroyed ||
        rustProcess.stdin.writableEnded
      ) {
        return;
      }

      try {
        rustProcess.stdin.write(
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
        rustProcess.kill("SIGKILL");
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
      "Rust Docker cleanup error:",
      error.message,
    );
  }
}

// =========================================
// EXPORT
// =========================================

module.exports = {
  runRustDocker,
  startRustInteractive,
};