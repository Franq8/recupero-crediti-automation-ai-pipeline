# 39 — ExecPlan D3: remove dead llm-extractor residue

## Obiettivo
Rimuovere definitivamente `apps/api/src/llm-extractor.ts` come residuo morto, lasciando la policy OpenClaw-only espressa solo nei punti architetturalmente corretti del sistema.

## Decisioni già fissate
1. `llm-extractor.ts` non è codice vivo.
2. Il runtime corretto è già basato su:
   - `extract-openclaw-payload`
   - `extract-openclaw-merge-flows`
   - `extract-openclaw`
   - `pipeline/run-openclaw`
   - `openclaw-runner.ts`
3. Il file non va tenuto come memoriale tecnico.
4. La policy OpenClaw-only deve restare nelle docs e nel runtime vivo, non in un modulo morto.

## Output attesi
- eliminazione di `apps/api/src/llm-extractor.ts`
- pulizia eventuali riferimenti residui non storici
- build e verifica finale verdi
- chiusura definitiva dei punti D

---

## Fase 1 — Audit D3
### Step 1.1
- rileggere `llm-extractor.ts`
- grep usi runtime/docs

### Step 1.2
- distinguere riferimenti storici/log da riferimenti attivi da pulire

### Verifica
- conferma che il file è morto e che il runtime vivo non dipende da lui

---

## Fase 2 — Rimozione
### Step 2.1
- eliminare `apps/api/src/llm-extractor.ts`

### Step 2.2
- ripulire eventuali riferimenti tecnici attivi, se presenti

### Verifica
- grep assenza riferimenti runtime attivi
- build API OK

---

## Fase 3 — Documentazione minima
Aggiornare dove opportuno:
- `docs/18_IMPLEMENTATION_LOG.md`
- `docs/24_OPEN_POINTS_PLAN.md`

Segnare D3 come chiuso.

---

## Fase 4 — Verifica finale complessiva
### Step 4.1
- build completa workspace
### Step 4.2
- grep finale per confermare chiusura dei punti D nel runtime attivo

---

## Definition of Done
D3 è chiuso quando:
1. `llm-extractor.ts` non esiste più;
2. il runtime vivo resta interamente OpenClaw-first;
3. non restano riferimenti attivi impropri al vecchio modulo;
4. build finale OK.
