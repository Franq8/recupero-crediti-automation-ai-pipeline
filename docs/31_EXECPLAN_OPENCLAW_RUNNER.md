# 31 — ExecPlan: OpenClaw Runner (3 flussi separati, modello default)

## Obiettivo
Implementare il controller applicativo che esegue realmente i 3 flussi AI (EXTRACT/DERIVE/GENERATE) usando il **modello default OpenClaw**, senza passaggi manuali.

## Scope (incluso)
1. Runner backend che:
   - legge `extract-openclaw-payload`,
   - invoca OpenClaw client per ogni flow separato,
   - raccoglie output strutturato,
   - invia merge/apply finale.
2. Gestione errori e retry per flow singolo.
3. Audit completo per ogni run (flow-level).

## Scope (escluso)
- redesign UI profondo (coperto in ExecPlan 30)
- multi-set batch
- modalità tabella deterministica CSV/XLSX-first

## Vincoli non negoziabili
- Nessun uso API key/provider diretto nell’app.
- Tutte le invocazioni AI via runtime/client OpenClaw.
- Flussi separati e isolati per tipo placeholder.

## Contratto I/O runner
### Input
- `practiceId`
- `templateId`
- payload da `GET /practices/:id/extract-openclaw-payload`

### Output intermedio per flow
```json
{
  "values": {
    "<instructionKey>": {"value": "...", "confidence": 0.0, "sourceRef": "..."}
  }
}
```

### Output finale
- chiamata a `POST /practices/:id/extract-openclaw-merge-flows`

## Passi implementativi

### Fase A — Runner module
- [ ] A1: creare `apps/api/src/openclaw-runner.ts`
- [ ] A2: funzione `runFlow(kind, prompt, docs, schema)`
- [ ] A3: funzione `runAllFlows(payload)` con orchestrazione sequenziale (o parallela controllata)

### Fase B — API orchestration endpoint
- [ ] B1: `POST /practices/:id/pipeline/run-openclaw`
- [ ] B2: invoca runner e salva stato run
- [ ] B3: apply finale tramite `/extract-openclaw-merge-flows`

### Fase C — Reliability
- [ ] C1: retry per singolo flow (max 2)
- [ ] C2: timeout per flow
- [ ] C3: fallback run-status coerente in caso errore parziale

### Fase D — Audit/trace
- [ ] D1: audit `FLOW_RUN_START`, `FLOW_RUN_OK`, `FLOW_RUN_FAIL`
- [ ] D2: audit `PIPELINE_RUN_COMPLETED`
- [ ] D3: salvare metadati run (durata, count placeholder per flow)

## Quality gates
- Build green
- Nessun riferimento a chiavi/provider esterni
- 3 flow eseguiti con prompt separati
- merge finale applicato in pratica

## Criterio Done
Dato `practiceId` + template + documenti, una singola chiamata `pipeline/run-openclaw` produce:
1) esecuzione 3 flow via OpenClaw,
2) merge dei risultati,
3) dataset finale applicato e pronto per tabella/docx.
