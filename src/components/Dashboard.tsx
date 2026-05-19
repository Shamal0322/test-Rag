"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Info,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  UploadCloud,
} from "lucide-react";
import clsx from "clsx";

type DocumentItem = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  errorMessage: string | null;
  chunkCount: number;
};

type AnswerSource = {
  sourceId: string;
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  documentName: string;
  pageNumber: number | null;
  score: number;
  preview: string;
};

type SourceGroup = {
  documentId: string;
  documentName: string;
  sources: AnswerSource[];
};

type RankedDocument = {
  documentId: string;
  documentName: string;
  score: number;
  reason: string;
};

type AnswerDebug = {
  retrievedCount: number;
  afterMinScoreCount: number;
  afterDedupeCount: number;
  finalContextCount: number;
  documentsUsed: number;
  droppedBecauseLowScore: number;
  droppedBecauseDuplicate: number;
  droppedBecauseDocumentLimit: number;
  retrievalDurationMs: number;
  llmDurationMs: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: AnswerSource[];
  sourceGroups?: SourceGroup[];
  confidence?: "high" | "medium" | "low";
  confidenceReason?: string;
  usedModel?: string;
  ambiguity?: boolean;
  ambiguousDocuments?: RankedDocument[];
  question?: string;
  debug?: AnswerDebug;
};

type DocumentDetail = DocumentItem & {
  extractedChars: number | null;
  embeddingModel: string | null;
  indexedAt: string | null;
  processingStartedAt: string | null;
  processingFinishedAt: string | null;
  chunkingConfig?: {
    chunkSizeChars: number;
    chunkOverlapChars: number;
    minChunkChars: number;
    maxChunkChars: number;
  };
  chunks: Array<{
    id: string;
    text: string;
    pageNumber: number | null;
    chunkIndex: number;
    tokenCount: number;
    qdrantPointId: string | null;
  }>;
};

const runningStatuses = new Set(["uploaded", "parsing", "chunking", "embedding"]);
const exampleQuestions = [
  "Fasse die wichtigsten Punkte zusammen",
  "Welche Fristen werden genannt?",
  "Welche Risiken oder Einschränkungen stehen in den Dokumenten?",
];

