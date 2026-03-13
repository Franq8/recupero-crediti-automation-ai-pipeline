# 11 — TODO operativo (aggiornato)

## Stato
Da questo punto il progetto è in **V1 freeze**: no nuove feature, solo stabilizzazione + validazione reale + handoff.

## Residui effettivi prima della chiusura "per ora"

### A) Validazione reale (priorità alta)
- [ ] Testare 2–3 template DOCX reali dello studio
- [ ] Correggere eventuali `unknown fields` emersi da `mapping-preview`
- [ ] Testare 2–3 pratiche reali anonimizzate (estrazione + generazione)
- [ ] Eseguire prova completa nel canale `#precetto-operativo`

### B) Decisioni funzionali ancora da congelare
- [ ] Confermare testo clausola standard interessi (`mode=none`) definitiva
- [ ] Confermare convenzione conteggio giorni interessi `simple` (inclusivo/esclusivo)

### C) Chiusura operativa
- [ ] Eseguire smoke tecnici su ambiente target
- [ ] Verificare `GET /project/go-live-report`
- [ ] Confermare go-live oppure congelare in stato pre-go-live
