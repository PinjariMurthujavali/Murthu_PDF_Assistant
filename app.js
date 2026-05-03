/* ============================================================
   DocMind — AI Document Intelligence
   app.js — Full QA Engine + UI Controller
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────
// PDF.js init
// ──────────────────────────────────────────────
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────
const State = {
  documents: [],   // { id, name, size, pageCount, chunks: [], sections: [], acronyms: {} }
  chatHistory: [], // { role, content, sources, confidence, time }
  savedHistory: JSON.parse(localStorage.getItem('docmind_history') || '[]'),
};

// ──────────────────────────────────────────────
// Utility Helpers
// ──────────────────────────────────────────────
function genId() {
  return Math.random().toString(36).slice(2, 9);
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
  return Math.floor(d / 86400000) + 'd ago';
}

// ──────────────────────────────────────────────
// Toast Notifications
// ──────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3200) {
  const container = document.getElementById('toastContainer');
  const icons = {
    success: '✓',
    error: '✕',
    info: '◈',
  };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span style="font-size:14px">${icons[type]}</span><span>${escapeHtml(msg)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ──────────────────────────────────────────────
// Status Indicator
// ──────────────────────────────────────────────
function setStatus(text, mode = 'idle') {
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusText');
  dot.className = 'status-dot';
  if (mode === 'active') dot.classList.add('active');
  if (mode === 'processing') dot.classList.add('processing');
  label.textContent = text;
}

// ──────────────────────────────────────────────
// Navigation
// ──────────────────────────────────────────────
function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById(`view-${viewId}`).classList.add('active');
  document.querySelector(`[data-view="${viewId}"]`).classList.add('active');
  if (viewId === 'history') renderHistory();
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

// Sidebar toggle
document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

// ──────────────────────────────────────────────
// TEXT PROCESSING ENGINE
// ──────────────────────────────────────────────

/**
 * Tokenize text: lowercase, strip punctuation, split words
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
}

/** Simple stop-words set */
const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'may','might','shall','can','need','dare','ought','used',
  'to','of','in','for','on','with','as','by','at','from',
  'up','about','into','through','during','before','after',
  'above','below','between','each','these','those','this','that',
  'it','its','and','but','or','nor','so','yet','both','either',
  'not','no','only','own','same','than','then','there','when',
  'where','which','while','who','whom','why','how','all','any',
  'such','more','most','other','some','too','very','just','also',
  'if','else','what','we','i','you','he','she','they','them',
  'our','your','his','her','their','my','me','us','his','its',
]);

function removeStopWords(tokens) {
  return tokens.filter(t => !STOP_WORDS.has(t) && t.length > 2);
}

/**
 * Detect acronyms from text: uppercase 2-6 char tokens
 */
function detectAcronyms(text) {
  const matches = text.match(/\b[A-Z]{2,6}\b/g) || [];
  const freq = {};
  matches.forEach(m => { freq[m] = (freq[m] || 0) + 1; });
  return freq;
}

/**
 * Detect section headings: lines with ALL CAPS, or short lines followed by content,
 * or numbered sections like "1.2 Something"
 */
function detectSections(text) {
  const lines = text.split('\n');
  const sections = [];
  let currentSection = 'Introduction';
  let buffer = [];
  let charOffset = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const isHeading =
      (trimmed.length > 3 && trimmed.length < 80 &&
        (/^[A-Z\d]/.test(trimmed)) &&
        (
          /^\d+[\.\)]\s+\w/.test(trimmed) ||            // numbered section
          /^[A-Z][A-Z\s\d\-:]{3,}$/.test(trimmed) ||   // all caps
          /^(Chapter|Section|Part|Appendix)\s+/i.test(trimmed) ||
          (/^[A-Z]/.test(trimmed) && trimmed.length < 60 && !/[.!?]$/.test(trimmed))
        )
      );

    if (isHeading && buffer.length > 20) {
      sections.push({ title: currentSection, text: buffer.join(' '), startChar: charOffset - buffer.join(' ').length });
      currentSection = trimmed;
      buffer = [];
    } else {
      buffer.push(trimmed);
    }
    charOffset += line.length + 1;
  }
  if (buffer.length > 0) {
    sections.push({ title: currentSection, text: buffer.join(' '), startChar: charOffset - buffer.join(' ').length });
  }
  return sections;
}

