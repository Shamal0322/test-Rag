# NIM Document Research Assistant

Ein portabler dokumentenbasierter RAG Assistent, der Dokumente verarbeitet, NVIDIA NIM Embeddings verwendet, Chunks in Qdrant speichert und Fragen mit Quellenbelegen beantwortet.

## What This Project Demonstrates

- Eine nachvollziehbare RAG Kernpipeline ohne LangChain, LlamaIndex oder Haystack.
- Dokument-Ingestion mit Upload, Text Extraction, Chunking, Embeddings und Vector Indexing.
- NVIDIA NIM für Embeddings und Chat Completions über OpenAI-kompatible Endpoints.
- Qdrant als lokaler Vector Store über Docker Compose.
- Quellenbasierte Antwortgenerierung mit Confidence Logic und Grounding Validation.
- Transparenz über Dokumentdetails, Chunk Previews, Reindexing und Eval-Fragen.

Die Pipeline ist bewusst ohne große RAG Frameworks gebaut. Dadurch bleiben Retrieval, Prompting, Grounding und Fehlerbehandlung im Code sichtbar.

## Features

- Upload von PDF, TXT und Markdown
- Lokale Upload-Ablage unter `storage/uploads`
- PDF Text Extraction mit `pdfjs-dist` und einfacher Spaltensortierung
- Chunking mit Overlap
- NVIDIA NIM Embedding Client mit kleinen Batches und Retry
- Qdrant Collection Setup mit Vector-Dimension-Check
- SQLite Metadaten über Prisma
- Search API für semantische Suche
- Answer API mit automatischer Suche über alle Dokumente, optionalen Dokumentfiltern, Quellen, Confidence und Grounding Validation
- Document Level Ranking, Ambiguity Detection und Compare Mode gegen vermischte Antworten
- Konfigurierbares, absatz- und satzbewusstes Chunking mit moderatem PDF Text Cleaning
- Strenge Context Selection mit Mindestscore, Dedupe, Dokumentlimit und kleinem Prompt-Kontext
- Dokumentliste, Statusanzeige, Detailansicht und Reindex
- Demo-Dokumente und Eval-Script

## Tech Stack

- Next.js App Router
- TypeScript
- React
- Prisma
- SQLite
- Qdrant
- Docker Compose
- NVIDIA NIM Embeddings
- NVIDIA NIM Chat Completions

## Architecture Overview

```text
User
-> Next.js UI
-> API Routes
-> Document Processor
-> Text Extraction
-> Chunking
-> NVIDIA NIM Embeddings
-> Qdrant Vector Store
-> NVIDIA NIM LLM
-> Answer with Sources
```

SQLite speichert Dokument- und Chunk-Metadaten. Qdrant speichert Vektoren und Quellen-Payloads. Vollständige Chunk-Texte bleiben in SQLite.

## Ingestion Flow

1. Nutzer lädt PDF, TXT oder Markdown hoch.
2. Upload API prüft Dateigröße, Dateiendung und MIME Type.
3. Datei wird lokal gespeichert.
4. Prisma legt ein `Document` mit Status `uploaded` an.
5. Die Pipeline setzt Status: `parsing`, `chunking`, `embedding`, `indexed` oder `failed`.
6. PDF Text wird moderat bereinigt, z. B. offensichtliche Seitenzahlen und wiederholte kurze Header/Footer.
7. Text wird absatz- und satzbewusst in Chunks zerlegt.
8. Kleine Chunks werden nach Möglichkeit mit Nachbartext zusammengeführt.
9. Chunks werden in SQLite gespeichert.
10. NVIDIA NIM erzeugt Embeddings.
11. Qdrant speichert Vektoren mit Payload.
12. Dokumentdetails speichern Zeichenanzahl, Chunkanzahl, Embedding-Modell und Zeiten.

## Chunking Strategy

Das Chunking ist über `src/lib/rag/config.ts` steuerbar. Die Standardwerte sind auf kurze echte PDFs und gemischte Dokumentsets ausgelegt:

- Zielgröße: ca. 1800 Zeichen
- Overlap: ca. 300 Zeichen
- Minimum: 450 Zeichen
- Maximum: 2400 Zeichen

Der Chunker schneidet bevorzugt an Absatzenden, danach an Satzgrenzen und nur als letzte Option hart an Zeichenpositionen. Overlap startet möglichst an Satz-, Absatz- oder Wortgrenzen. Dadurch entstehen mehr, aber präzisere Vektor-Treffer in Qdrant.

Mehr Chunks in Qdrant bedeutet nicht mehr Kontext im Prompt: Das LLM bekommt standardmäßig maximal 5 finale Chunks und maximal 2 Chunks pro Dokument. Das macht Antworten schneller und reduziert die Vermischung ähnlicher Themen wie Kosten, Gehalt oder Preise.

