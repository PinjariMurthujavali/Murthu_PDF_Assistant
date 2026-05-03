# Murthu_PDF_Assistant
# DocMind — AI Document Intelligence System

A production-ready, fully browser-based PDF QA system with TF-IDF semantic search, chunking, and an intelligent chat interface.

## 📁 Project Structure

```
docmind/
├── index.html     ← Main HTML shell & layout
├── style.css      ← Full design system (dark theme, glassmorphism)
├── app.js         ← Core engine: PDF parsing, TF-IDF, QA, UI
└── README.md      ← This file
```

## 🚀 Run Locally

Just open `index.html` in any modern browser. No server needed.

```bash
# Option 1: Direct open
open index.html

# Option 2: Simple HTTP server (recommended)
npx serve .
# or
python3 -m http.server 8080
# then visit http://localhost:8080
```

## 🌐 Deploy to GitHub Pages

1. Create a new GitHub repository
2. Push all files:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: DocMind AI QA System"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/docmind.git
   git push -u origin main
   ```
3. Go to **Settings → Pages → Source: Deploy from branch → main / root**
4. Your app will be live at `https://YOUR_USERNAME.github.io/docmind/`

## ✨ Features

- **Multi-PDF Upload** — drag & drop or browse, processes multiple files
- **Smart Chunking** — section-aware text splitting with overlap
- **TF-IDF + BM25 Scoring** — dual-ranking retrieval system
- **Cosine Similarity** — semantic-style vector matching
- **Cross-Reference Detection** — spans answers across multiple documents
- **Acronym Detection** — extracts and tracks uppercase abbreviations
- **Confidence Scoring** — per-answer confidence percentage
- **Source Citations** — page + section reference for every answer
- **Chat History** — persisted via localStorage
- **Responsive** — works on mobile and desktop

## 🧠 Architecture

```
PDF File
  └─ PDF.js → Raw Page Texts
       └─ Section Detector → Structured Sections
            └─ Chunker (400-word windows, 50-word overlap)
                 └─ TF-IDF Builder (term frequency × inverse doc freq)
                      └─ Query Vectorizer
                           └─ BM25 + Cosine Similarity Scorer
                                └─ Answer Generator (sentence extraction)
                                     └─ Chat UI Renderer
```

## 📦 Dependencies (CDN, no install needed)

- [PDF.js 3.11](https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js) — PDF parsing
- [Google Fonts](https://fonts.google.com) — Syne, DM Sans, DM Mono

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Parsing | PDF.js (CDN) |
| Search | TF-IDF + BM25 + Cosine Similarity (Vanilla JS) |
| Storage | localStorage (history) |
| UI | Vanilla HTML5 / CSS3 / JS |
| Fonts | Google Fonts (Syne + DM Sans) |
| Backend | **None** |
| API Keys | **None** |