/**
 * Chunk a document's text intelligently:
 * - Prefer section boundaries
 * - Target ~300-500 tokens per chunk
 * - Overlap 50 tokens between chunks
 */
function chunkDocument(docText, docName, pageTexts) {
  const chunks = [];
  const targetChunkSize = 400; // words
  const overlap = 50;

  pageTexts.forEach((pageText, pageIdx) => {
    if (!pageText.trim()) return;
    const words = pageText.split(/\s+/);
    const sections = detectSections(pageText);

    if (sections.length > 1) {
      sections.forEach((sec, secIdx) => {
        const secWords = sec.text.split(/\s+/);
        for (let i = 0; i < secWords.length; i += targetChunkSize - overlap) {
          const slice = secWords.slice(i, i + targetChunkSize);
          if (slice.length < 15) continue;
          chunks.push({
            id: genId(),
            docName,
            page: pageIdx + 1,
            section: sec.title,
            text: slice.join(' '),
            words: slice,
            tokens: removeStopWords(tokenize(slice.join(' '))),
          });
        }
      });
    } else {
      for (let i = 0; i < words.length; i += targetChunkSize - overlap) {
        const slice = words.slice(i, i + targetChunkSize);
        if (slice.length < 15) continue;
        chunks.push({
          id: genId(),
          docName,
          page: pageIdx + 1,
          section: 'Content',
          text: slice.join(' '),
          words: slice,
          tokens: removeStopWords(tokenize(slice.join(' '))),
        });
      }
    }
  });

  return chunks;
}

// ──────────────────────────────────────────────
// TF-IDF ENGINE
// ──────────────────────────────────────────────

/**
 * Build TF-IDF corpus from all chunks across all documents
 */
function buildTFIDF(allChunks) {
  const N = allChunks.length;
  if (N === 0) return {};

  // Document Frequency
  const df = {};
  allChunks.forEach(chunk => {
    const unique = new Set(chunk.tokens);
    unique.forEach(term => { df[term] = (df[term] || 0) + 1; });
  });

  // Compute TF-IDF vector for each chunk
  allChunks.forEach(chunk => {
    const tf = {};
    const len = chunk.tokens.length || 1;
    chunk.tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
    const tfidf = {};
    Object.keys(tf).forEach(term => {
      const tfVal = tf[term] / len;
      const idfVal = Math.log((N + 1) / ((df[term] || 0) + 1));
      tfidf[term] = tfVal * idfVal;
    });
    chunk.tfidf = tfidf;
  });

  return df;
}

/**
 * Cosine similarity between two TF-IDF vectors
 */
