const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const PHP_IMAGE = "php:8.4-cli-alpine";
const EXECUTION_TIMEOUT = 10000;

// =========================================
// INTERACTIVE PHP
// =========================================

function startPhpInteractive(
  code,
  handlers = {},
) {
  const {
    onOutput = () => {},
    onExit = () => {},
    onError = () => {},
  } = handlers;

  return createPhpProcess({
    code,
    input: "",
    interactive: true,
    onOutput,
    onExit,
    onError,
  });
}

// =========================================
// NORMAL PHP
// =========================================

function runPhp(code, input = "") {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const controller = createPhpProcess({
      code,
      input,
      interactive: false,

      onOutput: (data) => {
        stdout += String(data);
      },

      onExit: (exitCode) => {
        resolve({
          success: exitCode === 0,
          output:
            stdout ||
            stderr ||
            `Process exited with code ${exitCode}.`,
        });
      },

      onError: (error) => {
        resolve({
          success: false,
          output: String(error),
        });
      },
    });

    if (!controller) {
      resolve({
        success: false,
        output: "Could not start PHP process.",
      });
    }
  });
}

// =========================================
// CREATE PHP PROCESS
// =========================================

function createPhpProcess({
  code,
  input = "",
  interactive = true,
  onOutput = () => {},
  onExit = () => {},
  onError = () => {},
}) {
  if (
    typeof code !== "string" ||
    !code.trim()
  ) {
    onError("No PHP code provided.");
    return null;
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "docker-temp",
    `php-${id}`,
  );

  const sourceFile = path.join(
    tempDir,
    "main.php",
  );

  // =========================================
  // PREPARE FILE
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
      `Could not prepare PHP file: ${error.message}`,
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

    // Image
    PHP_IMAGE,

    "php",
    "-d",
    "display_errors=1",
    "-d",
    "display_startup_errors=1",
    "main.php",
  ];

  const phpProcess = spawn(
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
      phpProcess.kill("SIGKILL");
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

  phpProcess.stdout.on(
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

  phpProcess.stderr.on(
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

  phpProcess.on(
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

  phpProcess.on(
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
  // NORMAL INPUT
  // =========================================

  if (!interactive) {
    const programInput =
      typeof input === "string"
        ? input
        : String(input ?? "");

    try {
      if (
        phpProcess.stdin &&
        !phpProcess.stdin.destroyed
      ) {
        phpProcess.stdin.write(
          programInput,
        );

        phpProcess.stdin.end();
      }
    } catch (error) {
      onError(
        `Could not send input: ${error.message}`,
      );
    }
  }

  // =========================================
  // CONTROLLER
  // =========================================

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
          `Could not send input: ${error.message}`,
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
      "PHP Docker cleanup error:",
      error.message,
    );
  }
}

// =========================================
// EXPORT
// =========================================

module.exports = {
  startPhpInteractive,
  runPhp,
};