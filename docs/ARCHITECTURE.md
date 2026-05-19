# Architecture

## System Overview

Der NIM Document Research Assistant ist eine Next.js Anwendung mit serverseitigen API Routes. Die App verarbeitet Dokumente, erzeugt Embeddings über NVIDIA NIM, speichert Vektoren in Qdrant und generiert Antworten über NVIDIA NIM Chat Completions.

Die Architektur ist bewusst explizit gehalten. Es wird keine große RAG Library verwendet, damit Ingestion, Retrieval, Prompting und Validation im Projekt sichtbar bleiben.

## Component Diagram

```text
User
-> Next.js UI
-> API Routes
-> Document Processor
-> Text Extraction
-> Text Cleaning
-> Chunking
-> NVIDIA NIM Embeddings
-> Qdrant
-> Retrieval + Document Ranking
-> Ambiguity Detection
-> Confidence
-> Prompt Builder
-> NVIDIA NIM LLM
-> Grounding Validation
-> Answer with Sources
```

## Data Model

`Document`

- Upload-Metadaten
- Status
- Fehlertext
- Verarbeitungsstatistiken
- Embedding-Modell
- Indexierungszeit

`Chunk`

- `documentId`
- Chunk-Text
- Chunk-Reihenfolge
- geschätzte Tokenzahl
- Qdrant Point ID

`Chat` und `Message`

- vorbereitet für spätere Persistenz
- aktueller UI-Verlauf bleibt im Frontend State

## Document Ingestion Flow

```text
POST /api/upload
-> validate file
-> save file
-> create Document
-> processDocument
   -> parsing
   -> extract text
   -> clean text
   -> chunking
   -> save chunks
   -> embedding
   -> create embeddings
   -> ensure Qdrant collection
   -> upsert vectors
   -> indexed
```

Fehler setzen den Dokumentstatus auf `failed` und speichern eine nutzerlesbare Fehlermeldung.

## Chunking Strategy

Der Chunker nutzt konfigurierbare RAG Parameter aus `src/lib/rag/config.ts`:

- `RAG_CHUNK_SIZE_CHARS`, Standard 1800
- `RAG_CHUNK_OVERLAP_CHARS`, Standard 300
- `RAG_MIN_CHUNK_CHARS`, Standard 450
- `RAG_MAX_CHUNK_CHARS`, Standard 2400

Der Chunker normalisiert Leerzeichen, erkennt Absätze und erhält Überschriften als Teil der folgenden Informationseinheit, soweit die PDF Extraktion sie als Zeilen liefert. Er schließt Chunks bevorzugt an Absatzenden, danach an Satzgrenzen und erst zuletzt an Zeichenpositionen. Chunks unter dem Minimum werden nach Möglichkeit mit vorherigem oder folgendem Text zusammengeführt.

Overlap wird aus dem Ende des vorherigen Chunks gebildet und startet möglichst an Absatz-, Satz- oder Wortgrenzen. Die Tokenzahl wird geschätzt. Das reicht für dieses MVP, weil der Embedding Client mit kleinen Einzelrequests arbeitet.

Mehr Chunks in Qdrant sind gewünscht, solange die Context Selection den Prompt klein hält.

## Text Cleaning

PDF Text wird vor dem Chunking moderat bereinigt:

- übermäßige Leerzeichen und Leerzeilen werden reduziert
- offensichtliche einzelne Seitenzahlen werden entfernt
- sehr häufig wiederholte kurze Zeilen werden als mögliche Header oder Footer entfernt
- inhaltliche Zeilen mit Zahlen oder Satzzeichen werden konservativ behalten

Die Bereinigung ist absichtlich vorsichtig. SQLite bleibt die Quelle der Wahrheit für die erzeugten Chunk-Texte, nicht das Frontend.

## Embedding Strategy

Dokument-Chunks und Fragen verwenden denselben NVIDIA NIM Embedding Client.

- Dokumente: `input_type: "passage"`
- Fragen: `input_type: "query"`
- `encoding_format: "float"`
- `truncate` über Env konfigurierbar

Das Modell kommt aus `NVIDIA_EMBEDDING_MODEL`.

## Qdrant Collection Design

Collection Name:

- `QDRANT_COLLECTION_NAME`

Vector Setup:

- Distance: `Cosine`
- Vector Size: aus erstem Embedding bestimmt
- vorhandene Collection wird auf Vector Size geprüft

Payload:

- `chunkId`
- `documentId`
- `originalName`
- `pageNumber`
- `chunkIndex`
- `preview`

SQLite bleibt die Quelle der Wahrheit für vollständige Chunk-Texte.

## Retrieval Flow

```text
question
-> subquery split
-> query embeddings
-> Qdrant search over all indexed documents or optional documentIds
-> lexical SQLite search over the same scope
-> merge candidates
-> load chunks from SQLite
-> group and rank by document
-> remove low-score candidates
-> dedupe similar sources
-> enforce per-document and total context limits
-> detect ambiguity before LLM call
```

Die hybride Suche hilft bei gemischten Dokumentsets und konkreten Begriffen, ohne eine zusätzliche Search Engine einzuführen.

Standardmäßig sucht Retrieval über alle indexierten Dokumente. `documentIds` sind optional und dienen nur als Filter, wenn der Nutzer die Suche bewusst eingrenzen möchte.

## Document Level Ranking

`src/lib/rag/documentRanking.ts` gruppiert Retrieval Treffer nach Dokument. Der Dokument Score kombiniert:

- bester Chunk Score
- Durchschnitt der besten drei Chunks
- Anzahl relevanter Treffer
- einfache Begriffsüberschneidung mit der Frage

