# NVIDIA NIM Document Research Assistant

Portabler RAG Assistent für dokumentenbasierte Recherche mit Quellenprüfung.

## Kurzbeschreibung

Dieses Projekt ist ein dokumentenbasierter KI Recherche Assistent. Nutzer können PDF-, TXT- und Markdown-Dateien hochladen, indexieren und anschließend Fragen dazu stellen. Die Antworten werden aus gefundenen Quellen generiert und mit Quellenverweisen angezeigt.

## Problem

Viele KI-Demos beantworten Fragen frei, ohne nachvollziehbar zu machen, worauf die Antwort basiert. Für dokumentenbasierte Recherche ist das nicht ausreichend. Entscheidend ist, ob die Antwort aus den hochgeladenen Dokumenten ableitbar ist und welche Quellen verwendet wurden.

## Lösung

Das System verarbeitet Dokumente in einer eigenen RAG Pipeline:

- Text extrahieren
- Inhalte in Chunks zerlegen
- Embeddings mit NVIDIA NIM erzeugen
- Vektoren in Qdrant speichern
- relevante Chunks suchen
- Antwort mit NVIDIA NIM Chat Completions generieren
- Antwort auf Quellenbezug validieren

## Technische Umsetzung

Das Projekt basiert auf Next.js, TypeScript, Prisma, SQLite, Qdrant und Docker Compose. Die API Routes übernehmen Upload, Indexing, Search, Answer Generation und Reindexing. Qdrant läuft als lokaler Vector Store über Docker.

## Besondere technische Entscheidungen

Ich habe bewusst keine große RAG Library wie LangChain oder LlamaIndex verwendet. Die Kernpipeline bleibt dadurch sichtbar: Chunking, Retrieval, Prompting, Confidence Logic und Grounding Validation sind direkt im Code nachvollziehbar.

PDFs werden mit `pdfjs-dist` verarbeitet. Für Mehrspaltenlayouts gibt es eine einfache positionsbasierte Spaltensortierung.

## Qualitätsmaßnahmen

- Antwortgenerierung nur bei ausreichender Quellenlage
- Quellenreferenzen wie `[S1]` im Antworttext
- Prüfung auf erfundene Quellen IDs
- Confidence und Begründung pro Antwort
- Dokumentdetails mit Chunk Preview und Verarbeitungsstatus
- Reindexing nach Änderungen an Parsing oder Chunking
- Demo-Dokumente und Eval-Fragen

## Tech Stack

- Next.js
- TypeScript
- Prisma
- SQLite
- Qdrant
- Docker Compose
- NVIDIA NIM Embeddings
- NVIDIA NIM Chat Completions

## Grenzen

OCR ist aktuell nicht enthalten. Gescannte PDFs und sehr komplexe Layouts können daher problematisch sein. Authentifizierung und Mandantenfähigkeit sind nicht Teil dieses Projektumfangs. Die Hintergrundverarbeitung läuft aktuell im Next.js Prozess.

## Nächste Verbesserungen

Sinnvolle nächste Schritte wären OCR, Reranking, ein persistenter Chat Verlauf, eine Worker Queue für große Dokumente und ein größeres Evaluationsset mit erwarteten Quellen.
