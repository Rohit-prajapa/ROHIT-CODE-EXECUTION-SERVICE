const {
  startCInteractive,
  runC,
} = require("./cDockerRunner");

const {
  startCppInteractive,
  runCppNormal,
} = require("./cppDockerRunner");

const {
  startPythonInteractive,
  runPython,
} = require("./pythonDockerRunner");

const {
  startJavaInteractive,
  runJava,
} = require("./javaDockerRunner");

const {
  startJavaScriptInteractive,
  runJavaScript,
} = require("./javascriptDockerRunner");

const {
  startGoInteractive,
  runGo,
} = require("./goDockerRunner");

const {
  startPhpInteractive,
  runPhp,
} = require("./phpDockerRunner");

const {
  startRustInteractive,
  runRust,
} = require("./rustDockerRunner");


// ============================================================
// EXECUTE CODE
// ============================================================

async function executeCode(
  language,
  code,
  input = "",
  handlers = null,
) {
  const normalizedLanguage = String(language || "")
    .trim()
    .toLowerCase();

  // ==========================================================
  // VALIDATE CODE
  // ==========================================================

  if (
    typeof code !== "string" ||
    !code.trim()
  ) {
    if (handlers) {
      handlers.onError?.("Code is required.");
      return null;
    }

    return {
      success: false,
      output: "Code is required.",
    };
  }

  // ==========================================================
  // INTERACTIVE EXECUTION
  // ==========================================================

  if (handlers) {
    switch (normalizedLanguage) {

      // ------------------------------------------------------
      // C
      // ------------------------------------------------------

      case "c":
        return startCInteractive(
          code,
          handlers,
        );

      // ------------------------------------------------------
      // C++
      // ------------------------------------------------------

      case "cpp":
      case "c++":
        return startCppInteractive(
          code,
          handlers,
        );

      // ------------------------------------------------------
      // PYTHON
      // ------------------------------------------------------

      case "python":
      case "python3":
        return startPythonInteractive(
          code,
          handlers,
        );

      // ------------------------------------------------------
      // JAVA
      // ------------------------------------------------------

      case "java":
        return startJavaInteractive(
          code,
          handlers,
        );

      // ------------------------------------------------------
      // JAVASCRIPT
      // ------------------------------------------------------

      case "javascript":
      case "js":
      case "node":
      case "nodejs":
        return startJavaScriptInteractive(
          code,
          handlers,
        );

      // ------------------------------------------------------
      // GO
      // ------------------------------------------------------

      case "go":
        return startGoInteractive(
          code,
          handlers,
        );

      // ------------------------------------------------------
      // PHP
      // ------------------------------------------------------

      case "php":
        return startPhpInteractive(
          code,
          handlers,
        );

      // ------------------------------------------------------
      // RUST
      // ------------------------------------------------------

      case "rust":
        return startRustInteractive(
          code,
          handlers,
        );

      // ------------------------------------------------------
      // UNKNOWN
      // ------------------------------------------------------

      default:
        handlers.onError?.(
          `Execution for "${language}" is not available yet.`,
        );

        return null;
    }
  }

  // ==========================================================
  // NORMAL EXECUTION
  // ==========================================================

  switch (normalizedLanguage) {

    // --------------------------------------------------------
    // C
    // --------------------------------------------------------

    case "c":
      return runC(
        code,
        input,
      );

    // --------------------------------------------------------
    // C++
    // --------------------------------------------------------

    case "cpp":
    case "c++":
      return runCppNormal(
        code,
        input,
      );

    // --------------------------------------------------------
    // PYTHON
    // --------------------------------------------------------

    case "python":
    case "python3":
      return runPython(
        code,
        input,
      );

    // --------------------------------------------------------
    // JAVA
    // --------------------------------------------------------

    case "java":
      return runJava(
        code,
        input,
      );

    // --------------------------------------------------------
    // JAVASCRIPT
    // --------------------------------------------------------

    case "javascript":
    case "js":
    case "node":
    case "nodejs":
      return runJavaScript(
        code,
        input,
      );

    // --------------------------------------------------------
    // GO
    // --------------------------------------------------------

    case "go":
      return runGo(
        code,
        input,
      );

    // --------------------------------------------------------
    // PHP
    // --------------------------------------------------------

    case "php":
      return runPhp(
        code,
        input,
      );

    // --------------------------------------------------------
    // RUST
    // --------------------------------------------------------

    case "rust":
      return runRust(
        code,
        input,
      );

    // --------------------------------------------------------
    // UNKNOWN
    // --------------------------------------------------------

    default:
      return {
        success: false,
        output:
          `Execution for "${language}" is not available yet.`,
      };
  }
}


// ============================================================
// EXPORT
// ============================================================

module.exports = executeCode;