## Answer Flow

1. Frage wird validiert.
2. Wenn keine indexierten Dokumente existieren, wird kein LLM aufgerufen.
3. Query Embedding wird mit demselben Embedding Client erzeugt.
4. Qdrant Retrieval und einfache Keyword-Suche werden kombiniert. Ohne `documentIds` werden alle indexierten Dokumente durchsucht.
5. Chunks werden aus SQLite geladen und pro Dokument gerankt.
6. Treffer unter `RAG_MIN_SCORE` werden entfernt.
7. Doppelte oder sehr ähnliche Quellen werden dedupliziert.
8. Pro Dokument und insgesamt wird der finale Kontext begrenzt.
9. Ambiguity Detection prüft, ob mehrere Dokumente ähnlich relevant sind.
10. Bei starker Mehrdeutigkeit wird keine unnötige LLM Anfrage gestellt, sondern eine Klärung mit Dokumentoptionen zurückgegeben.
11. Confidence Logic bewertet die finale Quellenlage.
12. Bei niedriger Confidence wird keine freie Antwort generiert.
13. Prompt Builder formatiert Quellen als `[S1]`, `[S2]` und trennt Aussagen nach Dokument.
14. NVIDIA NIM Chat Completions erzeugt eine Antwort.
15. Grounding Validation prüft Quellenreferenzen und erfundene Quellen IDs.
16. Die API gibt Antwort, Quellen, gruppierte Quellen, Document Ranking, Confidence, `debug` und `confidenceReason` zurück.

## Retrieval Scope

Standardmäßig sucht das System automatisch über alle indexierten Dokumente. Der Nutzer muss also nicht vorher wissen, in welcher Datei die Antwort steht.

Optional kann die UI den Suchbereich auf ausgewählte Dokumente eingrenzen. Diese Auswahl ist ein Filter, keine Pflicht. Die APIs akzeptieren dafür:

```json
{
  "question": "string",
  "documentIds": ["document-id"],
  "mode": "auto"
}
```

Wenn `documentIds` fehlen oder leer sind, wird über alle indexierten Dokumente gesucht. `mode: "compare"` erlaubt ausdrücklich dokumentübergreifende Antworten und strukturiert die Antwort nach Dokumenten.

## Document Ranking and Ambiguity

Nach dem Retrieval gruppiert `src/lib/rag/documentRanking.ts` Treffer nach `documentId`. Der Score kombiniert besten Chunk Score, Top-3-Durchschnitt, Anzahl relevanter Treffer und einfache Begriffsüberschneidungen mit der Frage.

`src/lib/rag/ambiguity.ts` erkennt mehrdeutige Fragen, wenn mehrere Dokumente ähnlich stark ranken, keine Vergleichsfrage gestellt wurde und kein konkretes Dokument genannt ist. Dann antwortet die API mit `ambiguity: true`, den Top-Dokumenten und einer kurzen Klärung statt einer gemischten LLM Antwort.

Quellen werden zusätzlich als `sourceGroups` nach Dokument gruppiert, damit die UI klar zeigt, aus welchem Dokument jede Stelle stammt.

## Context Selection

`src/lib/rag/selectContextSources.ts` ist die zentrale Stelle für den finalen LLM Kontext. Die Auswahl arbeitet in dieser Reihenfolge:

- Kandidaten mit `RAG_RETRIEVAL_LIMIT` holen
- Quellen unter `RAG_MIN_SCORE` entfernen
- gleiche oder sehr ähnliche Chunks über `src/lib/rag/dedupeSources.ts` reduzieren
- maximal `RAG_MAX_CHUNKS_PER_DOCUMENT` Chunks pro Dokument verwenden
- maximal `RAG_CONTEXT_LIMIT` Chunks an das LLM geben

Die API gibt Debug-Metadaten wie `retrievedCount`, `afterDedupeCount`, `finalContextCount`, `retrievalDurationMs` und `llmDurationMs` zurück. Im Frontend werden diese Details nur in Development angezeigt.

## Quality Safeguards

- Keine LLM Anfrage ohne indexierte Dokumente.
- Keine freie Antwort bei Low Confidence.
- Antwort muss Quellenreferenzen wie `[S1]` enthalten.
- Antwort darf nur Quellen IDs verwenden, die im Kontext existieren.
- Ungültige Antworten werden einmal mit strengerem Prompt wiederholt.
- Wenn Validation erneut fehlschlägt, wird eine sichere Fallback-Antwort zurückgegeben.
- NVIDIA API Keys bleiben serverseitig und werden nicht ins Frontend gegeben.

## Setup

```bash
npm install
cp .env.example .env
npm run prisma:push
docker compose up -d qdrant
npm run dev
```

Die App läuft unter:

