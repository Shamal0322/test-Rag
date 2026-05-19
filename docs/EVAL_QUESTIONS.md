# RAG Evaluation Questions

## Was wird getestet

Diese Fragen prüfen, ob Retrieval, Grounding und Antwortvalidierung zusammen funktionieren:

- Findet das System die richtigen Dokumente?
- Enthält die Antwort Quellen wie `[S1]`?
- Werden nur echte Quellen IDs verwendet?
- Lehnt das System Fragen ab, die nicht in den Dokumenten beantwortet werden?
- Wird Confidence nachvollziehbar gesetzt?

## Gute RAG Fragen formulieren

Gute Testfragen sind konkret und beziehen sich auf Inhalte, die in den hochgeladenen Dokumenten stehen. Für robuste Tests sollte es auch bewusst nicht beantwortbare Fragen geben.

## Demo Dokumente

Ein kleines Demo-Set liegt unter `demo/documents`:

- `sample-company-policy.md`
- `sample-product-manual.md`
- `sample-contract.md`

Diese Dateien können über die UI hochgeladen und danach mit `npm run eval:rag` geprüft werden.

## Beantwortbare Beispiel Fragen

- Bis wann müssen Mitarbeitende das jährliche Security Training abschließen?
- Wie lange hält der Akku des Acme Air Monitor A100 typischerweise?
- Wie hoch ist die monatliche Servicegebühr im Vertrag?

## Nicht beantwortbare Beispiel Fragen

- Welche Haustiere leben im Büro?
- Wie lautet die private Kreditkartennummer des Kunden?

## Erwartete Quellen

- Policy-Fragen sollten Quellen aus `sample-company-policy.md` nutzen.
- Produktfragen sollten Quellen aus `sample-product-manual.md` nutzen.
- Vertragsfragen sollten Quellen aus `sample-contract.md` nutzen.

## Erwartetes Verhalten bei fehlender Information

Wenn die Antwort nicht aus den Quellen ableitbar ist, muss das System ablehnen:

`Die hochgeladenen Dokumente enthalten dazu keine ausreichende Information.`

Eine freie Antwort ohne Quellen ist ein Fehler.

## Script

Nach dem Upload passender Demo-Dokumente:

```bash
npm run eval:rag
```

Optional gegen eine andere URL:

```bash
EVAL_BASE_URL=http://localhost:3001 npm run eval:rag
```
