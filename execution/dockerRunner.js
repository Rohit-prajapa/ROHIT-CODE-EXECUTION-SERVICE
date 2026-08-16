const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const CPP_IMAGE = "gcc:13";

// Interactive programs need time to wait for user input.
const EXECUTION_TIMEOUT = 600000;

// =========================================
// C++ INTERACTIVE EXECUTION
// =========================================

function startCppInteractive(code, handlers = {}) {
  const {
    onOutput = () => {},
    onExit = () => {},
    onError = () => {},
  } = handlers;

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
  // CREATE TEMP DIRECTORY
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
  // DOCKER COMMAND
  // =========================================

  const dockerArgs = [
    "run",

    "--rm",

    // IMPORTANT:
    // Keep stdin open.
    "-i",

    // =======================================
    // RESOURCE LIMITS
    // =======================================

    "--memory=256m",
    "--cpus=0.5",
    "--pids-limit=50",

    // =======================================
    // SECURITY
    // =======================================

    "--network=none",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",

    // =======================================
    // TEMP FILESYSTEM
    // =======================================

    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=32m",

    // =======================================
    // MOUNT SOURCE
    // =======================================

    "-v",
    `${tempDir}:/code:rw`,

    // =======================================
    // WORKING DIRECTORY
    // =======================================

    "-w",
    "/code",

    // =======================================
    // IMAGE
    // =======================================

    CPP_IMAGE,

    // =======================================
    // COMPILE + RUN
    // =======================================

    "sh",
    "-c",

    // IMPORTANT:
    // Do NOT use `timeout 5 ./main`.
    //
    // `exec` makes the C++ program become
    // the main Docker process and keeps stdin
    // connected directly to it.
    //
    // stdbuf makes output appear immediately.
    "g++ main.cpp -std=c++17 -O2 -o main && exec stdbuf -o0 -e0 ./main",
  ];

  // =========================================
  // START DOCKER
  // =========================================

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
  // FINISH
  // =========================================

  function finish(exitCode) {
    if (finished) {
      return;
    }

    finished = true;

    clearTimeout(timeout);

    cleanup(tempDir);

    onExit(
      exitCode,
      stdout,
      stderr,
    );
  }

  // =========================================
  // TIMEOUT
  // =========================================

  const timeout = setTimeout(() => {
    if (finished) {
      return;
    }

    console.log(
      "⏱ C++ interactive execution timed out.",
    );

    finished = true;

    try {
      cppProcess.kill("SIGKILL");
    } catch {}

    cleanup(tempDir);

    onOutput(
      "\r\n⏱ Program timed out after 10 minutes.\r\n",
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
      if (finished) {
        return;
      }

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
      if (finished) {
        return;
      }

      const text = data.toString();

      stderr += text;

      onOutput(text);
    },
  );

  // =========================================
  // DOCKER PROCESS ERROR
  // =========================================

  cppProcess.on(
    "error",
    (error) => {
      if (finished) {
        return;
      }

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
  // DOCKER PROCESS CLOSE
  // =========================================

  cppProcess.on(
    "close",
    (exitCode) => {
      if (finished) {
        return;
      }

      finish(
        typeof exitCode === "number"
          ? exitCode
          : 1,
      );
    },
  );

  // =========================================
  // CONTROLLER
  // =========================================

  return {
    // =======================================
    // SEND USER INPUT
    // =======================================

    writeInput(input) {
      if (finished) {
        return;
      }

      if (
        !cppProcess.stdin ||
        cppProcess.stdin.destroyed ||
        cppProcess.stdin.writableEnded
      ) {
        return;
      }

      try {
        const value = String(
          input ?? "",
        );

        console.log(
          "▶ Sending C++ input:",
          JSON.stringify(value),
        );

        cppProcess.stdin.write(value);
      } catch (error) {
        onError(
          `Could not send C++ input: ${error.message}`,
        );
      }
    },

    // =======================================
    // STOP PROGRAM
    // =======================================

    stop() {
      if (finished) {
        return;
      }

      finished = true;

      clearTimeout(timeout);

      try {
        if (
          cppProcess.stdin &&
          !cppProcess.stdin.destroyed
        ) {
          cppProcess.stdin.destroy();
        }
      } catch {}

      try {
        cppProcess.kill("SIGKILL");
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
};