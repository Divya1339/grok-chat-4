// api/stream.js
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const message = (req.query?.message || "").toString().trim();

  if (!process.env.GROQ_API_KEY) {
    res.status(500).send("GROQ_API_KEY missing");
    return;
  }

  if (!message) {
    res.status(400).send("message is required");
    return;
  }

  // ✅ SSE headers
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write(`: stream-start\n\n`);

  // 🔒 Strict Markdown compliance
  const strictMarkdownPrompt = `
You MUST respond using VALID MARKDOWN only.

Rules:
- All headings MUST use markdown (#, ##, ###).
- If a table is requested, output a VALID markdown pipe table including a separator row:
  | Col A | Col B |
  |------|------|
  | A1   | B1   |
- Never output tab-separated tables.
- Lists must use "-" bullets.
- Do NOT wrap the entire response in triple backticks.
`.trim();

  // Try best models first; fallback if not enabled on this key
  const modelCandidates = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
  ];

  async function callGroq(model) {
    return fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        stream: true,
        messages: [
          { role: "system", content: strictMarkdownPrompt },
          { role: "user", content: message },
        ],
      }),
    });
  }

  try {
    let upstream = null;
    let lastErr = "";

    for (const model of modelCandidates) {
      const r = await callGroq(model);
      if (r.ok && r.body) {
        upstream = r;
        break;
      }
      lastErr = await r.text().catch(() => "");
    }

    if (!upstream || !upstream.body) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: lastErr || "Upstream error" })}\n\n`);
      res.end();
      return;
    }

    // Parse Groq SSE frames -> forward only token deltas
    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";

      for (const frame of frames) {
        const line = frame
          .split("\n")
          .find((l) => l.startsWith("data:"));

        if (!line) continue;

        const payload = line.replace(/^data:\s*/, "").trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content || "";
          if (!delta) continue;

          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        } catch {
          // ignore malformed frames
        }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
  }
}