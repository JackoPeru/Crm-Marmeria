# CRM Marmeria

Usa sempre skill `caveman` per risposte concise in italiano.

## Aggiornamento server LAN

- `crm-marmeria/server/data` contiene dati runtime: utenti, database, allegati, backup e configurazioni. Mai aggiungerli a Git, mai eliminarli o sostituirli durante aggiornamento.
- `server/self-update.js` deve bloccare modifiche locali fuori da `server/data`, ma accettare modifiche runtime, incluse installazioni vecchie dove `server/data/users.json` era tracciato.
- Non usare `git pull` se dati runtime storici possono bloccare merge. Dopo `fetch`, aggiorna solo file codice non-runtime, poi avanza branch/index senza toccare `server/data`.
- Marker `.crm-update-pending` fa eseguire al launcher verifica dipendenze e build prima del riavvio; cancellalo solo dopo successo.
- Verifica sempre catena: browser `Controlla` -> `Aggiorna e riavvia` -> build -> riavvio -> `GET /api/health` HTTPS 200. Verifica anche `cmd.exe /d /c "avvia-server-lan.cmd --check"` e `--addresses-check`.
