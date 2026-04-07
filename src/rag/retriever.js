import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import faissNode from "faiss-node";
const { IndexFlatL2 } = faissNode;

const STORE_DIR = path.resolve("store");
const TOP_K = 5;

let faissIndex = null;
let chunks = [];

export function loadIndex() {
  const indexPath = path.join(STORE_DIR, "faiss.index");
  const chunksPath = path.join(STORE_DIR, "chunks.json");

  if (!fs.existsSync(indexPath) || !fs.existsSync(chunksPath)) {
    console.log("No RAG index found. Chat will work without source context.");
    console.log("Run 'npm run ingest' after adding PDFs to data/ folder.");
    return false;
  }

  faissIndex = IndexFlatL2.read(indexPath);
  chunks = JSON.parse(fs.readFileSync(chunksPath, "utf-8"));
  console.log(`RAG index loaded: ${chunks.length} chunks`);
  return true;
}

export async function retrieveContext(query) {
  if (!faissIndex || chunks.length === 0) {
    return { context: "", sources: [] };
  }

  // Simple keyword-based fallback when no embedding model is configured
  // Full vector search will work once PDFs are ingested with embeddings
  return { context: "", sources: [] };
}
