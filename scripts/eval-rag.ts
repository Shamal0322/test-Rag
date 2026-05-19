import questions from "../demo/questions.json" with { type: "json" };

type EvalQuestion = {
  question: string;
  expectedBehavior: "answerable" | "not_answerable";
  expectedSource?: string;
};

type AnswerResponse = {
  answer?: string;
  sources?: Array<{ sourceId: string; documentName: string; preview: string }>;
  confidence?: "high" | "medium" | "low";
  confidenceReason?: string;
  usedModel?: string;
  error?: string;
};

const baseUrl = process.env.EVAL_BASE_URL ?? "http://localhost:3000";

async function main() {
  await assertServerReachable();
  const results = [];

  for (const item of questions as EvalQuestion[]) {
    const response = await fetch(`${baseUrl}/api/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: item.question, limit: 8 }),
    });
    const payload = (await response.json()) as AnswerResponse;
    const checks = evaluate(item, payload, response.ok);

    results.push({
      question: item.question,
      ok: checks.every((check) => check.ok),
      checks,
      confidence: payload.confidence,
      sources: payload.sources?.map((source) => source.documentName) ?? [],
      answer: payload.answer,
      error: payload.error,
    });
  }

  for (const result of results) {
    console.log(`\n${result.ok ? "PASS" : "FAIL"} ${result.question}`);
    for (const check of result.checks) {
      console.log(`  ${check.ok ? "✓" : "x"} ${check.name}`);
    }
    console.log(`  confidence: ${result.confidence ?? "n/a"}`);
    console.log(`  sources: ${result.sources.join(", ") || "none"}`);
    if (result.error) console.log(`  error: ${result.error}`);
  }

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

async function assertServerReachable() {
  try {
    const response = await fetch(`${baseUrl}/api/documents`);
    if (!response.ok) {
      throw new Error(`GET /api/documents returned ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      [
        `Eval server not reachable at ${baseUrl}.`,
        "Start the app first with: npm run dev",
        "Start Qdrant with: docker compose up -d qdrant",
        error instanceof Error ? `Details: ${error.message}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function evaluate(item: EvalQuestion, payload: AnswerResponse, responseOk: boolean) {
  const answer = payload.answer ?? "";
  const sources = payload.sources ?? [];
  const sourceRefs = Array.from(answer.matchAll(/\[(S\d+)\]/g)).map((match) => match[1]);
  const sourceIds = new Set(sources.map((source) => source.sourceId));
  const insufficient = /keine ausreichende information|nicht ausreichend|quellenlage ist schwach/i.test(answer);

  const checks = [
    { name: "API response ok", ok: responseOk },
    { name: "confidence set", ok: Boolean(payload.confidence) },
  ];

  if (item.expectedBehavior === "answerable") {
    checks.push(
      { name: "answer present", ok: answer.trim().length > 0 },
      { name: "sources present", ok: sources.length > 0 },
      { name: "answer cites sources", ok: sourceRefs.length > 0 },
      {
        name: "citations exist in sources",
        ok: sourceRefs.every((sourceRef) => sourceIds.has(sourceRef)),
      },
    );

    if (item.expectedSource) {
      checks.push({
        name: `expected source hint: ${item.expectedSource}`,
        ok: sources.some((source) =>
          source.documentName.toLowerCase().includes(item.expectedSource!.toLowerCase()),
        ),
      });
    }
  } else {
    checks.push(
      { name: "does not answer unsupported question", ok: insufficient },
      { name: "no unsupported answer without sources", ok: insufficient || sources.length > 0 },
    );
  }

  return checks;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
