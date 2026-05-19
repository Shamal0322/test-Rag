# Next Steps

## Short Term Improvements

- OCR Worker für gescannte PDFs ergänzen
- Bessere PDF Layout-Erkennung für Tabellen und mehrspaltige Dokumente
- Persistenter Chat Verlauf auf Basis der vorhandenen `Chat` und `Message` Modelle
- Dokumentfilter in der UI für gezielte Fragen an einzelne Dateien

## Retrieval Quality

- Reranking mit NVIDIA NeMo Retriever Reranking prüfen
- Golden Questions mit erwarteten Quellen definieren
- Confidence Thresholds auf Basis echter Testsets kalibrieren
- Query Expansion und Synonym Handling verbessern
- Retrieval Debug View für Top-K Treffer und Scores ergänzen

## Product Features

- Workspaces oder User Support
- Tags und Dokumentgruppen
- Export von Antworten mit Quellen
- Bessere Statusanzeige für lange Dokumentverarbeitung
- Manuelle Reindex-All Funktion

## Production Readiness

- Background Job Queue für große Dokumente
- Object Storage statt lokalem Upload Storage
- Structured Logging
- Monitoring für API Fehler und NVIDIA Rate Limits
- Authentifizierung und Autorisierung
- Backup Strategie für SQLite oder Wechsel auf PostgreSQL
- Separate Worker Container für Ingestion
