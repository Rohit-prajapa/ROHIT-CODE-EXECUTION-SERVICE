const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const C_IMAGE = "gcc:13";
const EXECUTION_TIMEOUT = 10000;

// =========================================
// INTERACTIVE C
// =========================================

function startCInteractive(code, handlers = {}) {
  const {
    onOutput = () => {},
    onExit = () => {},
    onError = () => {},
  } = handlers;

  return createCProcess({
    code,
    input: "",
    interactive: true,
    onOutput,
    onExit,
    onError,
  });
}

// =========================================
// NORMAL C
// =========================================

function runC(code, input = "") {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const controller = createCProcess({
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
        output: "Could not start C process.",
      });
    }
  });
}

// =========================================
// CREATE PROCESS
// =========================================

function createCProcess({
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
    onError("No C code provided.");
    return null;
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "docker-temp",
    `c-${id}`,
  );

  const sourceFile = path.join(
    tempDir,
    "main.c",
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
      `Could not prepare C file: ${error.message}`,
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

    C_IMAGE,

    "sh",
    "-c",
    "gcc main.c -O2 -o main && stdbuf -o0 -e0 ./main",
  ];

  const cProcess = spawn(
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
      cProcess.kill("SIGKILL");
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

  cProcess.stdout.on(
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

  cProcess.stderr.on(
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

  cProcess.on(
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
  // EXIT
  // =========================================

  cProcess.on(
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
        cProcess.stdin &&
        !cProcess.stdin.destroyed
      ) {
        cProcess.stdin.write(
          programInput,
        );

        cProcess.stdin.end();
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
        !cProcess.stdin ||
        cProcess.stdin.destroyed ||
        cProcess.stdin.writableEnded
      ) {
        return;
      }

      try {
        cProcess.stdin.write(
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

      try {
        cProcess.kill("SIGKILL");
      } catch {}

      clearTimeout(timeout);
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
      "C Docker cleanup error:",
      error.message,
    );
  }
}

// =========================================
// EXPORT
// =========================================

module.exports = {
  startCInteractive,
  runC,
};