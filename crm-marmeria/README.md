# CRM Marmeria — server browser LAN

CRM Marmeria si usa esclusivamente dal browser. Un PC della rete ospita dati, API e interfaccia web; telefoni e altri PC aprono il suo indirizzo LAN. Non esistono installer o applicazioni desktop.

## Primo avvio del server

Sul PC che conserva i dati esegui solo `avvia-server-lan.cmd`.

Richiede Windows 10 1809 o successivo, connessione Internet e autorizzazione amministratore. Il file installa WinGet, Node.js LTS e Git se mancanti, installa dipendenze, compila interfaccia, apre firewall privato TCP `3001` e avvia il server.

Apri uno degli indirizzi mostrati, per esempio `https://192.168.1.20:3001`. Al primo collegamento ogni browser deve confermare il certificato locale del server; confronta l'impronta mostrata nella console del PC server prima di accettarlo. Le altre postazioni usano lo stesso indirizzo nel browser. Completa quindi la configurazione iniziale dell'amministratore dal PC server.

## HTTPS attendibile in produzione

Il launcher usa un certificato self-signed locale per il server LAN. Al primo collegamento ogni browser deve confermare il certificato dopo aver verificato l'impronta mostrata nella console del PC server.

La configurazione di un certificato attendibile è intenzionalmente rimandata finché non sono noti host e dominio dell'ambiente di deployment. Fino ad allora usa l'indirizzo LAN mostrato dal launcher.

## Backup automatici Google Drive

Il server conserva già snapshot locali completi. Da **Impostazioni → Account Google: Gmail e backup** l'amministratore può collegare il proprio account Google e attivare una seconda copia automatica su Drive.

1. Nel progetto Google Cloud abilita **Google Drive API** e **Gmail API**; nella schermata consenso dichiara gli scope richiesti dal CRM.
2. Crea un Client ID OAuth desktop con callback `http://127.0.0.1:3001/oauth2/gmail` e salvalo nel CRM dal PC server.
3. Collega o ricollega account Google amministratore: consenso include bozze Gmail e file creati dal CRM su Drive.
4. In **Backup automatici Google Drive** scegli intervallo (6 ore–7 giorni), copie da conservare (7–90) oppure usa **Backup ora**.

Ogni copia remota contiene database SQLite, account e allegati nella cartella Drive `CRM Marmeria - Backup automatici`. I token OAuth restano cifrati solo nella cartella dati del server; nessun token viene inviato ai browser client.

## Fatturazione elettronica SdI con PEC Aruba

Da **Impostazioni → Fatturazione elettronica SdI — PEC Aruba**, aprendo il CRM direttamente sul PC server, l'amministratore configura ragione sociale, dati fiscali, sede, indirizzo PEC e password della casella. La password resta cifrata nella cartella dati del server e non viene mai restituita al browser.

1. Per Aruba il CRM usa SMTP `smtps.pec.aruba.it:465` e IMAP `imaps.pec.aruba.it:993`, entrambi SSL/TLS. Con verifica in due passaggi Aruba usa la password dedicata per programmi di posta.
2. Salva configurazione e premi **Testa SMTP e IMAP** prima di emettere una fattura.
3. Completa nei clienti dati anagrafici/fiscali, indirizzo, CAP, comune, provincia e codice destinatario o PEC. Per persone fisiche completa anche nome e cognome SdI.
4. In una fattura l'amministratore usa **Invia a SdI via PEC**: CRM esegue il preflight, genera XML FatturaPA, richiede conferma esplicita e lo invia a `sdi01@pec.fatturapa.it`.
5. XML, invio e ricevute restano archiviati sul PC server. Il CRM legge periodicamente la PEC e mostra `scartata`, `consegnata` oppure `mancata consegna`. Una fattura trasmessa non è più modificabile o eliminabile; per rettificarla crea documento `TD04 — Nota di credito`.

Non usare il primo invio come prova tecnica: un invio PEC accettato è un'operazione fiscale. Attiva inoltre il servizio di conservazione elettronica a norma nell'area **Fatture e Corrispettivi** dell'Agenzia delle Entrate oppure usa il servizio del commercialista.

## Sviluppo

```bash
npm install
npm install --prefix server
npm run dev
```

Per provare API server locale: `npm run server`. Per distribuzione LAN usa sempre `avvia-server-lan.cmd`.