function cosineSimilarity(vecA, vecB) {
  let dot = 0, magA = 0, magB = 0;
  for (const term in vecA) {
    dot += (vecA[term] || 0) * (vecB[term] || 0);
    magA += vecA[term] ** 2;
  }
  for (const term in vecB) {
    magB += vecB[term] ** 2;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Build query TF-IDF vector using same IDF weights
 */
function queryToTFIDF(queryTokens, df, N) {
  const tf = {};
  const len = queryTokens.length || 1;
  queryTokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
  const vec = {};
  Object.keys(tf).forEach(term => {
    const tfVal = tf[term] / len;
    const idfVal = Math.log((N + 1) / ((df[term] || 0) + 1));
    vec[term] = tfVal * idfVal;
  });
  return vec;
}

/**
 * Keyword bonus: fraction of query keywords present in chunk
 */
function keywordBonus(queryTokens, chunkText) {
  const lower = chunkText.toLowerCase();
  const hits = queryTokens.filter(t => lower.includes(t));
  return hits.length / (queryTokens.length || 1);
}

/**
 * BM25 scoring (simplified)
 */
function bm25Score(queryTokens, chunkTokens, df, N, k1 = 1.5, b = 0.75) {
  const avgLen = 300;
  const dl = chunkTokens.length;
  const tf = {};
  chunkTokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
  let score = 0;
  queryTokens.forEach(term => {
    if (!tf[term]) return;
    const idf = Math.log((N - (df[term] || 0) + 0.5) / ((df[term] || 0) + 0.5) + 1);
    const tfNorm = (tf[term] * (k1 + 1)) / (tf[term] + k1 * (1 - b + b * dl / avgLen));
    score += idf * tfNorm;
  });
  return score;
}

/**
 * Retrieve top-K most relevant chunks for a query
 */
function retrieveChunks(query, topK = 5) {
  const allChunks = State.documents.flatMap(d => d.chunks);
  if (allChunks.length === 0) return [];

  const df = buildTFIDF(allChunks);
  const N = allChunks.length;
  const queryTokensRaw = tokenize(query);
  const queryTokens = removeStopWords(queryTokensRaw);

  if (queryTokens.length === 0) return [];

  const queryVec = queryToTFIDF(queryTokens, df, N);

  const scored = allChunks.map(chunk => {
    const cos = cosineSimilarity(queryVec, chunk.tfidf || {});
    const bm = bm25Score(queryTokens, chunk.tokens, df, N);
    const kw = keywordBonus(queryTokens, chunk.text);
    const combined = cos * 0.4 + (bm / 10) * 0.4 + kw * 0.2;
    return { chunk, score: combined };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(s => s.score > 0.005)
    .map(s => ({ ...s.chunk, score: s.score }));
}

// ──────────────────────────────────────────────
// ANSWER GENERATION
// ──────────────────────────────────────────────

/**
 * Build a natural language answer from top chunks
 */
function generateAnswer(query, topChunks) {
  if (topChunks.length === 0) {
    return {
      text: "I couldn't find relevant information in your uploaded documents to answer this question. Try rephrasing, or make sure the relevant document is uploaded.",
      sources: [],
      confidence: 0,
    };
  }

  const queryLower = query.toLowerCase();
  const queryWords = tokenize(query);

  // Deduplicate chunks by content similarity
  const unique = [];
  topChunks.forEach(chunk => {
    const isDupe = unique.some(u =>
      u.docName === chunk.docName && u.page === chunk.page && u.section === chunk.section
    );
    if (!isDupe) unique.push(chunk);
  });

  // Extract relevant sentences from each chunk
  const extractedSentences = [];
  unique.slice(0, 3).forEach(chunk => {
    const sentences = chunk.text
      .split(/(?<=[.!?])\s+/)
      .filter(s => s.trim().length > 20);

    const scored = sentences.map(sent => {
      const sLower = sent.toLowerCase();
      const hits = queryWords.filter(w => sLower.includes(w));
      return { sent, hits: hits.length };
    });

    const best = scored
      .filter(s => s.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 3)
      .map(s => s.sent);

    if (best.length > 0) {
      extractedSentences.push({ sentences: best, chunk });
    } else {
      // Take first 2 sentences even if no keyword match
      extractedSentences.push({ sentences: sentences.slice(0, 2), chunk });
    }
  });

  // Compose answer text
  let answer = '';

  // Detect question type
  const isWhat = /^what\b/.test(queryLower);
  const isHow = /^how\b/.test(queryLower);
  const isWhy = /^why\b/.test(queryLower);
  const isList = /list|enumerate|what are|types of|kinds of|examples/.test(queryLower);
  const isDefine = /define|meaning|what is|what does|stand for/.test(queryLower);
  const isCompare = /compare|difference|vs|versus|contrast/.test(queryLower);
  const isSummary = /summar|overview|explain|describe/.test(queryLower);

  if (extractedSentences.length === 0) {
    answer = unique[0].text.split(/(?<=[.!?])\s+/).slice(0, 3).join(' ');
  } else if (isList) {
    answer = extractedSentences.flatMap(e => e.sentences).slice(0, 5).join(' ');
  } else if (isCompare) {
    answer = `Based on the documents:\n\n${extractedSentences.map(e => `**${e.chunk.docName} (p.${e.chunk.page})**: ${e.sentences.join(' ')}`).join('\n\n')}`;
  } else if (isSummary) {
    answer = extractedSentences.flatMap(e => e.sentences).join(' ');
    if (answer.length > 800) answer = answer.slice(0, 800) + '…';
  } else {
    answer = extractedSentences.flatMap(e => e.sentences).slice(0, 6).join(' ');
  }

  // Check for cross-doc references
  const docNames = [...new Set(unique.map(c => c.docName))];
  if (docNames.length > 1) {
    answer = `**Cross-document insight** from ${docNames.length} sources:\n\n` + answer;
  }

  // Acronym expansion
  const acronyms = {};
  State.documents.forEach(d => Object.assign(acronyms, d.acronyms));
  const foundAcronyms = (answer.match(/\b[A-Z]{2,6}\b/g) || [])
    .filter((v, i, a) => a.indexOf(v) === i)
    .filter(a => acronyms[a]);
  if (foundAcronyms.length > 0) {
    const note = foundAcronyms.map(a => `${a} (mentioned ${acronyms[a]}× in docs)`).join(', ');
    answer += `\n\n*Detected acronyms: ${note}*`;
  }

  // Sources
  const sources = unique.slice(0, 4).map(chunk => ({
    docName: chunk.docName,
    page: chunk.page,
    section: chunk.section,
    score: chunk.score,
  }));

  // Confidence: based on top score & number of matching chunks
  const topScore = unique[0]?.score || 0;
  const confidence = Math.min(0.98, topScore * 3.5 + (unique.length > 2 ? 0.1 : 0));

  return { text: answer.trim(), sources, confidence };
}

// ──────────────────────────────────────────────
// PDF PARSING
// ──────────────────────────────────────────────
async function parsePDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];
  let fullText = '';

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();

    // Extract text with position awareness
    const items = tc.items;
    let pageText = '';
    let lastY = null;
    items.forEach(item => {
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
        pageText += '\n';
      }
      pageText += item.str + ' ';
      lastY = item.transform[5];
    });
    pageTexts.push(pageText);
    fullText += pageText + '\n';
  }

  return { pageTexts, fullText, pageCount: pdf.numPages };
}

