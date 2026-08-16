const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const JAVA_IMAGE = "eclipse-temurin:21-jdk";
const EXECUTION_TIMEOUT = 10000;

// =========================================
// CREATE JAVA TEMP FILE
// =========================================

function createJavaTemp(code) {
  if (
    typeof code !== "string" ||
    !code.trim()
  ) {
    throw new Error("No Java code provided.");
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "docker-temp",
    `java-${id}`,
  );

  fs.mkdirSync(tempDir, {
    recursive: true,
  });

  const sourceFile = path.join(
    tempDir,
    "Main.java",
  );

  fs.writeFileSync(
    sourceFile,
    code,
    "utf8",
  );

  return tempDir;
}

// =========================================
// INTERACTIVE JAVA
// =========================================

function startJavaInteractive(
  code,
  handlers = {},
) {
  const {
    onOutput = () => {},
    onExit = () => {},
    onError = () => {},
  } = handlers;

  let tempDir;

  try {
    tempDir = createJavaTemp(code);
  } catch (error) {
    onError(
      `Could not prepare Java file: ${error.message}`,
    );

    return null;
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

    JAVA_IMAGE,

    "sh",
    "-c",

    // Compile + run
    "javac Main.java && java Main",
  ];

  const javaProcess = spawn(
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
      javaProcess.kill("SIGKILL");
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

  javaProcess.stdout.on(
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

  javaProcess.stderr.on(
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

  javaProcess.on(
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

  javaProcess.on(
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
        !javaProcess.stdin ||
        javaProcess.stdin.destroyed ||
        javaProcess.stdin.writableEnded
      ) {
        return;
      }

      try {
        javaProcess.stdin.write(
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
        javaProcess.kill("SIGKILL");
      } catch {}

      cleanup(tempDir);
    },
  };
}

// =========================================
// NORMAL JAVA
// =========================================

function runJava(
  code,
  input = "",
) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const controller =
      createJavaProcess({
        code,
        input,
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
        output:
          "Could not start Java process.",
      });
    }
  });
}

// =========================================
// NORMAL JAVA PROCESS
// =========================================

function createJavaProcess({
  code,
  input = "",
  onOutput = () => {},
  onExit = () => {},
  onError = () => {},
}) {
  let tempDir;

  try {
    tempDir = createJavaTemp(code);
  } catch (error) {
    onError(error.message);
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

    JAVA_IMAGE,

    "sh",
    "-c",

    "javac Main.java && java Main",
  ];

  const javaProcess = spawn(
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

  const timeout = setTimeout(() => {
    if (finished) return;

    finished = true;

    try {
      javaProcess.kill("SIGKILL");
    } catch {}

    cleanup(tempDir);

    onOutput(
      "\r\n⏱ Java program timed out after 10 seconds.\r\n",
    );

    onExit(124);
  }, EXECUTION_TIMEOUT);

  javaProcess.stdout.on(
    "data",
    (data) => {
      if (!finished) {
        onOutput(data.toString());
      }
    },
  );

  javaProcess.stderr.on(
    "data",
    (data) => {
      if (!finished) {
        onOutput(data.toString());
      }
    },
  );

  javaProcess.on(
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

  javaProcess.on(
    "close",
    (exitCode) => {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);
      cleanup(tempDir);

      onExit(exitCode);
    },
  );

  // Send complete input
  try {
    if (
      javaProcess.stdin &&
      !javaProcess.stdin.destroyed
    ) {
      javaProcess.stdin.write(
        String(input ?? ""),
      );

      javaProcess.stdin.end();
    }
  } catch (error) {
    onError(
      `Could not send input: ${error.message}`,
    );
  }

  return {
    stop() {
      if (finished) return;

      finished = true;

      clearTimeout(timeout);

      try {
        javaProcess.kill("SIGKILL");
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
      "Java Docker cleanup error:",
      error.message,
    );
  }
}

// =========================================
// EXPORT
// =========================================

module.exports = {
  startJavaInteractive,
  runJava,
};