Das Ranking entscheidet, welche Dokumentgruppe im normalen Modus bevorzugt wird und welche Dokumente bei Mehrdeutigkeit in der Klärung erscheinen.

## Ambiguity Detection and Compare Mode

`src/lib/rag/ambiguity.ts` erkennt Fälle, in denen mehrere Dokumente ähnlich relevante Treffer enthalten, die Frage allgemein ist und kein Vergleichsmodus vorliegt. In diesem Fall gibt `/api/answer` `ambiguity: true` zurück und ruft das LLM nicht auf.

Die UI zeigt dann eine Klärungskarte mit Dokumentoptionen und „Alle vergleichen“. Ein Dokumentklick sendet dieselbe Frage mit `documentIds` und `mode: "selected"`. „Alle vergleichen“ sendet `mode: "compare"`.

Compare Mode erlaubt mehrere Dokumente im Kontext. Der Prompt verlangt dann eine Antwort nach Dokumenten und Quellen pro Aussage, damit Inhalte nicht vermischt werden.

## Context Selection and Dedupe

`src/lib/rag/selectContextSources.ts` ist die zentrale Auswahlstelle für Quellen, die an das LLM gehen. Sie nimmt Retrieval Kandidaten, Document Ranking und RAG Config entgegen und gibt `selectedSources` plus Statistik zurück:

- `retrievedCount`
- `afterMinScoreCount`
- `afterDedupeCount`
- `finalContextCount`
- `documentsUsed`
- Drops wegen Mindestscore, Duplikat oder Dokumentlimit

`src/lib/rag/dedupeSources.ts` reduziert gleiche `chunkId`, gleiche `documentId` plus `chunkIndex`, ähnliche Textanfänge auf derselben Seite und fast identische Previews. Die bessere Score-Quelle bleibt erhalten.

Standardmäßig holt Retrieval bis zu 25 Kandidaten, aber der Prompt bekommt höchstens 5 Chunks und höchstens 2 Chunks pro Dokument. Das ist der zentrale Performance-Hebel: mehr präzise Chunks in der Vector DB, weniger und bessere Chunks im LLM Kontext.

## Answer Generation Flow

```text
retrieved chunks
-> document ranking
-> ambiguity check
-> final context limit
-> confidence evaluation
-> block low confidence
-> source formatting [S1], [S2]
-> chat completion
-> grounding validation
-> response with sources
```

Wenn die Quellenlage nicht reicht, wird keine freie Antwort generiert.

## Confidence Logic

`src/lib/rag/confidence.ts` bewertet:

- bester Score
- Anzahl brauchbarer Quellen
- Abstand zwischen Top-Treffern
- ob mehrere Quellen dasselbe Thema stützen

Die API gibt `confidence` und `confidenceReason` zurück.

## Grounding Validation

`src/lib/rag/answerValidator.ts` prüft:

- Antwort ist nicht leer
- Antwort enthält Quellenreferenzen
- Quellen IDs existieren wirklich
- Antwort erfindet keine Quellen IDs
- Low Confidence Antworten bleiben vorsichtig

Bei ungültiger Antwort gibt es einen Retry mit strengerem Prompt. Wenn das erneut fehlschlägt, wird eine sichere Fallback-Antwort zurückgegeben.

## Reindex Flow

```text
POST /api/documents/:id/reindex
-> check document exists
-> refuse if already processing
-> reset status
-> delete old Qdrant vectors and old chunks
-> parse again
-> clean extracted text
-> chunk with current RAG settings
-> embed again
-> upsert again
```

Reindexing ist wichtig, wenn Parsing-, Chunking- oder Embedding-Logik geändert wurde.

Reindexing aktualisiert `chunkCount`, `extractedChars`, `embeddingModel`, `indexedAt`, `processingStartedAt` und `processingFinishedAt`. Nach Änderungen an Chunking Env Variablen müssen vorhandene Dokumente neu indexiert werden, weil alte Chunks und Vektoren sonst weiterhin nach den alten Regeln in SQLite und Qdrant liegen.

## Performance Notes

- `RAG_RETRIEVAL_LIMIT` darf größer sein, weil Qdrant Kandidaten billig liefert.
- `RAG_CONTEXT_LIMIT` hält LLM Latenz und Promptkosten klein.
- `RAG_MAX_CHUNKS_PER_DOCUMENT` reduziert die Vermischung ähnlicher Themen aus mehreren Dokumenten.
- `RAG_MIN_SCORE` verhindert, dass schwache Treffer in den Prompt gelangen.
- Debug Werte werden ohne Dokumentvolltexte zurückgegeben und in der UI nur in Development angezeigt.

## Error Handling

- Upload-Fehler werden mit 400 beantwortet.
- Fehlende Dokumente liefern 404.
- Reindex während laufender Verarbeitung liefert 409.
- NVIDIA Fehler werden ohne API Key ausgegeben.
- Dokumentverarbeitung speichert Fehler im `Document.errorMessage`.
- Die UI zeigt Dokumentfehler und Answer-Fehler sichtbar an.

## Security Notes

- Uploadgröße wird über `MAX_UPLOAD_MB` begrenzt.
- Dateiendung und MIME Type werden geprüft.
- Dateinamen werden sanitized.
- Uploads werden unter `storage/uploads` gespeichert.
- NVIDIA API Keys bleiben serverseitig.
- Es werden keine Secrets ins Frontend gegeben.

## Extension Points

- OCR Worker für gescannte PDFs
- Reranking mit NVIDIA NeMo Retriever Reranking
- Persistenter Chat Verlauf
- Worker Queue für große Dokumente
- Object Storage statt lokalem Dateisystem
- Workspace- oder User-Modell
- Strukturierte Logs und Monitoring