// ──────────────────────────────────────────────
// DOCUMENT MANAGER
// ──────────────────────────────────────────────

async function processFile(file, queueItemEl) {
  const updateProgress = (pct, label) => {
    const bar = queueItemEl.querySelector('.queue-item-progress');
    const status = queueItemEl.querySelector('.queue-item-status');
    if (bar) bar.style.width = pct + '%';
    if (status) status.textContent = label;
  };

  try {
    updateProgress(10, 'Reading…');
    await delay(50);

    updateProgress(25, 'Parsing PDF…');
    const { pageTexts, fullText, pageCount } = await parsePDF(file);

    updateProgress(55, 'Chunking…');
    await delay(30);
    const chunks = chunkDocument(fullText, file.name, pageTexts);

    updateProgress(75, 'Building index…');
    await delay(30);
    const acronyms = detectAcronyms(fullText);
    const sections = detectSections(fullText);

    updateProgress(95, 'Indexing…');
    await delay(30);

    const doc = {
      id: genId(),
      name: file.name,
      size: file.size,
      pageCount,
      chunks,
      sections,
      acronyms,
      addedAt: Date.now(),
    };

    State.documents.push(doc);
    updateProgress(100, '✓ Done');
    queueItemEl.querySelector('.queue-item-status').className = 'queue-item-status done';

    return doc;
  } catch (err) {
    updateProgress(100, '✕ Error');
    queueItemEl.querySelector('.queue-item-status').className = 'queue-item-status error';
    throw err;
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ──────────────────────────────────────────────
// UI: Upload Zone
// ──────────────────────────────────────────────
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

document.getElementById('uploadClick').addEventListener('click', e => {
  e.stopPropagation();
  fileInput.click();
});
uploadZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => handleFiles([...fileInput.files]));

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const files = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf');
  if (files.length) handleFiles(files);
  else showToast('Only PDF files are supported', 'error');
});

