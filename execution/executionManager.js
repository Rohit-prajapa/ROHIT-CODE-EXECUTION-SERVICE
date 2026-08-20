const { startCppInteractive } = require("./dockerRunner");

const {
  startPythonInteractive,
} = require("./pythonDockerRunner");

const {
  startCInteractive,
} = require("./cDockerRunner");

const {
  startJavaInteractive,
} = require("./javaDockerRunner");

const {
  startJavaScriptInteractive,
} = require("./javascriptDockerRunner");

const {
  startGoInteractive,
} = require("./goDockerRunner");

const {
  startPhpInteractive,
} = require("./phpDockerRunner");

const {
  startRustInteractive,
} = require("./rustDockerRunner");


// =========================================
// EXECUTE CODE
// =========================================

async function executeCode(
  language,
  code,
  input = "",
  handlers = null,
) {
  const normalizedLanguage = String(language || "")
    .trim()
    .toLowerCase();

  if (
    typeof code !== "string" ||
    !code.trim()
  ) {
    return {
      success: false,
      output: "Code is required.",
    };
  }


  // =========================================
  // INTERACTIVE EXECUTION
  // =========================================

  if (handlers) {
    switch (normalizedLanguage) {

      // =====================================
      // C
      // =====================================

      case "c":
        return startCInteractive(
          code,
          handlers,
        );


      // =====================================
      // C++
      // =====================================

      case "cpp":
      case "c++":
        return startCppInteractive(
          code,
          handlers,
        );


      // =====================================
      // PYTHON
      // =====================================

      case "python":
      case "python3":
        return startPythonInteractive(
          code,
          handlers,
        );


      // =====================================
      // JAVA
      // =====================================

      case "java":
        return startJavaInteractive(
          code,
          handlers,
        );


      // =====================================
      // JAVASCRIPT
      // =====================================

      case "javascript":
      case "js":
      case "node":
      case "nodejs":
        return startJavaScriptInteractive(
          code,
          handlers,
        );


      // =====================================
      // GO
      // =====================================

      case "go":
        return startGoInteractive(
          code,
          handlers,
        );


      // =====================================
      // PHP
      // =====================================

      case "php":
        return startPhpInteractive(
          code,
          handlers,
        );


      // =====================================
      // RUST
      // =====================================

      case "rust":
        return startRustInteractive(
          code,
          handlers,
        );


      // =====================================
      // DEFAULT
      // =====================================

      default:
        handlers.onError?.(
          `Execution for "${language}" is not available yet.`,
        );

        return null;
    }
  }


  // =========================================
  // NORMAL EXECUTION
  // =========================================

  switch (normalizedLanguage) {

    case "c":
      return {
        success: false,
        output:
          "Normal C execution is not available. Use interactive execution.",
      };


    case "cpp":
    case "c++":
      return {
        success: false,
        output:
          "Normal C++ execution is not available. Use interactive execution.",
      };


    case "python":
    case "python3":
      return {
        success: false,
        output:
          "Normal Python execution is not available. Use interactive execution.",
      };


    case "java":
      return {
        success: false,
        output:
          "Normal Java execution is not available. Use interactive execution.",
      };


    case "javascript":
    case "js":
    case "node":
    case "nodejs":
      return {
        success: false,
        output:
          "Normal JavaScript execution is not available. Use interactive execution.",
      };


    case "go":
      return {
        success: false,
        output:
          "Normal Go execution is not available. Use interactive execution.",
      };


    case "php":
      return {
        success: false,
        output:
          "Normal PHP execution is not available. Use interactive execution.",
      };


    case "rust":
      return {
        success: false,
        output:
          "Normal Rust execution is not available. Use interactive execution.",
      };


    default:
      return {
        success: false,
        output:
          `Execution for "${language}" is not available yet.`,
      };
  }
}


module.exports = executeCode;