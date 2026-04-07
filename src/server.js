import express from "express";
import cors from "cors";
import { getCharacter, getAllCharacters } from "./characters/personas.js";
import { loadIndex, retrieveContext } from "./rag/retriever.js";

const app = express();
app.use(cors());
app.use(express.json());

const HF_TOKEN = process.env.HF_TOKEN;
if (!HF_TOKEN) {
  console.error("HF_TOKEN is required. Get a free token from https://huggingface.co/settings/tokens");
  process.exit(1);
}

const chatSessions = new Map();
loadIndex();

const GUARDRAIL_PROMPT = `
RESPONSE STYLE:
- Keep responses SHORT — 2 to 4 sentences max for simple questions.
- For deeper topics, use at most 5-6 sentences.
- Be poetic and impactful, not verbose. Every word should matter.
- Speak naturally as the character — no bullet points, no lists, no headers.
- Use simple, powerful language. Think dialogue, not essay.

IMPORTANT GUIDELINES:
- You are part of a respectful cultural learning platform about the Mahabharata.
- Always maintain the dignity and sanctity of the characters and texts.
- Never generate disrespectful, vulgar, or inappropriate content about any deity or character.
- If asked something inappropriate, politely decline while staying in character.
- When referencing events, stay true to the source texts.
`;

async function callLLM(messages) {
  const res = await fetch("https://router.huggingface.co/cerebras/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${HF_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama3.1-8b",
      messages,
      max_tokens: 300,
      temperature: 0.8
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices[0]?.message?.content || "I could not form a response.";
}

// GET /api/characters
app.get("/api/characters", (req, res) => {
  res.json(getAllCharacters());
});

// POST /api/chat
app.post("/api/chat", async (req, res) => {
  const { characterId, message, sessionId } = req.body;

  if (!characterId || !message) {
    return res.status(400).json({ error: "characterId and message are required" });
  }

  const character = getCharacter(characterId);
  if (!character) {
    return res.status(404).json({ error: "Character not found" });
  }

  try {
    const { context, sources } = await retrieveContext(message);

    const ragContext = context
      ? `\n\nRelevant knowledge from sacred texts:\n${context}\n\nUse this knowledge to inform your response, but speak naturally in character.`
      : "";

    const systemPrompt = `${character.systemPrompt}\n${GUARDRAIL_PROMPT}${ragContext}`;

    const sid = sessionId || `${characterId}-${Date.now()}`;
    let history = chatSessions.get(sid) || [];

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message }
    ];

    const reply = await callLLM(messages);

    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: reply });

    if (history.length > 40) history = history.slice(-30);
    chatSessions.set(sid, history);

    res.json({
      reply,
      sessionId: sid,
      character: character.name,
      sources: sources.length > 0 ? sources : undefined
    });
  } catch (err) {
    console.error("Chat error:", err.message);
    const isQuota = err.message?.includes("429") || err.message?.includes("rate");
    res.status(isQuota ? 429 : 500).json({
      error: isQuota
        ? "API rate limit reached. Please wait a moment and try again."
        : `Failed to generate response: ${err.message}`
    });
  }
});

// POST /api/chat/reset
app.post("/api/chat/reset", (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) chatSessions.delete(sessionId);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Mythic Chat backend running on http://localhost:${PORT}`);
});
