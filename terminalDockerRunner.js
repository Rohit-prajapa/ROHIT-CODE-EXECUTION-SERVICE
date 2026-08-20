const { execFile } = require("child_process");

const CONTAINER_NAME = "rohit-code-terminal";
const DOCKER_IMAGE = "alpine:latest";

const COMMAND_TIMEOUT = 5000;
const START_TIMEOUT = 10000;
const MAX_BUFFER = 1024 * 1024;
const MAX_COMMAND_LENGTH = 2000;

let containerStarted = false;

// =========================================
// DOCKER HELPER
// =========================================

function runDocker(args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      "docker",
      args,
      {
        timeout: options.timeout || COMMAND_TIMEOUT,
        maxBuffer: options.maxBuffer || MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          error,
          stdout: stdout || "",
          stderr: stderr || "",
        });
      },
    );
  });
}

// =========================================
// DOCKER AVAILABLE
// =========================================

async function isDockerAvailable() {
  const result = await runDocker(
    ["info"],
    {
      timeout: 5000,
    },
  );

  return !result.error;
}

// =========================================
// CONTAINER EXISTS
// =========================================

async function containerExists() {
  const result = await runDocker([
    "inspect",
    CONTAINER_NAME,
  ]);

  return !result.error;
}

// =========================================
// CONTAINER RUNNING
// =========================================

async function isContainerRunning() {
  const result = await runDocker([
    "inspect",
    "-f",
    "{{.State.Running}}",
    CONTAINER_NAME,
  ]);

  return (
    !result.error &&
    result.stdout.trim() === "true"
  );
}

// =========================================
// START TERMINAL CONTAINER
// =========================================

async function startContainer() {
  if (await isContainerRunning()) {
    containerStarted = true;
    return true;
  }

  const dockerAvailable =
    await isDockerAvailable();

  if (!dockerAvailable) {
    console.error(
      "Docker daemon is not available.",
    );

    return false;
  }

  if (await containerExists()) {
    await runDocker(
      [
        "rm",
        "-f",
        CONTAINER_NAME,
      ],
      {
        timeout: 5000,
      },
    );
  }

  const result = await runDocker(
    [
      "run",
      "-d",

      "--name",
      CONTAINER_NAME,

      // ===================================
      // RESOURCE LIMITS
      // ===================================

      "--memory=128m",
      "--memory-swap=128m",
      "--cpus=0.25",
      "--pids-limit=50",

      // ===================================
      // SECURITY
      // ===================================

      "--network=none",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",

      // ===================================
      // TEMP FILESYSTEM
      // ===================================

      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=32m",

      // ===================================
      // WORKSPACE
      // ===================================

      "--workdir",
      "/workspace",

      // ===================================
      // IMAGE
      // ===================================

      DOCKER_IMAGE,

      // ===================================
      // KEEP CONTAINER RUNNING
      // ===================================

      "sh",
      "-c",
      "mkdir -p /workspace && while true; do sleep 3600; done",
    ],
    {
      timeout: START_TIMEOUT,
    },
  );

  if (result.error) {
    console.error(
      "Docker container start error:",
      result.stderr ||
        result.error.message,
    );

    return false;
  }

  containerStarted = true;

  console.log(
    `🐳 Docker terminal container started: ${CONTAINER_NAME}`,
  );

  return true;
}

// =========================================
// RUN TERMINAL COMMAND
// =========================================

