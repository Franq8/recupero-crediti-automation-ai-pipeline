# 46 — Repo Health Review (2026-03-16)

## Contesto
Analisi repo-wide eseguita sul branch locale con queste verifiche:

- `npm ci`
- `npm run db:generate`
- `npm run build`
- `npm test -w @rca/api`
- smoke locali API (`scripts/e2e-smoke.mjs`, `scripts/e2e-table.mjs`)
- smoke Discord v1 (`scripts/e2e-discord-v1.mjs`)
- verifica mirata del parser CSV con input a separatore `;`

Durante questa sessione è stata anche applicata una fix al listener Discord/OpenClaw multi-riga:

- `apps/api/scripts/doc-generator-discord-listener.mjs`
- `apps/api/src/doc-generator-openclaw.ts`
- `apps/api/src/doc-generator-openclaw.test.ts`

## Stato verificato qui

### Verde
- `npm run db:generate` riesce.
- `npm run build` riesce per tutto il monorepo.
- `npm test -w @rca/api` riesce (`15/15` test passati).
- `scripts/e2e-smoke.mjs` riesce.
- `scripts/e2e-table.mjs` riesce.
- `scripts/e2e-discord-v1.mjs` riesce.

### Corretto in questo branch
- bootstrap locale riallineato a `.env.example` + `npm run db:push`;
- web non più hardcoded su `http://localhost:8787`;
- storage Discord v1 resa locale-safe di default;
- parser CSV con autodetect del separatore `;`;
- smoke/script e doc Discord v1 allineati al contratto JSON + download link;
- `/health` non torna più verde con DB/schema assenti.

### Ancora aperto / da trattare fuori da questa sessione
- `project/readiness` e `project/go-live-report` restano troppo ottimistici/hardcoded;
- la disciplina migrazioni Prisma non è stata rimessa in ordine: il path verificato e affidabile in questo branch è `db push`, non `migrate deploy`;
- il comportamento reale del listener/OpenClaw su batch grandi va validato sul Mac mini con il file completo.

## Findings principali

### 1. `project/readiness` e `project/go-live-report` restano ottimistici e non sono veri gate operativi
File:
- `apps/api/src/server.ts:152-219`

Dettaglio:
- `go-live-report` e `readiness` continuano a marcare molte capability/checklist come `true` hardcoded;
- `/health` è stato corretto, ma questi due endpoint non sono ancora stati convertiti in controlli reali.

Impatto:
- un ambiente parzialmente degradato può ancora apparire “ready”;
- non vanno usati come gate forti di deploy o smoke finale.

### 2. La strategia Prisma verificata è `db push`; la catena migrazioni non è stata consolidata
File:
- `apps/api/package.json`
- `apps/api/Dockerfile`
- `README.md`
- `docs/19_RUNBOOK.md`

Dettaglio:
- in questo branch il bootstrap verificato usa `.env.example` + `npm run db:push`;
- non è stato fatto un riallineamento completo della storia delle migration SQL versionate;
- per questo la soluzione applicata è rendere affidabile il bootstrap effettivo, non dichiarare valide migrazioni che qui non sono state dimostrate.

Impatto:
- per ambienti locali/staging SQLite il repo è operativo;
- se vuoi tornare a una disciplina `migrate deploy` vera, va pianificato un lavoro specifico e va testato su ambiente reale.

### 3. Il rischio residuo principale resta il batch reale OpenClaw su Mac mini
File:
- `apps/api/scripts/doc-generator-discord-listener.mjs`
- `apps/api/src/doc-generator-openclaw.ts`
- `docs/46_REPO_HEALTH_REVIEW_2026-03-16.md`

Dettaglio:
- la robustezza del mapping multi-riga OpenClaw è stata rinforzata e testata localmente;
- manca però la prova con il file/gruppo reale che gira sul Mac mini e con l'agent OpenClaw del canale vero.

Impatto:
- il repo è più robusto, ma il vero rischio utente resta nel dato/runtime reale;
- questa parte va chiusa solo su Mac mini con il listener vero.

## Cose che NON risultano rotte in questa verifica

- build TypeScript API e web: ok dopo `npm run db:generate`;
- test unitari API: ok;
- import XLSX base e multi-sheet: coperto dai test;
- import CSV `;`: ora coperto dai test;
- rendering DOCX base: coperto dai test e dallo smoke core;
- workflow deterministic table-first base: smoke verde;
- Discord v1 end-to-end: smoke verde sul contratto corrente JSON + download link;
- fix listener Discord/OpenClaw multi-riga introdotta in questa sessione: helper testato e listener sintatticamente valido.

## Priorità consigliata

1. Validare sul Mac mini il batch reale `doc-generator` con OpenClaw e file grande.
2. Decidere se il contratto Prisma del progetto resta `db push` oppure se va ricostruita una vera storia migrazioni.
3. Rendere affidabili anche `project/readiness` e `project/go-live-report`.

## Verifiche da rifare sul Mac mini

Queste hanno senso soprattutto nell'ambiente reale dove gira il listener/doc-generator:

- test completo `doc-generator` Discord con il file reale grande;
- verifica di `DISCORD_DOWNLOAD_STORAGE_DIR` e `PUBLIC_API_BASE_URL`;
- verifica del listener `apps/api/scripts/doc-generator-discord-listener.mjs` con OpenClaw reale e batch multi-riga;
- conferma che il contratto Discord v1 desiderato resti JSON + download link anche nel tuo flusso operativo OpenClaw.

## Nota finale
Il repo non è “rotto ovunque”: il core API/web builda e i test API sono verdi.
I problemi più rilevanti ancora aperti qui sono soprattutto:

- signal endpoint troppo ottimistici,
- strategia migrazioni Prisma non consolidata,
- necessità di chiusura del batch reale OpenClaw sul Mac mini.
