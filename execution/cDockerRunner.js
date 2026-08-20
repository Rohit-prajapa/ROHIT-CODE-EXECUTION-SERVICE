const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

// =========================================
// CONFIGURATION
// =========================================

const C_IMAGE = "gcc:latest";
const EXECUTION_TIMEOUT = 10000;

// =========================================
// INTERACTIVE C EXECUTION
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
// NORMAL C EXECUTION
// =========================================

function runCNormal(code, input = "") {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const processController = createCProcess({
      code,
      input,
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

    if (!processController) {
      resolve({
        success: false,
        output: "Could not start C process.",
      });
    }
  });
}

// =========================================
// CREATE C DOCKER PROCESS
// =========================================

function createCProcess({
  code,
  input = "",
  interactive = true,
  onOutput = () => {},
  onExit = () => {},
  onError = () => {},
}) {
  // =======================================
  // VALIDATE CODE
  // =======================================

  if (typeof code !== "string" || !code.trim()) {
    onError("No C code provided.");
    return null;
  }

  const id = uuidv4();

  const tempDir = path.join(__dirname, "docker-temp", `c-${id}`);

  const sourceFile = path.join(tempDir, "main.c");

  // =======================================
  // CREATE TEMP DIRECTORY
  // =======================================

  try {
    fs.mkdirSync(tempDir, {
      recursive: true,
    });

    fs.writeFileSync(sourceFile, code, "utf8");
  } catch (error) {
    cleanup(tempDir);

    onError(`Could not prepare C file: ${error.message}`);

    return null;
  }

  console.log("🐳 Starting C Docker process...");

  console.log("📁 Source:", sourceFile);

  // =======================================
  // DOCKER ARGUMENTS
  // =======================================

  const dockerArgs = [
    "run",

    "--rm",

    // =====================================
    // IMPORTANT FOR INTERACTIVE STDIN
    // =====================================

    "-i",

    // =====================================
    // RESOURCE LIMITS
    // =====================================

    "--memory=256m",
    "--cpus=0.5",
    "--pids-limit=50",

    // =====================================
    // SECURITY
    // =====================================

    "--network=none",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",

    // =====================================
    // TEMP FILESYSTEM
    // =====================================

    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=32m",

    // =====================================
    // MOUNT SOURCE
    // =====================================

    "-v",
    `${tempDir}:/code:rw`,

    // =====================================
    // WORKING DIRECTORY
    // =====================================

    "-w",
    "/code",

    // =====================================
    // IMAGE
    // =====================================

    C_IMAGE,

    // =====================================
    // COMPILE + EXECUTE
    // =====================================

    "sh",
    "-c",

    "gcc main.c -O2 -o main && stdbuf -o0 -e0 ./main",
  ];

  console.log("🐳 Docker image:", C_IMAGE);

  // =======================================
  // START DOCKER
  // =======================================

  let cProcess;

  try {
    cProcess = spawn("docker", dockerArgs, {
      windowsHide: true,

      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    cleanup(tempDir);

    onError(`Could not start Docker: ${error.message}`);

    return null;
  }

  // =======================================
  // PROCESS STATE
  // =======================================

  let finished = false;

  let stdout = "";
  let stderr = "";

  // =======================================
  // FINISH
  // =======================================

  const finish = (exitCode, callExit = true) => {
    if (finished) {
      return;
    }

    finished = true;

    clearTimeout(timeout);

    cleanup(tempDir);

    if (callExit) {
      onExit(exitCode, stdout, stderr);
    }
  };

  // =======================================
  // TIMEOUT
  // =======================================

  const timeout = setTimeout(() => {
    if (finished) {
      return;
    }

    console.log("⏱ C program timed out.");

    finished = true;

    try {
      cProcess.kill("SIGKILL");
    } catch {}

    clearTimeout(timeout);

    cleanup(tempDir);

    onOutput("\r\n⏱ Program timed out after 10 seconds.\r\n");

    onExit(124, stdout, stderr);
  }, EXECUTION_TIMEOUT);

  // =======================================
  // STDOUT
  // =======================================

  cProcess.stdout.on("data", (data) => {
    if (finished) {
      return;
    }

    const text = data.toString();

    stdout += text;

    console.log("📤 C stdout:", JSON.stringify(text));

    onOutput(text);
  });

  // =======================================
  // STDERR
  // =======================================

  cProcess.stderr.on("data", (data) => {
    if (finished) {
      return;
    }

    const text = data.toString();

    stderr += text;

    console.log("📤 C stderr:", JSON.stringify(text));

    onOutput(text);
  });

  // =======================================
  // DOCKER PROCESS ERROR
  // =======================================

  cProcess.on("error", (error) => {
    if (finished) {
      return;
    }

    finished = true;

    clearTimeout(timeout);

    cleanup(tempDir);

    console.error("❌ C Docker process error:", error);

    onError(error.message || "Could not start Docker.");
  });

  // =======================================
  // DOCKER PROCESS CLOSE
  // =======================================

  cProcess.on("close", (exitCode) => {
    if (finished) {
      return;
    }

    console.log("⏹ C Docker exited:", exitCode);

    finish(exitCode);
  });

  // =======================================
  // NORMAL MODE INPUT
  // =======================================

  if (!interactive) {
    const programInput =
      typeof input === "string" ? input : String(input ?? "");

    try {
      if (
        cProcess.stdin &&
        !cProcess.stdin.destroyed &&
        !cProcess.stdin.writableEnded
      ) {
        console.log("📥 Sending normal C input:", JSON.stringify(programInput));

        cProcess.stdin.write(programInput, "utf8");

        cProcess.stdin.end();
      }
    } catch (error) {
      onError(`Could not send input: ${error.message}`);
    }
  }

  // =======================================
  // INTERACTIVE CONTROLLER
  // =======================================

  return {
    // =====================================
    // SEND INPUT
    // =====================================

    writeInput(input) {
      if (finished) {
        console.log("⚠ C process already finished.");

        return false;
      }

      if (
        !cProcess.stdin ||
        cProcess.stdin.destroyed ||
        cProcess.stdin.writableEnded
      ) {
        console.log("⚠ C stdin is not writable.");

        return false;
      }

      let value = String(input ?? "");

      // -----------------------------------
      // IMPORTANT
      // -----------------------------------
      // Make sure Enter reaches scanf().
      //
      // If frontend sends "3" without newline,
      // append one.
      // -----------------------------------

      if (!value.endsWith("\n") && !value.endsWith("\r")) {
        value += "\n";
      }

      console.log("🐳 Sending input to C Docker:", JSON.stringify(value));

      try {
        const writable = cProcess.stdin.write(value, "utf8", (error) => {
          if (error) {
            console.error("❌ Docker stdin write error:", error);
          } else {
            console.log("✅ Input successfully sent to Docker");
          }
        });

        return writable !== false;
      } catch (error) {
        console.error("❌ Could not send input:", error);

        onError(`Could not send input: ${error.message}`);

        return false;
      }
    },

    // =====================================
    // STOP
    // =====================================

    stop() {
      if (finished) {
        return;
      }

      console.log("⏹ Stopping C Docker process...");

      finished = true;

      clearTimeout(timeout);

      try {
        if (
          cProcess.stdin &&
          !cProcess.stdin.destroyed &&
          !cProcess.stdin.writableEnded
        ) {
          cProcess.stdin.destroy();
        }
      } catch {}

      try {
        cProcess.kill("SIGKILL");
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
    console.error("❌ C Docker cleanup error:", error.message);
  }
}

// =========================================
// EXPORT
// =========================================

module.exports = {
  startCInteractive,
  runCNormal,
};
