# Submission Message

Hallo,

ich habe das Projekt als dokumentenbasierten RAG Recherche Assistenten umgesetzt.

Der Fokus liegt auf einer nachvollziehbaren Kernpipeline: Dokumente werden hochgeladen, extrahiert, gechunked, über NVIDIA NIM eingebettet und in Qdrant indexiert. Fragen werden über Retrieval beantwortet, wobei die Antwort Quellenverweise enthält und gegen die gefundenen Quellen validiert wird.

Technisch verwendet das Projekt Next.js, TypeScript, Prisma, SQLite, Qdrant, Docker Compose sowie NVIDIA NIM für Embeddings und LLM Antwortgenerierung. Die README beschreibt Setup, Architektur, Qualitätsmaßnahmen, Tradeoffs und bekannte Limitierungen.

Ich habe bewusst keine große RAG Library wie LangChain oder LlamaIndex verwendet, damit die Kernpipeline und die Architekturentscheidungen direkt nachvollziehbar bleiben.

Falls Sie zusätzlich eine detaillierte Agent Session oder eine technische Erläuterung einzelner Architekturentscheidungen möchten, stelle ich diese gerne bereit.

Viele Grüße

Vor dem Senden bitte Anrede und GitHub Link ergänzen.