async function handleFiles(files) {
  if (!files.length) return;

  const pdfFiles = files.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
  if (pdfFiles.length === 0) { showToast('Please upload PDF files', 'error'); return; }

  // Show queue
  const queueEl = document.getElementById('processingQueue');
  const queueItems = document.getElementById('queueItems');
  queueEl.style.display = 'block';
  document.getElementById('queueCount').textContent = `${pdfFiles.length} file${pdfFiles.length > 1 ? 's' : ''}`;

  setStatus('Processing…', 'processing');

  const itemEls = pdfFiles.map(file => {
    const el = document.createElement('div');
    el.className = 'queue-item';
    el.innerHTML = `
      <div class="queue-item-icon">📄</div>
      <div class="queue-item-info">
        <div class="queue-item-name">${escapeHtml(file.name)}</div>
        <div class="queue-item-progress-wrap">
          <div class="queue-item-progress"></div>
        </div>
      </div>
      <div class="queue-item-status">Waiting…</div>
    `;
    queueItems.appendChild(el);
    return el;
  });

  let successCount = 0;
  for (let i = 0; i < pdfFiles.length; i++) {
    try {
      await processFile(pdfFiles[i], itemEls[i]);
      successCount++;
    } catch (err) {
      console.error('Error processing:', pdfFiles[i].name, err);
      showToast(`Failed to process ${pdfFiles[i].name}`, 'error');
    }
  }

  setStatus(`${State.documents.length} doc${State.documents.length > 1 ? 's' : ''} loaded`, 'active');
  updateDocCount();
  renderSidebarDocs();
  renderDocsGrid();
  showToast(`${successCount} document${successCount > 1 ? 's' : ''} indexed successfully`, 'success');
  fileInput.value = '';
}

