# 21 — Handoff checklist (chiusura progetto)

## Stato attuale
Il progetto è in stato **avanzato e operativo** su backbone completo (API + Web + DB + docx + import + Discord adapter v1).

## Cosa è pronto
- [x] Workspace unico dati
- [x] Upload documenti + import strutturato
- [x] Template library persistente
- [x] Mapping preview template
- [x] Estrazione fallback rules + entrypoint OpenClaw client
- [x] Interessi v1 (none/simple)
- [x] Generazione DOCX standard/fast
- [x] Audit timeline + quality gate
- [x] Adapter Discord v1 (senza ulteriore scope creep)
- [x] Docker + runbook + smoke tests

## Ultime attività consigliate prima go-live
1. Validazione su 2–3 template reali dello studio
2. Validazione su 2–3 pratiche reali anonimizzate
3. Fine-tuning campi unknown emersi da `mapping-preview`
4. Verifica E2E canale `#precetto-operativo`

## Comandi rapidi
- Build: `npm run build`
- Smoke core: `npm run -w @rca/api smoke`
- Smoke discord: `npm run -w @rca/api smoke:discord`

## Criterio chiusura definitiva
Il progetto si considera chiuso quando i 4 punti di validazione sopra sono completati senza errori bloccanti.

## Report rapido stato piattaforma
- endpoint: `GET /project/go-live-report`
- include:
  - readiness percent
  - capability checklist
  - hard checks
  - pending human validation