async function runTerminalCommand(
  command,
) {
  if (
    typeof command !== "string"
  ) {
    return {
      success: false,
      output: "Command is required.",
    };
  }

  const cleanCommand =
    command.trim();

  if (!cleanCommand) {
    return {
      success: false,
      output: "Command is empty.",
    };
  }

  if (
    cleanCommand.length >
    MAX_COMMAND_LENGTH
  ) {
    return {
      success: false,
      output:
        `Command is too long. Maximum ${MAX_COMMAND_LENGTH} characters.`,
    };
  }

  if (
    cleanCommand.includes("\0")
  ) {
    return {
      success: false,
      output: "Invalid command.",
    };
  }

  const started =
    await startContainer();

  if (!started) {
    return {
      success: false,
      output:
        "Unable to start terminal Docker container.",
    };
  }

  const result = await runDocker(
    [
      "exec",
      "-w",
      "/workspace",

      CONTAINER_NAME,

      "sh",
      "-c",
      cleanCommand,
    ],
    {
      timeout: COMMAND_TIMEOUT,
    },
  );

  if (
    result.error &&
    result.error.killed
  ) {
    return {
      success: false,
      output:
        "Command timed out after 5 seconds.",
    };
  }

  if (result.error) {
    return {
      success: false,
      output:
        result.stderr ||
        result.stdout ||
        result.error.message ||
        "Terminal command failed.",
    };
  }

  return {
    success: true,
    output:
      result.stdout ||
      result.stderr ||
      "",
  };
}

// =========================================
// FILESYSTEM AUTOCOMPLETE
// =========================================

async function getFilesystemSuggestions(
  input,
) {
  if (
    typeof input !== "string" ||
    !input.trim()
  ) {
    return [];
  }

  const cleanInput =
    input.trim();

  // Only autocomplete cd
  if (
    !cleanInput.startsWith("cd ")
  ) {
    return [];
  }

  const pathInput =
    cleanInput
      .slice(3)
      .trim();

  if (!pathInput) {
    return [];
  }

  // =========================================
  // BASIC PATH PROTECTION
  // =========================================

  if (
    pathInput.includes("\0") ||
    pathInput.length > 1000
  ) {
    return [];
  }

  const lastSlash =
    pathInput.lastIndexOf("/");

  let directory;
  let partial;

  if (lastSlash === -1) {
    directory = "/workspace";
    partial = pathInput;
  } else {
    const typedDirectory =
      pathInput.slice(
        0,
        lastSlash + 1,
      );

    directory =
      typedDirectory ||
      "/workspace";

    partial =
      pathInput.slice(
        lastSlash + 1,
      );
  }

  if (
    directory.includes("\0") ||
    partial.includes("\0")
  ) {
    return [];
  }

  const started =
    await startContainer();

  if (!started) {
    return [];
  }

  const result = await runDocker(
    [
      "exec",
      CONTAINER_NAME,
      "ls",
      "-1Ap",
      "--",
      directory,
    ],
    {
      timeout: 3000,
    },
  );

  if (result.error) {
    return [];
  }

  const entries =
    result.stdout
      .split("\n")
      .map((item) =>
        item.trim(),
      )
      .filter(Boolean);

  const filtered =
    entries.filter(
      (entry) => {
        const cleanEntry =
          entry.endsWith("/")
            ? entry.slice(0, -1)
            : entry;

        return cleanEntry
          .toLowerCase()
          .startsWith(
            partial.toLowerCase(),
          );
      },
    );

  return filtered.map(
    (entry) => {
      const isDirectory =
        entry.endsWith("/");

      return {
        name: entry,
        type: isDirectory
          ? "directory"
          : "file",
      };
    },
  );
}

// =========================================
// CLEANUP CONTAINER
// =========================================

async function cleanupContainer() {
  if (
    !(await containerExists())
  ) {
    containerStarted = false;
    return;
  }

  console.log(
    "🧹 Stopping terminal Docker container...",
  );

  await runDocker(
    [
      "rm",
      "-f",
      CONTAINER_NAME,
    ],
    {
      timeout: 5000,
    },
  );

  containerStarted = false;
}

// =========================================
// SERVER SHUTDOWN
// =========================================

process.on(
  "SIGINT",
  async () => {
    await cleanupContainer();
    process.exit(0);
  },
);

process.on(
  "SIGTERM",
  async () => {
    await cleanupContainer();
    process.exit(0);
  },
);

// =========================================
// EXPORTS
// =========================================

module.exports = {
  runTerminalCommand,
  getFilesystemSuggestions,
  startContainer,
  cleanupContainer,
};