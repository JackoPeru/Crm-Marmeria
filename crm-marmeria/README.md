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

Sul PC che deve conservare i dati, esegui `avvia-server-lan.cmd`. Al primo avvio installa Node.js e le dipendenze mancanti, compila l'interfaccia, apre il firewall TCP `3001` e crea account `admin` con password `marmo2026!`.

Le altre postazioni nella stessa Wi-Fi aprono indirizzo mostrato, per esempio `http://192.168.1.20:3001`. Cambia password admin appena possibile: traffico LAN non è cifrato.
