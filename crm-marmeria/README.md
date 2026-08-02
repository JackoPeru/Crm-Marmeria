# CRM Marmeria — server browser LAN

CRM Marmeria si usa esclusivamente dal browser. Un PC della rete ospita dati, API e interfaccia web; telefoni e altri PC aprono il suo indirizzo LAN. Non esistono installer o applicazioni desktop.

## Primo avvio del server

Sul PC che conserva i dati esegui solo `avvia-server-lan.cmd`.

Richiede Windows 10 1809 o successivo, connessione Internet e autorizzazione amministratore. Il file installa WinGet, Node.js LTS e Git se mancanti, installa dipendenze, compila interfaccia, apre firewall privato TCP `3001` e avvia il server.

Apri uno degli indirizzi mostrati, per esempio `https://192.168.1.20:3001`. Al primo collegamento ogni browser deve confermare il certificato locale del server; confronta l'impronta mostrata nella console del PC server prima di accettarlo. Le altre postazioni usano lo stesso indirizzo nel browser. Completa quindi la configurazione iniziale dell'amministratore dal PC server.

## Backup automatici Google Drive

Il server conserva già snapshot locali completi. Da **Impostazioni → Account Google: Gmail e backup** l'amministratore può collegare il proprio account Google e attivare una seconda copia automatica su Drive.

1. Nel progetto Google Cloud abilita **Google Drive API** e **Gmail API**; nella schermata consenso dichiara gli scope richiesti dal CRM.
2. Crea un Client ID OAuth desktop con callback `http://127.0.0.1:3001/oauth2/gmail` e salvalo nel CRM dal PC server.
3. Collega o ricollega account Google amministratore: consenso include bozze Gmail e file creati dal CRM su Drive.
4. In **Backup automatici Google Drive** scegli intervallo (6 ore–7 giorni), copie da conservare (7–90) oppure usa **Backup ora**.

Ogni copia remota contiene database SQLite, account e allegati nella cartella Drive `CRM Marmeria - Backup automatici`. I token OAuth restano cifrati solo nella cartella dati del server; nessun token viene inviato ai browser client.

## Sviluppo

```bash
npm install
npm install --prefix server
npm run dev
```

Per provare API server locale: `npm run server`. Per distribuzione LAN usa sempre `avvia-server-lan.cmd`.
