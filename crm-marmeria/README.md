# CRM Marmeria — server browser LAN

CRM Marmeria si usa esclusivamente dal browser. Un PC della rete ospita dati, API e interfaccia web; telefoni e altri PC aprono il suo indirizzo LAN. Non esistono installer o applicazioni desktop.

## Primo avvio del server

Sul PC che conserva i dati esegui solo `avvia-server-lan.cmd`.

Richiede Windows 10 1809 o successivo, connessione Internet e autorizzazione amministratore. Il file installa WinGet, Node.js LTS e Git se mancanti, installa dipendenze, compila interfaccia, apre firewall privato TCP `3001` e avvia il server.

Apri uno degli indirizzi mostrati, per esempio `https://192.168.1.20:3001`. Al primo collegamento ogni browser deve confermare il certificato locale del server; confronta l'impronta mostrata nella console del PC server prima di accettarlo. Le altre postazioni usano lo stesso indirizzo nel browser. Primo accesso: `admin` / `marmo2026!`; cambia password subito dopo il login.

## Sviluppo

```bash
npm install
npm install --prefix server
npm run dev
```

Per provare API server locale: `npm run server`. Per distribuzione LAN usa sempre `avvia-server-lan.cmd`.