export function Dashboard() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [isAnswering, setIsAnswering] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [showChunkPreviews, setShowChunkPreviews] = useState(false);
  const [searchScope, setSearchScope] = useState<"auto" | "selected">("auto");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documentDetail, setDocumentDetail] = useState<DocumentDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [sessionStartedAt, setSessionStartedAt] = useState(() => new Date());
  const sessionIdRef = useRef(sessionId);
  const detailPanelRef = useRef<HTMLElement | null>(null);
  const detailDocumentId = documentDetail?.id;
  const detailDocumentStatus = documentDetail?.status;

  const hasRunningDocument = useMemo(
    () => documents.some((document) => runningStatuses.has(document.status)),
    [documents],
  );

  const indexedDocuments = useMemo(
    () => documents.filter((document) => document.status === "indexed"),
    [documents],
  );

  const failedDocuments = useMemo(
    () => documents.filter((document) => document.status === "failed"),
    [documents],
  );

  const totalChunks = useMemo(
    () => documents.reduce((sum, document) => sum + document.chunkCount, 0),
    [documents],
  );

  async function loadDocuments() {
    const response = await fetch("/api/documents");
    const payload = await response.json();
    setDocuments(payload.documents ?? []);
  }

  useEffect(() => {
    void loadDocuments();
  }, []);

  useEffect(() => {
    if (!hasRunningDocument && !reindexingId) return;
    const interval = window.setInterval(() => void loadDocuments(), 2000);
    return () => window.clearInterval(interval);
  }, [hasRunningDocument, reindexingId]);

  useEffect(() => {
    const indexedIds = new Set(indexedDocuments.map((document) => document.id));
    setSelectedDocumentIds((current) => current.filter((id) => indexedIds.has(id)));
  }, [indexedDocuments]);

  useEffect(() => {
    if (!documentDetail) return;
    window.requestAnimationFrame(() => {
      detailPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [documentDetail]);

  useEffect(() => {
    if (!detailDocumentId || !detailDocumentStatus || !runningStatuses.has(detailDocumentStatus)) return;

    const interval = window.setInterval(async () => {
      const response = await fetch(`/api/documents/${detailDocumentId}`);
      const payload = await response.json().catch(() => ({}));

      if (response.ok && payload.document) {
        setDocumentDetail(payload.document);
        await loadDocuments();
      }
    }, 1500);

    return () => window.clearInterval(interval);
  }, [detailDocumentId, detailDocumentStatus]);

  function startNewSession() {
    const nextSessionId = crypto.randomUUID();
    sessionIdRef.current = nextSessionId;
    setSessionId(nextSessionId);
    setMessages([]);
    setQuestion("");
    setAnswerError(null);
    setIsAnswering(false);
    setSessionStartedAt(new Date());
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", selectedFile);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();

    if (!response.ok) {
      setUploadError(payload.error ?? "Upload fehlgeschlagen.");
    } else {
      setSelectedFile(null);
      await loadDocuments();
    }

    setIsUploading(false);
  }

  async function deleteDocument(id: string) {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (documentDetail?.id === id) {
      setDocumentDetail(null);
    }
    await loadDocuments();
  }

  async function loadDocumentDetail(id: string) {
    setDetailError(null);
    const response = await fetch(`/api/documents/${id}`);
    const payload = await response.json();

    if (!response.ok) {
      setDetailError(payload.error ?? "Dokumentdetails konnten nicht geladen werden.");
      return;
    }

    setDocumentDetail(payload.document);
  }

  async function reindexDocument(id: string) {
    setReindexingId(id);
    setDetailError(null);
    setDocuments((current) =>
      current.map((document) =>
        document.id === id
          ? { ...document, status: "uploaded", errorMessage: null }
          : document,
      ),
    );
    setDocumentDetail((current) =>
      current?.id === id
        ? {
            ...current,
            status: "uploaded",
            errorMessage: null,
            indexedAt: null,
          }
        : current,
    );

    const response = await fetch(`/api/documents/${id}/reindex`, {
      method: "POST",
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setDetailError(payload.error ?? "Reindex fehlgeschlagen.");
      await loadDocuments();
      if (documentDetail?.id === id) {
        await loadDocumentDetail(id);
      }
    } else {
      await loadDocuments();
      if (documentDetail?.id === id) {
        await loadDocumentDetail(id);
      }
    }

    setReindexingId(null);
  }

  async function handleQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isAnswering) return;

    await askQuestion(trimmedQuestion);
  }

  async function askQuestion(
    trimmedQuestion: string,
    options: { documentIds?: string[]; mode?: "auto" | "selected" | "compare"; addUserMessage?: boolean } = {},
  ) {
    const activeDocumentIds =
      options.documentIds ??
      (searchScope === "selected" ? selectedDocumentIds : []);
    const mode =
      options.mode ??
      (searchScope === "selected" && activeDocumentIds.length ? "selected" : "auto");

    setIsAnswering(true);
    setAnswerError(null);
    setQuestion("");
    const requestSessionId = sessionIdRef.current;
    if (options.addUserMessage !== false) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: trimmedQuestion,
        },
      ]);
    }

    const response = await fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: trimmedQuestion,
        documentIds: activeDocumentIds.length ? activeDocumentIds : undefined,
        mode,
      }),
    });
    const payload = await response.json();

    if (sessionIdRef.current !== requestSessionId) {
      return;
    }

    if (!response.ok) {
      setAnswerError(payload.error ?? "Antwortgenerierung fehlgeschlagen.");
    } else {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: payload.answer,
          sources: payload.sources ?? [],
          sourceGroups: payload.sourceGroups ?? [],
          confidence: payload.confidence,
          confidenceReason: payload.confidenceReason,
          usedModel: payload.usedModel,
          ambiguity: payload.ambiguity,
          ambiguousDocuments: payload.ambiguousDocuments ?? [],
          question: trimmedQuestion,
          debug: payload.debug,
        },
      ]);
    }

    setIsAnswering(false);
  }

  function toggleSelectedDocument(documentId: string) {
    setSelectedDocumentIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId],
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">
            <FileText size={20} aria-hidden />
          </div>
          <div>
            <strong>NIM Research</strong>
            <span>Dokumentenbasis</span>
          </div>
        </div>

        <form className="sidebarUpload" onSubmit={handleUpload}>
          <label className="compactDropzone">
            <UploadCloud size={18} aria-hidden />
            <span>{selectedFile ? selectedFile.name : "Dokument hochladen"}</span>
            <input
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <button className="sidebarUploadButton" disabled={!selectedFile || isUploading}>
            {isUploading ? <Loader2 className="spin" size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
            Hinzufügen
          </button>
          {uploadError ? <p className="sidebarError">{uploadError}</p> : null}
        </form>

        <div className="documentSectionHeader">
          <span>Dokumente</span>
          <strong>{documents.length}</strong>
        </div>

        <div className="documentList">
          {documents.length === 0 ? (
            <p className="emptyText">Lade ein Dokument hoch, um deine Wissensbasis zu erstellen.</p>
          ) : (
            documents.map((document) => (
              <article className="documentItem" key={document.id}>
                <FileText className="documentIcon" size={18} aria-hidden />
                <div className="documentBody">
                  <div className="documentTopline">
                    <span className="documentName">{document.originalName}</span>
                    <StatusBadge status={document.status} />
                  </div>
                  <div className="documentActions">
                    <button
                      className="textButton"
                      type="button"
                      onClick={() => void loadDocumentDetail(document.id)}
                    >
                      Details
                    </button>
                    <button
                      className="iconButton"
                      type="button"
                      title="Dokument löschen"
                      onClick={() => void deleteDocument(document.id)}
                    >
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        <div className="sidebarSummary">
          <span>{indexedDocuments.length} indexiert</span>
          <span>{failedDocuments.length} fehlgeschlagen</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="sessionHeader">
          <div>
            <p className="eyebrow">NVIDIA NIM · Qdrant · SQLite</p>
            <h1>Research Session</h1>
            <p>Fragen werden nur anhand indexierter Dokumente beantwortet.</p>
            <span className="sessionMeta">
              Neue Recherche Session · {formatTime(sessionStartedAt)}
              <span className="sessionDot" aria-hidden>·</span>
              {sessionId.slice(0, 8)}
            </span>
          </div>
          <button className="outlineButton" type="button" onClick={startNewSession}>
            <Plus size={16} aria-hidden />
            Neue Session
          </button>
        </header>

        <section className="knowledgeSummary" aria-label="Dokumentenstatus">
          <StatusPill label="Indexiert" value={indexedDocuments.length} />
          <StatusPill label="Chunks" value={totalChunks} />
          <StatusPill label="Fehler" value={failedDocuments.length} />
        </section>

        <section className="chatPanel">
          {indexedDocuments.length === 0 ? (
            <p className="noticeText">
              {documents.length === 0
                ? "Lade zuerst ein Dokument hoch, um deine Wissensbasis zu erstellen."
                : "Warte, bis mindestens ein Dokument indexiert ist."}
            </p>
          ) : null}

          <div className="messageList">
            {messages.length === 0 ? (
              <div className="emptyChat">
                <MessageSquare size={26} aria-hidden />
                <div>
                  <strong>Stelle eine Frage zu deinen indexierten Dokumenten.</strong>
                  <p>Antworten enthalten Quellen, wenn passende Inhalte gefunden werden.</p>
                  <div className="exampleQuestions">
                    {exampleQuestions.map((example) => (
                      <button
                        type="button"
                        key={example}
                        onClick={() => setQuestion(example)}
                        disabled={indexedDocuments.length === 0}
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  className={clsx("message", `message-${message.role}`)}
                  key={message.id}
                >
                  {message.ambiguity ? (
                    <AmbiguityCard
                      message={message}
                      onUseDocument={(documentId) =>
                        message.question
                          ? void askQuestion(message.question, {
                              documentIds: [documentId],
                              mode: "selected",
                              addUserMessage: false,
                            })
                          : undefined
                      }
                      onCompare={() =>
                        message.question
                          ? void askQuestion(message.question, {
                              mode: "compare",
                              addUserMessage: false,
                            })
                          : undefined
                      }
                    />
                  ) : (
                    <p>{message.content}</p>
                  )}
                  {message.role === "assistant" ? (
                    <>
                      <div className="answerMeta">
                        {message.confidence ? (
                          <span className={clsx("confidence", `confidence-${message.confidence}`)}>
                            {message.confidence}
                          </span>
                        ) : null}
                        {message.usedModel ? <span>{message.usedModel}</span> : null}
                      </div>
                      {message.confidenceReason ? (
                        <p className="reasonText">{message.confidenceReason}</p>
                      ) : null}
                    </>
                  ) : null}
                  {message.sourceGroups?.length ? (
                    <div className="sourceGroups">
                      {message.sourceGroups.map((group) => (
                        <section className="sourceGroup" key={group.documentId}>
                          <h3>{group.documentName}</h3>
                          <div className="sourceGrid">
                            {group.sources.map((source) => (
                              <article className="sourceCard" key={source.sourceId}>
                                <div className="sourceTopline">
                                  <strong>[{source.sourceId}]</strong>
                                  <span>Score {source.score.toFixed(2)}</span>
                                </div>
                                <div className="sourceMeta">
                                  {source.pageNumber ? <span>Seite {source.pageNumber}</span> : null}
                                  <span>Chunk {source.chunkIndex + 1}</span>
                                </div>
                                {showChunkPreviews ? <p>{truncateText(source.preview, 250)}</p> : null}
                              </article>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : null}
                  {message.role === "assistant" && message.debug && process.env.NODE_ENV === "development" ? (
                    <details className="retrievalDetails">
                      <summary>Retrieval Details</summary>
                      <dl>
                        <div><dt>Kandidaten</dt><dd>{message.debug.retrievedCount}</dd></div>
                        <div><dt>Nach Mindestscore</dt><dd>{message.debug.afterMinScoreCount}</dd></div>
                        <div><dt>Nach Dedupe</dt><dd>{message.debug.afterDedupeCount}</dd></div>
                        <div><dt>Finaler Kontext</dt><dd>{message.debug.finalContextCount}</dd></div>
                        <div><dt>Dokumente</dt><dd>{message.debug.documentsUsed}</dd></div>
                        <div><dt>Retrieval</dt><dd>{message.debug.retrievalDurationMs} ms</dd></div>
                        <div><dt>LLM</dt><dd>{message.debug.llmDurationMs} ms</dd></div>
                      </dl>
                    </details>
                  ) : null}
                </article>
              ))
            )}
            {isAnswering ? (
              <div className="thinkingIndicator" aria-label="KI denkt">
                <span />
                <span />
                <span />
              </div>
            ) : null}
          </div>

          <div className="chatOptions">
            <div className="scopeControl" aria-label="Suchbereich">
              <div className="scopeHeader">
                <strong>Suchbereich</strong>
                <span>Du kannst die Suche eingrenzen, wenn die Antwort aus einem bestimmten Dokument kommen soll.</span>
              </div>
              <div className="segmentedControl">
                <button
                  type="button"
                  className={clsx(searchScope === "auto" && "active")}
                  onClick={() => setSearchScope("auto")}
                >
                  Alle Dokumente
                </button>
                <button
                  type="button"
                  className={clsx(searchScope === "selected" && "active")}
                  onClick={() => setSearchScope("selected")}
                >
                  Ausgewählte Dokumente
                </button>
              </div>
              {searchScope === "selected" ? (
                <div className="documentPicker">
                  {indexedDocuments.map((document) => (
                    <label className="documentChoice" key={document.id}>
                      <input
                        type="checkbox"
                        checked={selectedDocumentIds.includes(document.id)}
                        onChange={() => toggleSelectedDocument(document.id)}
                      />
                      <span>{document.originalName}</span>
                    </label>
                  ))}
                  {selectedDocumentIds.length === 0 ? (
                    <p>Ohne Auswahl wird weiter über alle indexierten Dokumente gesucht.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <label className="toggleRow">
              <input
                type="checkbox"
                checked={showChunkPreviews}
                onChange={(event) => setShowChunkPreviews(event.target.checked)}
              />
              <span>Chunk-Previews in Antworten anzeigen</span>
            </label>
          </div>

          <form className="searchBar" onSubmit={handleQuestion}>
            <MessageSquare size={18} aria-hidden />
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Frage zu den indexierten Dokumenten stellen"
              rows={Math.min(4, Math.max(1, question.split("\n").length))}
            />
            <button disabled={!question.trim() || isAnswering}>
              {isAnswering ? <Loader2 className="spin" size={18} aria-hidden /> : <Send size={16} aria-hidden />}
              {isAnswering ? "Denkt..." : "Senden"}
            </button>
          </form>

          {answerError ? <p className="errorText">{answerError}</p> : null}
        </section>

        {documentDetail ? (
          <section className="detailPanel" ref={detailPanelRef}>
            <div className="detailHeader">
              <div>
                <h2>Dokumentdetails</h2>
                <p>{documentDetail.originalName}</p>
              </div>
              <div className="detailActions">
                <button
                  className="plainButton"
                  type="button"
                  disabled={runningStatuses.has(documentDetail.status) || reindexingId === documentDetail.id}
                  onClick={() => void reindexDocument(documentDetail.id)}
                >
                  <RefreshCw size={15} aria-hidden />
                  {reindexingId === documentDetail.id ? "Reindex läuft..." : "Reindex"}
                </button>
                <button
                  className="plainDangerButton"
                  type="button"
                  onClick={() => void deleteDocument(documentDetail.id)}
                >
                  <Trash2 size={15} aria-hidden />
                  Löschen
                </button>
                <button
                  className="plainButton"
                  type="button"
                  onClick={() => setDocumentDetail(null)}
                >
                  Schließen
                </button>
              </div>
            </div>
            <dl className="detailGrid">
              <div>
                <dt>Status</dt>
                <dd><StatusBadge status={documentDetail.status} /></dd>
              </div>
              <div>
                <dt>Größe</dt>
                <dd>{formatBytes(documentDetail.sizeBytes)}</dd>
              </div>
              <div>
                <dt>Chunks</dt>
                <dd>{documentDetail.chunkCount}</dd>
              </div>
              <div>
                <dt>Extrahierte Zeichen</dt>
                <dd>{documentDetail.extractedChars ?? "n/a"}</dd>
              </div>
              <div>
                <dt>Embedding Modell</dt>
                <dd>{documentDetail.embeddingModel ?? "n/a"}</dd>
              </div>
              <div>
                <dt>Indexiert</dt>
                <dd>{formatDate(documentDetail.indexedAt)}</dd>
              </div>
            </dl>
            {documentDetail.errorMessage ? (
              <p className="detailWarning">
                <Info size={16} aria-hidden />
                {documentDetail.errorMessage}
              </p>
            ) : null}
            <p className="detailWarning">
              <Info size={16} aria-hidden />
              Nach Änderungen an Chunking Einstellungen sollte dieses Dokument neu indexiert werden.
            </p>
            {documentDetail.chunkingConfig ? (
              <dl className="detailGrid">
                <div>
                  <dt>Chunk Größe</dt>
                  <dd>{documentDetail.chunkingConfig.chunkSizeChars} Zeichen</dd>
                </div>
                <div>
                  <dt>Overlap</dt>
                  <dd>{documentDetail.chunkingConfig.chunkOverlapChars} Zeichen</dd>
                </div>
                <div>
                  <dt>Minimum</dt>
                  <dd>{documentDetail.chunkingConfig.minChunkChars} Zeichen</dd>
                </div>
                <div>
                  <dt>Maximum</dt>
                  <dd>{documentDetail.chunkingConfig.maxChunkChars} Zeichen</dd>
                </div>
              </dl>
            ) : null}
            <div className="chunkList">
              {documentDetail.chunks.slice(0, 4).map((chunk) => (
                <article className="chunkItem" key={chunk.id}>
                  <div className="sourceTopline">
                    <strong>Chunk {chunk.chunkIndex + 1}</strong>
                    <span>{chunk.tokenCount} Tokens geschätzt</span>
                  </div>
                  {chunk.pageNumber ? <div className="chunkMeta"><span>Seite {chunk.pageNumber}</span></div> : null}
                  <p>{chunk.text}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {detailError ? <p className="errorText">{detailError}</p> : null}
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={clsx("badge", `badge-${status}`)}>{status}</span>;
}

function StatusPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="statusPill">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function AmbiguityCard({
  message,
  onUseDocument,
  onCompare,
}: {
  message: ChatMessage;
  onUseDocument: (documentId: string) => void;
  onCompare: () => void;
}) {
  return (
    <div className="ambiguityCard">
      <div>
        <strong>Mehrere passende Dokumente gefunden</strong>
        <p>Ich habe relevante Stellen in mehreren Dokumenten gefunden. Wähle ein Dokument oder vergleiche alle Treffer.</p>
      </div>
      <div className="ambiguityOptions">
        {message.ambiguousDocuments?.map((document) => (
          <button
            type="button"
            key={document.documentId}
            onClick={() => onUseDocument(document.documentId)}
          >
            <span>{document.documentName} verwenden</span>
            <small>{document.reason}</small>
          </button>
        ))}
        <button type="button" className="compareButton" onClick={onCompare}>
          Alle vergleichen
        </button>
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string | null) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("de-DE", {
    timeStyle: "short",
  }).format(value);
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trim()}...`;
}
