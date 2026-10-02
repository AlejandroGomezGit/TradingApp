# Trading App

Bot de trading autónomo (paper trading) sobre [Alpaca Markets](https://alpaca.markets), con decisiones asistidas por Claude, indicadores técnicos, gestión de riesgo con circuit breakers y un dashboard en Angular.

> ⚠️ **Solo paper trading.** Ninguna orden usa dinero real mientras `ALPACA_BASE_URL` apunte a `https://paper-api.alpaca.markets`. Nada de este repositorio es asesoría financiera.

## Stack

- **Backend**: Node.js + TypeScript, Express, Socket.IO, `node-cron`, PostgreSQL, Winston
- **IA**: Anthropic Claude (decisiones de trading y reflexiones del diario)
- **Datos**: Alpaca (cuenta, órdenes, barras) y CoinGecko (Fear & Greed, trending)
- **Frontend**: Angular (dashboard)

## Estructura

```
backend/    API + scheduler + servicios (Alpaca, Claude, riesgo, backtest)
frontend/   Dashboard Angular
CLAUDE.md   Reglas de la estrategia y guía para el agente
COMANDOS.md Guía de comandos de operación
```

## Requisitos

- Node.js 22+
- PostgreSQL local
- Cuenta de Alpaca (paper), API key de Anthropic y, opcionalmente, Gmail con contraseña de aplicación

## Puesta en marcha

```bash
# Backend
cd backend
cp .env.example .env      # completa tus credenciales
npm install
npm run migrate           # crea las tablas
npm run dev               # http://localhost:3000

# Frontend (otra terminal)
cd frontend
npm install
npx ng serve              # http://localhost:4200
```

También puedes usar `./start-backend.sh` y `./start-frontend.sh`.

## Comandos útiles (backend)

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor con hot-reload |
| `npm run build && npm start` | Compilar y ejecutar |
| `npm run backtest` | Simulación sobre datos históricos |
| `npm run task:<morning\|strategy\|orders\|midday\|evening\|journal>` | Ejecutar una rutina manualmente |
| `npm run bot:start` / `bot:stop` / `bot:logs` | Gestionar el proceso con PM2 |

Más detalle en [COMANDOS.md](COMANDOS.md) y las reglas de riesgo en [CLAUDE.md](CLAUDE.md).

## Seguridad

- Las credenciales viven solo en `backend/.env` (ignorado por git). Usa `backend/.env.example` como plantilla.
- Los logs, `backend/data/` y `journal/` se excluyen del repositorio porque contienen datos de tu cuenta.
- Si alguna vez subes una clave por error, revócala y genera una nueva.
