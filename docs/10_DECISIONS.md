# 10 — Decision Log

## 2026-02-12
1. Casistica iniziale: **Atto di precetto su DI**.
2. Approccio: pipeline a casistiche predefinite.
3. Interessi: tre modalità UI (`none`, `simple`, `complex_placeholder`).
4. In v1 implementare solo `none` + `simple`.
5. `complex` rimandato a fase successiva.
6. Necessaria UI semplice con override manuale, soprattutto su dies a quo.
7. Modello UX definitivo: workspace unico con campi sempre presenti (no modalità separate manuale/documenti).
8. Upload documenti in box unico; import strutturato nella stessa schermata.
9. Due azioni centrali: `Estrai informazioni` e `Genera subito documento`.
10. `Genera subito documento` ammesso anche con dati parziali; segnaposto mancanti restano nel DOCX.
11. Binario Discord confermato con comandi v1 per new/attach/extract/set/generate/generate-fast/export.
12. Nessun campo bloccante in generazione: output sempre consentito anche con dati parziali.
13. Selettore tasso interessi richiesto (`legale|mora`) con default su `legale`.
14. Canale Discord operativo separato da quello di progettazione.
15. Filosofia estrazione aggiornata: approccio LLM-first con vincoli leggeri; regole/regex come rete di sicurezza e fallback.
16. Policy LLM globale progetto: qualunque uso LLM deve passare dal modello default OpenClaw (nessun uso diretto API key/provider nel codice applicativo).
17. V1 in modalità freeze: da qui in avanti solo stabilizzazione/bugfix/test reali fino a go-live.

## Regola di modifica
Ogni cambio sostanziale del flusso va aggiunto a questo file con data.
