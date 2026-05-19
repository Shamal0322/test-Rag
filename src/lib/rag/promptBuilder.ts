import type { ChatMessage } from "@/lib/nvidia/llmClient";

export type RagSource = {
  sourceId: string;
  documentId: string;
  documentName: string;
  pageNumber: number | null;
  score: number;
  text: string;
};

export function buildRagMessages(
  question: string,
  sources: RagSource[],
  options: { mode?: "auto" | "selected" | "compare" } = {},
): ChatMessage[] {
  const mode = options.mode ?? "auto";

  return [
    {
      role: "system",
      content: [
        "Du bist ein dokumentenbasierter Recherche Assistent.",
        "Du darfst ausschließlich die bereitgestellten Quellen verwenden.",
        "Wenn die Antwort nicht in den Quellen steht, sage das klar.",
        "Vermische unterschiedliche Dokumente nicht.",
        "Wenn die Antwort mehrere Dokumente betrifft, strukturiere die Antwort nach Dokument.",
        "Wenn die Frage mehrdeutig ist, sage das klar.",
        "Bei Fragen über alle Dokumente darfst du vergleichen.",
        "Bei normalen Fragen soll die wahrscheinlich relevanteste Dokumentengruppe bevorzugt werden.",
        "Jede wichtige Aussage braucht eine Quellenangabe wie [S1].",
        "Erfinde keine Namen, Zahlen, Fristen oder Empfehlungen.",
        "Verwende kurze, klare Antworten.",
        "Nutze Deutsch, wenn die Nutzerfrage Deutsch ist.",
        "Nutze Englisch, wenn die Nutzerfrage Englisch ist.",
        "Keine Quellen verwenden, die nicht im Kontext stehen.",
        "Antworte präzise.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        "Frage:",
        question,
        "",
        "Quellen:",
        formatSources(sources),
        "",
        "Modus:",
        mode === "compare"
          ? "Vergleich über mehrere Dokumente. Strukturiere nach Dokument und zitiere jede Aussage."
          : "Normale Recherche. Bevorzuge die relevanteste Dokumentengruppe und vermische Dokumente nicht.",
        "",
        "Aufgabe:",
        "Beantworte die Frage anhand der Quellen.",
        "Zitiere die Quellen direkt im Text mit [S1], [S2].",
        'Wenn die Quellen nicht reichen, sage: "Die hochgeladenen Dokumente enthalten dazu keine ausreichende Information."',
      ].join("\n"),
    },
  ];
}

function formatSources(sources: RagSource[]) {
  const groups = new Map<string, RagSource[]>();

  for (const source of sources) {
    const group = groups.get(source.documentId) ?? [];
    group.push(source);
    groups.set(source.documentId, group);
  }

  return Array.from(groups.values())
    .map((group) => {
      const [firstSource] = group;

      return [
        `Dokument: ${firstSource.documentName}`,
        `Dokument-ID: ${firstSource.documentId}`,
        ...group.map((source) =>
          [
            `[${source.sourceId}]`,
            source.pageNumber ? `Seite: ${source.pageNumber}` : null,
            `Score: ${source.score.toFixed(3)}`,
            "Text:",
            limitSourceText(source.text),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      ].join("\n\n");
    })
    .join("\n\n---\n\n");
}

function limitSourceText(text: string) {
  const maxLength = 2600;
  if (text.length <= maxLength) return text;

  const boundary = text.lastIndexOf(" ", maxLength);
  return `${text.slice(0, boundary > 1200 ? boundary : maxLength).trim()} [...]`;
}
