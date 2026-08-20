const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const JAVA_IMAGE = "eclipse-temurin:21-jdk";
const EXECUTION_TIMEOUT = 10000;

// =========================================
// NORMAL JAVA
// =========================================

function runJava(code, input = "") {
  return new Promise((resolve) => {
    if (
      typeof code !== "string" ||
      !code.trim()
    ) {
      resolve({
        success: false,
        output: "No Java code provided.",
      });
      return;
    }

    const id = uuidv4();

    const tempDir = path.join(
      __dirname,
      "docker-temp",
      `java-normal-${id}`,
    );

    const sourceFile = path.join(
      tempDir,
      "Main.java",
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
          `Could not prepare Java file: ${error.message}`,
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

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) return;

      finished = true;

      try {
        javaProcess.kill("SIGKILL");
      } catch {}

      cleanup(tempDir);

      resolve({
        success: false,
        output:
          "⏱ Java program timed out after 10 seconds.",
      });
    }, EXECUTION_TIMEOUT);

    javaProcess.stdout.on(
      "data",
      (data) => {
        stdout += data.toString();
      },
    );

    javaProcess.stderr.on(
      "data",
      (data) => {
        stderr += data.toString();
      },
    );

    javaProcess.on(
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

    javaProcess.on(
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
              `Java program exited with code ${exitCode}.`,
          });
        }
      },
    );

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
      if (!finished) {
        finished = true;

        clearTimeout(timeout);
        cleanup(tempDir);

        resolve({
          success: false,
          output:
            `Could not send input: ${error.message}`,
        });
      }
    }
  });
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

  if (
    typeof code !== "string" ||
    !code.trim()
  ) {
    onError("No Java code provided.");
    return null;
  }

  const id = uuidv4();

  const tempDir = path.join(
    __dirname,
    "docker-temp",
    `java-interactive-${id}`,
  );

  const sourceFile = path.join(
    tempDir,
    "Main.java",
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
      `Could not prepare Java file: ${error.message}`,
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
  let stdout = "";
  let stderr = "";

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
  // ERROR
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
  // CLOSE
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
  runJava,
  startJavaInteractive,
};