```text
http://localhost:3000
```

## Environment Variables

```env
DATABASE_URL="file:./dev.db"
NVIDIA_API_KEY=""
NVIDIA_EMBEDDING_BASE_URL="https://integrate.api.nvidia.com/v1"
NVIDIA_EMBEDDING_MODEL="nvidia/nv-embedcode-7b-v1"
NVIDIA_EMBEDDING_TRUNCATE="NONE"
NVIDIA_LLM_BASE_URL="https://integrate.api.nvidia.com/v1"
NVIDIA_LLM_MODEL="mistralai/mistral-large-3-675b-instruct-2512"
QDRANT_URL="http://localhost:6333"
QDRANT_COLLECTION_NAME="nim_document_chunks"
MAX_UPLOAD_MB="20"
RAG_CHUNK_SIZE_CHARS="1800"
RAG_CHUNK_OVERLAP_CHARS="300"
RAG_MIN_CHUNK_CHARS="450"
RAG_MAX_CHUNK_CHARS="2400"
RAG_RETRIEVAL_LIMIT="25"
RAG_CONTEXT_LIMIT="5"
RAG_MAX_CHUNKS_PER_DOCUMENT="2"
RAG_MIN_SCORE="0.45"
RAG_AMBIGUITY_SCORE_DELTA="0.08"
```

`NVIDIA_API_KEY` wird nur serverseitig verwendet. `NVIDIA_LLM_MODEL` ist konfigurierbar und kann durch ein im NVIDIA Build Catalog verfügbares Chat/Instruct Modell ersetzt werden.

Nach Änderungen an Chunking Env Variablen müssen vorhandene Dokumente neu indexiert werden. Reindexing löscht die alten Qdrant Points und SQLite Chunks für das Dokument, parst die Datei erneut, wendet das aktuelle Cleaning und Chunking an und speichert neue Embeddings.

Für kurze PDFs mit 1 bis 2 Seiten sind die Standardwerte oben empfohlen. Wenn Antworten zu breit werden, senke `RAG_CONTEXT_LIMIT` oder `RAG_MAX_CHUNKS_PER_DOCUMENT`; wenn wichtige Details fehlen, prüfe zuerst Reindexing und dann `RAG_MIN_SCORE`.

## Running With Docker

Qdrant starten:

```bash
docker compose up -d qdrant
```

App und Qdrant gemeinsam starten:

```bash
docker compose up --build
```

Der App-Container führt beim Start `prisma db push` aus, damit das SQLite Schema vorhanden ist.

## Running Locally

Für Entwicklung ist der schnellste Workflow:

```bash
docker compose up -d qdrant
npm run dev
```

## Demo Documents and Questions

Demo-Dokumente:

- `demo/documents/sample-company-policy.md`
- `demo/documents/sample-product-manual.md`
- `demo/documents/sample-contract.md`

Demo-Fragen:

- `demo/questions.json`

Die Demo-Dokumente können über die UI hochgeladen werden. Danach lassen sich die Fragen manuell oder per Eval-Script prüfen.

## Evaluation

```bash
npm run eval:rag
```

Das Script läuft gegen eine lokal gestartete App. Es prüft:

- Antwort vorhanden
- Quellen vorhanden
- Confidence gesetzt
- Quellenreferenzen existieren wirklich
- Nicht beantwortbare Fragen werden abgelehnt

Das Script erzeugt keine erfundenen Ergebnisse. Wenn App oder Dokumente fehlen, schlägt es nachvollziehbar fehl.

## Known Limitations

- OCR ist nicht Teil des MVP.
- Gescannten PDFs können nicht zuverlässig verarbeitet werden.
- Authentifizierung war nicht Fokus der Challenge.
- PDF Parsing bleibt bei komplexen Layouts ein Risiko.
- Hintergrundverarbeitung läuft im Next.js Prozess, nicht in einer Worker Queue.
- Confidence Thresholds sind pragmatisch und sollten mit einem größeren Evaluationsset kalibriert werden.

## Tradeoffs

- Kleine Embedding-Batches sind langsamer, aber robuster gegenüber API Limits.
- SQLite ist portabel und einfach, aber nicht für hohe parallele Last gedacht.
- Lokaler Upload Storage ist einfach testbar, ersetzt aber kein Object Storage.
- Keine große RAG Library macht die Pipeline sichtbarer, erfordert aber mehr eigene Fehlerbehandlung.

## Future Improvements

- OCR Worker für gescannte PDFs
- Reranking, z. B. mit NVIDIA NeMo Retriever Reranking
- Persistenter Chat Verlauf
- Workspace- oder User-Support
- Background Job Queue für große Dokumente
- Bessere Evaluation mit Golden Questions und erwarteten Quellen
- Structured Logging und Monitoring
