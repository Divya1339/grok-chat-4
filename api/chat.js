export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const { message } = req.body || {};

  if (!process.env.GROQ_API_KEY) {
    res.status(500).json({ reply: "Server error: GROQ_API_KEY missing." });
    return;
  }

  if (!message || typeof message !== "string") {
    res.status(400).json({ reply: "Bad request: message is required." });
    return;
  }

  // Streaming headers (SSE)
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  try {
    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: message }],
        temperature: 0.7,
        stream: true
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const txt = await upstream.text().catch(() => "");
      res.write(`event: error\ndata: ${JSON.stringify({ error: txt || "Upstream error" })}\n\n`);
      res.end();
      return;
    }

    const decoder = new TextDecoder();

    // Pass Groq's SSE stream straight to the browser
    for await (const chunk of upstream.body) {
      res.write(decoder.decode(chunk, { stream: true }));
    }

    res.end();
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
    res.end();
  }
}