// ──────────────────────────────────────────────
// UI: Doc Grid
// ──────────────────────────────────────────────
function renderDocsGrid() {
  const gridSection = document.getElementById('docsGridSection');
  const grid = document.getElementById('docsGrid');

  if (State.documents.length === 0) {
    gridSection.style.display = 'none';
    return;
  }
  gridSection.style.display = 'block';

  grid.innerHTML = State.documents.map(doc => `
    <div class="doc-card" data-id="${doc.id}">
      <button class="doc-card-remove" data-id="${doc.id}" title="Remove document">×</button>
      <div class="doc-card-header">
        <div class="doc-card-icon">📄</div>
        <div class="doc-card-meta">
          <div class="doc-card-name">${escapeHtml(doc.name)}</div>
          <div class="doc-card-size">${formatBytes(doc.size)}</div>
        </div>
      </div>
      <div class="doc-card-stats">
        <div class="doc-stat"><span class="doc-stat-label">Pages:</span> ${doc.pageCount}</div>
        <div class="doc-stat"><span class="doc-stat-label">Chunks:</span> ${doc.chunks.length}</div>
        <div class="doc-stat"><span class="doc-stat-label">Sections:</span> ${doc.sections.length}</div>
        <div class="doc-stat"><span class="doc-stat-label">Acronyms:</span> ${Object.keys(doc.acronyms).length}</div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.doc-card-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removeDocument(btn.dataset.id);
    });
  });
}

function removeDocument(id) {
  State.documents = State.documents.filter(d => d.id !== id);
  updateDocCount();
  renderSidebarDocs();
  renderDocsGrid();
  updateChatSubtitle();
  if (State.documents.length === 0) setStatus('Ready', 'idle');
}

function renderSidebarDocs() {
  const list = document.getElementById('docList');
  if (State.documents.length === 0) {
    list.innerHTML = '<div class="doc-empty">No documents yet</div>';
    return;
  }
  list.innerHTML = State.documents.map(doc => `
    <div class="doc-list-item" title="${escapeHtml(doc.name)}">
      <span class="doc-list-icon">📄</span>
      <span class="doc-list-name">${escapeHtml(doc.name.replace('.pdf', ''))}</span>
      <span class="doc-list-pages">${doc.pageCount}p</span>
    </div>
  `).join('');
}

function updateDocCount() {
  document.getElementById('docCountBadge').textContent = State.documents.length;
}

document.getElementById('clearAllDocs').addEventListener('click', () => {
  if (!State.documents.length) return;
  State.documents = [];
  updateDocCount();
  renderSidebarDocs();
  renderDocsGrid();
  updateChatSubtitle();
  setStatus('Ready', 'idle');
  document.getElementById('processingQueue').style.display = 'none';
  document.getElementById('queueItems').innerHTML = '';
  showToast('All documents cleared', 'info');
});

document.getElementById('goToChat').addEventListener('click', () => showView('chat'));

// ──────────────────────────────────────────────
// UI: Chat
// ──────────────────────────────────────────────
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const chatMessages = document.getElementById('chatMessages');

chatInput.addEventListener('input', () => {
  sendBtn.disabled = !chatInput.value.trim() || State.documents.length === 0;
  // Auto-resize
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
});

chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

function updateChatSubtitle() {
  const el = document.getElementById('chatSubtitle');
  if (State.documents.length === 0) {
    el.textContent = 'Upload documents to start asking questions';
  } else {
    el.textContent = `Analyzing ${State.documents.length} document${State.documents.length > 1 ? 's' : ''} · ${State.documents.reduce((a,d) => a + d.chunks.length, 0)} chunks indexed`;
  }
  sendBtn.disabled = !chatInput.value.trim() || State.documents.length === 0;
}

// Generate suggested questions based on loaded docs
function updateSuggestedQuestions() {
  const grid = document.getElementById('suggestionsGrid');
  const generic = [
    'Summarize the main topics',
    'What are the key findings?',
    'List all section headings',
    'What acronyms are used?',
    'What is discussed in the conclusion?',
  ];
  const suggestions = State.documents.length === 0 ? generic : [
    `Summarize ${State.documents[0].name.replace('.pdf','').slice(0,25)}`,
    'What are the main conclusions?',
    'List all key terms and definitions',
    'What recommendations are made?',
    'Explain the methodology used',
  ];
  grid.innerHTML = suggestions.map(q => `
    <div class="suggestion-chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</div>
  `).join('');
  grid.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chatInput.value = chip.dataset.q;
      chatInput.dispatchEvent(new Event('input'));
      if (State.documents.length > 0) sendMessage();
    });
  });
}

updateSuggestedQuestions();

async function sendMessage() {
  const query = chatInput.value.trim();
  if (!query || State.documents.length === 0) return;

  // Clear welcome
  const welcome = chatMessages.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  // Add user message
  appendMessage('user', query, [], 0);
  State.chatHistory.push({ role: 'user', content: query, time: Date.now() });

  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;

  // Thinking indicator
  const thinkingId = 'thinking-' + genId();
  chatMessages.insertAdjacentHTML('beforeend', `
    <div class="message assistant" id="${thinkingId}">
      <div class="message-header">
        <div class="message-avatar">◈</div>
        <span class="message-sender">DocMind</span>
      </div>
      <div class="thinking">
        <div class="thinking-dots">
          <div class="thinking-dot"></div>
          <div class="thinking-dot"></div>
          <div class="thinking-dot"></div>
        </div>
        <span class="thinking-text">Searching ${State.documents.reduce((a,d)=>a+d.chunks.length,0)} chunks…</span>
      </div>
    </div>
  `);
  scrollToBottom();

  // Process (slight delay for UX)
  await delay(400 + Math.random() * 300);

  const chunks = retrieveChunks(query, 6);
  const { text, sources, confidence } = generateAnswer(query, chunks);

  // Remove thinking
  document.getElementById(thinkingId)?.remove();

  // Add answer
  appendMessage('assistant', text, sources, confidence);
  const entry = { role: 'assistant', content: text, sources, confidence, query, time: Date.now() };
  State.chatHistory.push(entry);

  // Save to history
  State.savedHistory.unshift({ query, answer: text, sources, confidence, time: Date.now() });
  if (State.savedHistory.length > 100) State.savedHistory.pop();
  localStorage.setItem('docmind_history', JSON.stringify(State.savedHistory));

  scrollToBottom();
}

function appendMessage(role, text, sources = [], confidence = 0) {
  const isUser = role === 'user';
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const formattedText = formatMessageText(text);

  const sourcesHtml = sources.length ? `
    <div class="message-sources">
      ${sources.map(s => `
        <div class="source-chip" title="Page ${s.page}, Section: ${s.section}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          ${escapeHtml(s.docName.replace('.pdf','').slice(0,20))} · p.${s.page}
        </div>
      `).join('')}
    </div>
  ` : '';

  const confPct = Math.round(confidence * 100);
  const confColor = confidence > 0.65 ? '#4ade80' : confidence > 0.35 ? '#facc15' : '#f87171';
  const confHtml = !isUser && sources.length ? `
    <div class="confidence-bar">
      <span class="confidence-label">Confidence:</span>
      <div class="confidence-track">
        <div class="confidence-fill" style="width:${confPct}%;background:${confColor}"></div>
      </div>
      <span class="confidence-label">${confPct}%</span>
    </div>
  ` : '';

  const html = `
    <div class="message ${role}">
      <div class="message-header">
        ${isUser
          ? `<span class="message-time">${time}</span><span class="message-sender">You</span><div class="message-avatar">U</div>`
          : `<div class="message-avatar">◈</div><span class="message-sender">DocMind</span><span class="message-time">${time}</span>`
        }
      </div>
      <div class="message-body">${formattedText}</div>
      ${sourcesHtml}
      ${confHtml}
    </div>
  `;
  chatMessages.insertAdjacentHTML('beforeend', html);
}

function formatMessageText(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

function scrollToBottom() {
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
}

document.getElementById('clearChat').addEventListener('click', () => {
  State.chatHistory = [];
  chatMessages.innerHTML = '';
  chatMessages.insertAdjacentHTML('beforeend', `
    <div class="chat-welcome">
      <div class="welcome-icon">◈</div>
      <h3>Ready to analyze your documents</h3>
      <p>Upload PDFs and ask me anything — I'll find answers with exact source references.</p>
      <div class="suggested-questions" id="suggestedQuestions">
        <div class="suggestions-label">Try asking:</div>
        <div class="suggestions-grid" id="suggestionsGrid"></div>
      </div>
    </div>
  `);
  updateSuggestedQuestions();
  showToast('Conversation cleared', 'info');
});

// ──────────────────────────────────────────────
// UI: History
// ──────────────────────────────────────────────
function renderHistory() {
  const list = document.getElementById('historyList');
  if (State.savedHistory.length === 0) {
    list.innerHTML = `
      <div class="history-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <p>No chat history yet</p>
      </div>
    `;
    return;
  }
  list.innerHTML = State.savedHistory.map((item, i) => `
    <div class="history-item" data-i="${i}">
      <div class="history-item-q">${escapeHtml(item.query)}</div>
      <div class="history-item-a">${escapeHtml(item.answer.replace(/<[^>]+>/g,''))}</div>
      <div class="history-item-meta">
        <span class="history-meta-tag">${timeAgo(item.time)}</span>
        ${item.sources?.length ? `<span class="history-meta-tag">${item.sources.length} source${item.sources.length>1?'s':''}</span>` : ''}
        ${item.confidence ? `<span class="history-meta-tag">${Math.round(item.confidence*100)}% confidence</span>` : ''}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', () => {
      const entry = State.savedHistory[parseInt(item.dataset.i)];
      chatInput.value = entry.query;
      showView('chat');
      if (State.documents.length > 0) {
        setTimeout(() => { if (!sendBtn.disabled) sendMessage(); }, 100);
      }
    });
  });
}

document.getElementById('clearHistory').addEventListener('click', () => {
  State.savedHistory = [];
  localStorage.removeItem('docmind_history');
  renderHistory();
  showToast('History cleared', 'info');
});

// ──────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────
function init() {
  updateDocCount();
  updateChatSubtitle();
  updateSuggestedQuestions();

  // Check PDF.js
  if (typeof pdfjsLib === 'undefined') {
    showToast('PDF.js failed to load. Please check your internet connection.', 'error', 6000);
  } else {
    setStatus('Ready', 'idle');
  }

  // Mobile sidebar backdrop
  const sidebar = document.getElementById('sidebar');
  document.addEventListener('click', e => {
    if (window.innerWidth <= 768 && sidebar.classList.contains('collapsed') === false) {
      if (!sidebar.contains(e.target)) {
        sidebar.classList.add('mobile-hidden');
      }
    }
  });
}

init();
