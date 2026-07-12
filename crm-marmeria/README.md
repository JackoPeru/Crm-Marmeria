# CRM Marmeria

Piccola applicazione CRM demo costruita con **React + Vite + TailwindCSS**.

## Requisiti

- Node.js ≥ 18
- Chiavi Firebase (in `.env`)

## Setup rapido

```bash
npm install          # installa dipendenze
npm run dev          # avvia server di sviluppo (http://localhost:5173)

## Server LAN Windows

Sul PC che deve conservare i dati, esegui `avvia-server-lan.cmd` come amministratore. Al primo avvio installa Node.js e le dipendenze mancanti, compila l'interfaccia, apre il firewall TCP `3001` e chiede i dati del primo amministratore.

Le altre postazioni nella stessa Wi-Fi aprono l'indirizzo mostrato dallo script, per esempio `https://192.168.1.20:3001`. Il primo accesso da ogni browser richiede conferma del certificato locale: confronta l'impronta visualizzata nella finestra del server prima di accettarla.
