import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// serve static files
app.use(express.static(__dirname));

// Vercel-like API route locally
import chatHandler from "./api/chat.js";
app.post("/api/chat", (req, res) => chatHandler(req, res));

app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Local dev server: http://localhost:${PORT}`);
});