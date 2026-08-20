const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const GO_IMAGE = "golang:1.24-alpine";

const EXECUTION_TIMEOUT = 30000;
const PROGRAM_TIMEOUT = 15000;

// =========================================
// INTERACTIVE GO
// =========================================

function startGoInteractive(code, handlers = {}) {
  const {
    onOutput = () => {},
    onExit = () => {},
    onError = () => {},
  } = handlers;

  return createGoProcess({
    code,
    interactive: true,
    onOutput,
    onExit,
    onError,
  });
}

// =========================================
// NORMAL GO
// =========================================

function runGo(code, input = "") {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const controller = createGoProcess({
      code,
      interactive: false,

      onOutput: (data) => {
        stdout += String(data);
      },

      onExit: (exitCode) => {
        resolve({
          success: exitCode === 0,
          output: stdout || stderr || `Process exited with code ${exitCode}.`,
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
        output: "Could not start Go process.",
      });

      return;
    }

    if (input !== undefined && input !== null) {
      controller.writeInput(String(input));

      controller.endInput();
    }
  });
}

// =========================================
// CREATE GO PROCESS
// =========================================

function createGoProcess({
  code,
  interactive = true,
  onOutput = () => {},
  onExit = () => {},
  onError = () => {},
}) {
  if (typeof code !== "string" || !code.trim()) {
    onError("No Go code provided.");
    return null;
  }

  const id = uuidv4();

  const tempDir = path.join(__dirname, "docker-temp", `go-${id}`);

  const sourceFile = path.join(tempDir, "main.go");

  // =========================================
  // PREPARE SOURCE
  // =========================================

  try {
    fs.mkdirSync(tempDir, {
      recursive: true,
    });

    fs.writeFileSync(sourceFile, code, "utf8");
  } catch (error) {
    cleanup(tempDir);

    onError(`Could not prepare Go file: ${error.message}`);

    return null;
  }

  // =========================================
  // DOCKER
  // =========================================

  const dockerArgs = [
    "run",
    "--rm",

    // IMPORTANT:
    // Keep stdin open for interactive programs.
    "-i",

    // Resource limits
    "--memory=512m",
    "--cpus=0.5",
    "--pids-limit=100",

    // Security
    "--network=none",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",

    // Source code
    "-v",
    `${tempDir}:/code:rw`,

    // Working directory
    "-w",
    "/code",

    GO_IMAGE,

    "sh",
    "-c",

    /*
     * Build directly in the normal container filesystem.
     *
     * Do NOT use a custom /tmp tmpfs.
     * This avoids the previous permission-denied problem.
     */
    `GOCACHE=/tmp/go-cache \
GOMODCACHE=/tmp/go-mod-cache \
GOMAXPROCS=1 \
go build -p 1 -o /code/rohit-go-main main.go \
&& chmod 755 /code/rohit-go-main \
&& timeout ${Math.floor(PROGRAM_TIMEOUT / 1000)} /code/rohit-go-main`,
  ];

  // =========================================
  // START DOCKER
  // =========================================

  const goProcess = spawn("docker", dockerArgs, {
    windowsHide: true,

    stdio: ["pipe", "pipe", "pipe"],
  });

  let finished = false;
  let stdout = "";
  let stderr = "";

  // =========================================
  // FINISH
  // =========================================

  const finish = (exitCode) => {
    if (finished) {
      return;
    }

    finished = true;

    clearTimeout(timeout);

    cleanup(tempDir);

    onExit(exitCode, stdout, stderr);
  };

  // =========================================
  // SERVER TIMEOUT
  // =========================================

  const timeout = setTimeout(() => {
    if (finished) {
      return;
    }

    finished = true;

    try {
      goProcess.kill("SIGKILL");
    } catch {}

    cleanup(tempDir);

    onOutput("\r\n⏱ Go program timed out after 30 seconds.\r\n");

    onExit(124, stdout, stderr);
  }, EXECUTION_TIMEOUT);

  // =========================================
  // STDOUT
  // =========================================

  goProcess.stdout.on("data", (data) => {
    if (finished) {
      return;
    }

    const text = data.toString();

    stdout += text;

    onOutput(text);
  });

  // =========================================
  // STDERR
  // =========================================

  goProcess.stderr.on("data", (data) => {
    if (finished) {
      return;
    }

    const text = data.toString();

    stderr += text;

    onOutput(text);
  });

  // =========================================
  // DOCKER ERROR
  // =========================================

  goProcess.on("error", (error) => {
    if (finished) {
      return;
    }

    finished = true;

    clearTimeout(timeout);

    cleanup(tempDir);

    onError(error.message || "Could not start Docker.");
  });

  // =========================================
  // DOCKER CLOSE
  // =========================================

  goProcess.on("close", (exitCode) => {
    if (finished) {
      return;
    }

    finish(exitCode);
  });

  // =========================================
  // NORMAL INPUT
  // =========================================

  if (!interactive) {
    const programInput =
      typeof input === "string" ? input : String(input ?? "");

    try {
      if (
        goProcess.stdin &&
        !goProcess.stdin.destroyed &&
        !goProcess.stdin.writableEnded
      ) {
        goProcess.stdin.write(programInput);

        goProcess.stdin.end();
      }
    } catch (error) {
      onError(`Could not send input: ${error.message}`);
    }
  }

  // =========================================
  // INTERACTIVE CONTROLLER
  // =========================================

  return {
    writeInput(input) {
      if (finished) {
        return;
      }

      const stdin = goProcess.stdin;

      if (!stdin || stdin.destroyed || stdin.writableEnded) {
        return;
      }

      try {
        stdin.write(String(input ?? ""));
      } catch (error) {
        onError(`Could not send Go input: ${error.message}`);
      }
    },

    endInput() {
      if (finished) {
        return;
      }

      const stdin = goProcess.stdin;

      if (!stdin || stdin.destroyed || stdin.writableEnded) {
        return;
      }

      try {
        stdin.end();
      } catch (error) {
        onError(`Could not close Go input: ${error.message}`);
      }
    },

    stop() {
      if (finished) {
        return;
      }

      finished = true;

      clearTimeout(timeout);

      try {
        goProcess.kill("SIGKILL");
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
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, {
        recursive: true,
        force: true,
      });
    }
  } catch (error) {
    console.error("Go Docker cleanup error:", error.message);
  }
}

// =========================================
// EXPORT
// =========================================

module.exports = {
  startGoInteractive,
  runGo,
};
