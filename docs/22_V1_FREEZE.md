# 22 — V1 Freeze Plan

## Obiettivo
Congelare scope e codice per evitare ulteriore espansione funzionale non necessaria, e chiudere la v1 con qualità.

## Freeze rules
1. Nessuna nuova feature Discord oltre adapter v1 già implementato.
2. Nessuna nuova capability business fuori casistica precetto su DI.
3. Solo bugfix, stabilizzazione, e allineamento documentale.
4. Qualunque eccezione richiede decisione esplicita nel Decision Log.

## Checklist pre-freeze
- [x] Build workspace OK
- [x] Audit dependency OK
- [x] Smoke core OK
- [x] Smoke discord adapter OK
- [x] Runbook e API quickref aggiornati
- [x] Handoff checklist disponibile

## Attività consentite post-freeze (prima del go-live)
- Bugfix su parser/generazione docx
- Correzione mapping su template reali
- Miglioramento messaggi errore/warning
- Test reali e report esito

## Exit criteria v1
- Validazione positiva su template reali
- Validazione positiva su pratiche reali anonimizzate
- Conferma utente di go-live operativo
