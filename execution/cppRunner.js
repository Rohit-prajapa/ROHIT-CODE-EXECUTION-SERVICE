const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const CPP_IMAGE = "gcc:13";
const EXECUTION_TIMEOUT = 10000;

// =========================================
// INTERACTIVE C++ EXECUTION
// =========================================

function startCppInteractive(code, handlers = {}) {
  const {
    onOutput = () => {},
    onExit = () => {},
    onError = () => {},
  } = handlers;

  return createCppProcess({
    code,
    input: "",
    interactive: true,
    onOutput,
    onExit,
    onError,
  });
}

// =========================================
// NORMAL C++ EXECUTION
// =========================================

function runCppNormal(code, input = "") {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const processController = createCppProcess({
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

    if (!processController) {
      resolve({
        success: false,
        output: "Could not start C++ process.",
      });
    }
  });
}

// =========================================
// CREATE C++ PROCESS
// =========================================

function createCppProcess({
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
    onError("No C++ code provided.");
    return null;
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "docker-temp",
    `cpp-${id}`,
  );

  const sourceFile = path.join(
    tempDir,
    "main.cpp",
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
      `Could not prepare C++ file: ${error.message}`,
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

    CPP_IMAGE,

    "sh",
    "-c",

    // Compile + unbuffered execution
    "g++ main.cpp -std=c++17 -O2 -o main && stdbuf -o0 -e0 ./main",
  ];

  const cppProcess = spawn(
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
      cppProcess.kill("SIGKILL");
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

  cppProcess.stdout.on(
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

  cppProcess.stderr.on(
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

  cppProcess.on(
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
        cppProcess.stdin &&
        !cppProcess.stdin.destroyed
      ) {
        cppProcess.stdin.write(
          programInput,
        );

        cppProcess.stdin.end();
      }
    } catch (error) {
      onError(
        `Could not send input: ${error.message}`,
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
          `Could not send input: ${error.message}`,
        );
      }
    },

    stop() {
      if (finished) return;

      try {
        cppProcess.kill("SIGKILL");
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
      "C++ Docker cleanup error:",
      error.message,
    );
  }
}

// =========================================
// EXPORT
// =========================================

module.exports = {
  startCppInteractive,
  runCppNormal,
};