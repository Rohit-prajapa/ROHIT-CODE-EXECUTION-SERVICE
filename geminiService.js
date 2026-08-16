const { GoogleGenAI } = require("@google/genai");

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("⚠️ GEMINI_API_KEY is not configured.");
}

const ai = new GoogleGenAI({
  apiKey,
});

async function generateCode({
  prompt,
  language,
  currentCode = "",
}) {
  if (!prompt || !prompt.trim()) {
    throw new Error("AI prompt is required.");
  }

  const languageName = language || "JavaScript";

  const fullPrompt = `
You are the AI coding assistant inside ROHIT-CODE.

Programming language: ${languageName}

User request:
${prompt}

Current editor code:
${currentCode || "(empty editor)"}

Instructions:
- Answer the user's coding request.
- Generate code specifically for ${languageName}.
- Return clean, working code.
- Do not use Markdown code fences.
- Do not add explanations unless the user asks for an explanation.
- Do not change the programming language.
- Make the code directly usable in the editor.
`;

  const response = await ai.models.generateContent({
   model: "gemini-3.6-flash",
    contents: fullPrompt,
  });

  return response.text?.trim() || "";
}

module.exports = {
  generateCode,
};