import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { GoogleGenerativeAI } from "@google/generative-ai";
import faissNode from "faiss-node";
const { IndexFlatL2 } = faissNode;

const DATA_DIR = path.resolve("data");
const STORE_DIR = path.resolve("store");
const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 80;

async function extractTextFromPDF(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

function chunkText(text, source) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const chunk = words.slice(i, i + CHUNK_SIZE).join(" ");
    if (chunk.trim().length > 50) {
      chunks.push({ text: chunk.trim(), source, index: chunks.length });
    }
  }
  return chunks;
}

async function getEmbedding(genAI, text) {
  const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

async function ingest() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Set GEMINI_API_KEY in your .env file");
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`Created ${DATA_DIR} — place your PDF files there and run again.`);
    return;
  }

  const pdfFiles = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".pdf"));
  if (pdfFiles.length === 0) {
    console.log("No PDF files found in data/ directory. Add PDFs and run again.");
    return;
  }

  console.log(`Found ${pdfFiles.length} PDF(s). Processing...`);

  const allChunks = [];
  for (const file of pdfFiles) {
    console.log(`  Extracting: ${file}`);
    const text = await extractTextFromPDF(path.join(DATA_DIR, file));
    const chunks = chunkText(text, file);
    allChunks.push(...chunks);
    console.log(`  → ${chunks.length} chunks from ${file}`);
  }

  console.log(`Total chunks: ${allChunks.length}. Generating embeddings...`);

  const embeddings = [];
  const BATCH_SIZE = 5;
  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    const batchEmbeddings = await Promise.all(
      batch.map((chunk) => getEmbedding(genAI, chunk.text))
    );
    embeddings.push(...batchEmbeddings);
    process.stdout.write(`\r  Embedded ${embeddings.length}/${allChunks.length}`);
  }
  console.log();

  const dimension = embeddings[0].length;
  const index = new IndexFlatL2(dimension);
  for (const emb of embeddings) {
    index.add(emb);
  }

  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });

  index.write(path.join(STORE_DIR, "faiss.index"));
  fs.writeFileSync(
    path.join(STORE_DIR, "chunks.json"),
    JSON.stringify(allChunks, null, 2)
  );

  console.log(`Done. Index saved to store/ (${allChunks.length} chunks, ${dimension}D)`);
}

ingest().catch(console.error);
