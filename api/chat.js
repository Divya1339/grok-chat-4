// /api/chat.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const { message } = req.body || {};
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: "GROQ_API_KEY missing" });
    return;
  }

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  // Strict markdown prompt
  const systemPrompt = `
"You are a helpful assistant. Be consise, clear, and friendly. Use markdown when helpful."
`.trim();

  const GROQ_BASE = "https://api.groq.com/openai/v1";

  // Pick the best model you actually have access to
  async function pickModel() {
    const preferred = [
      "llama-3.3-70b-versatile",
      "llama-3.1-70b-versatile",
      "llama3-70b-8192",
      "llama-3.1-8b-instant",
      "llama3-8b-8192"
    ];

    try {
      const r = await fetch(`${GROQ_BASE}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });

      if (!r.ok) return preferred[preferred.length - 1];

      const data = await r.json();
      const available = new Set((data?.data || []).map((m) => m.id));

      // first preferred that exists
      for (const m of preferred) {
        if (available.has(m)) return m;
      }

      // otherwise, use the first model Groq returns (if any)
      const first = data?.data?.[0]?.id;
      return first || preferred[preferred.length - 1];
    } catch {
      // If models endpoint fails, fall back to a common one
      return preferred[preferred.length - 1];
    }
  }

  async function callGroq(model) {
    return fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ]
      })
    });
  }

  try {
    const model = await pickModel();

    const upstream = await callGroq(model);

    if (!upstream.ok || !upstream.body) {
      const txt = await upstream.text().catch(() => "");
      res.write(
        `event: error\ndata: ${JSON.stringify({
          error: txt || `Groq error (model=${model}).`
        })}\n\n`
      );
      res.end();
      return;
    }

    // Pass-through Groq SSE chunks directly to client
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let lastPing = Date.now();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      res.write(decoder.decode(value, { stream: true }));

      // keep-alive ping
      if (Date.now() - lastPing > 8000) {
        res.write(`: ping\n\n`);
        lastPing = Date.now();
      }
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
  }
}