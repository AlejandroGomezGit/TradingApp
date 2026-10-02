# CLAUDE.md — Crypto Trading Bot

## Proyecto
Bot de trading autónomo de crypto que opera via **Alpaca Markets API**, usando TypeScript/Node.js.
Integra **CoinGecko** para sentimiento y usa **Claude AI** para decisiones de trading.

## Estado actual
**Fase 2: Paper Trading** — Alpaca paper trading (`https://paper-api.alpaca.markets`)

## Estructura clave

```
backend/src/
├── services/
│   ├── alpaca.service.ts     — Alpaca API: account, positions, orders, bars
│   ├── claude.service.ts     — Claude AI: trade decisions + journal reflections
│   ├── coingecko.service.ts  — Fear & Greed Index + trending coins
│   ├── research.service.ts   — Indicadores técnicos: RSI, MACD, Bollinger, EMA, ATR
│   ├── risk.service.ts       — RiskManager: TODAS las reglas de riesgo
│   ├── trading.service.ts    — Ejecución de órdenes (pasa por RiskManager)
│   ├── journal.service.ts    — Portfolio snapshots + journal entries en DB
│   └── email.service.ts      — Reporte diario por email
├── scheduler/
│   └── index.ts              — node-cron: 6 rutinas diarias + snapshot horario
├── backtest/
│   ├── engine.ts             — Motor de simulación histórica
│   ├── metrics.ts            — Sharpe, drawdown, win rate, profit factor
│   └── runner.ts             — Entry point: npm run backtest
├── tasks/
│   └── runner.ts             — CLI para correr tareas manualmente
├── db/
│   ├── connection.ts         — PostgreSQL pool
│   └── migrations.ts         — Tablas: watchlist, trades, journal, snapshots, heartbeats
└── routes/
    ├── agent.routes.ts       — /api/agent: triggers manuales de rutinas
    ├── portfolio.routes.ts
    ├── trades.routes.ts
    ├── journal.routes.ts
    └── watchlist.routes.ts
```

## Rutina diaria (horario Colombia UTC-5 / ET)

| Colombia    | ET    | Tarea          | Descripción                                           |
|-------------|-------|----------------|-------------------------------------------------------|
| 08:00       | 09:00 | morning-scan   | Fear & Greed, trending coins, portfolio init          |
| 09:00       | 10:00 | strategy-eval  | RSI, MACD, Bollinger, EMA, ATR — todos los símbolos   |
| 09:15       | 10:15 | place-orders   | Órdenes conservadoras que pasan RiskManager           |
| 12:00       | 13:00 | midday-review  | Circuit breaker, trailing stops, emergency            |
| 16:15       | 17:15 | journal-entry  | Diario, email, reset de estado                        |
| 18:00       | 19:00 | evening-scan   | Oportunidades para mañana                             |
| Hourly :00  | 9-17  | snapshot       | Guarda portfolio_value en DB                          |
| **Hourly :30** | **24/7** | **volatile-scan** | **Crypto + volátiles: stops + señales cada hora** |

## Arquitectura de dos buckets

### 🔵 Bucket Conservador (80% del portfolio = ~$80,000)
Símbolos: SPY, QQQ, NVDA, AAPL, MSFT, META, AMZN, XLK, SOXX

| Regla | Valor |
|-------|-------|
| Max por trade | 2% del portfolio |
| Max posiciones | 3 simultáneas |
| Stop-loss | -4% desde entrada |
| Emergency stop | -6% |
| Trailing stop | -3% activado a +3% |
| Circuit breaker | -5% P&L diario → detiene TODO |
| Solo limit orders | ask+0.1% compras / bid-0.1% ventas |

### 🔴 Bucket Volátil (20% del portfolio = ~$20,000)
Símbolos: BTC/USD, ETH/USD, SOL/USD, TSLA, ARKK

| Regla | Valor |
|-------|-------|
| Max por trade | 1% del portfolio (~$1,000) |
| Max posiciones | 3 simultáneas |
| Stop-loss | -8% (crypto necesita espacio) |
| Emergency stop | -15% |
| Trailing stop | -5% activado a +5% |
| Circuit breaker propio | -10% del bucket → detiene solo volátiles |
| Crypto 24/7 | Sí (BTC/USD, ETH/USD, SOL/USD) |
| Correlation guard | No BTC+ETH, BTC+SOL, ETH+SOL simultáneos |

## Señales compuestas (research.service.ts)

Las 3 deben alinearse. `confidence >= 0.65` para ejecutar.

- **RSI(14)**: <35 oversold (buy bias), >70 overbought (sell bias)
- **MACD**: crossover alcista = señal positiva
- **Bollinger Bands(20,2)**: precio en banda inferior + RSI oversold = buy fuerte
- **EMA 9/21**: confirmación de tendencia
- **ATR(14)**: dynamic stop-loss = entry - 1.5×ATR
- **Fear & Greed (CoinGecko)**: <25 buy contrarian, >80 sell contrarian

## Comandos principales

```bash
# Desarrollo
cd backend
npm run dev           # Servidor con hot-reload

# Backtest (Fase 1)
npm run backtest      # Simula estrategia en datos históricos

# Tareas manuales (Fase 2)
npm run task:morning  # morning-scan
npm run task:strategy # strategy-eval
npm run task:orders   # place-orders
npm run task:midday   # midday-review
npm run task:evening  # evening-scan
npm run task:journal  # journal-entry

# Base de datos
npm run migrate       # Crea tablas en PostgreSQL
```

## Variables de entorno requeridas (.env)

```
ALPACA_API_KEY_ID=
ALPACA_API_SECRET_KEY=
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ANTHROPIC_API_KEY=
COINGECKO_API_KEY=           # opcional, mejora rate limits
DB_HOST=localhost
DB_PORT=5432
DB_USER=alejandro
DB_NAME=trading
GMAIL_USER=alejandrogomezg49@gmail.com
GMAIL_APP_PASSWORD=
NOTIFY_EMAIL=alejandrogomezg49@gmail.com
MAX_POSITION_PCT=2
CASH_RESERVE_PCT=20
STOP_LOSS_PCT=4
BACKTEST_CAPITAL=100000
BACKTEST_LOOKBACK=365
DEFAULT_SYMBOLS=SPY,QQQ,NVDA,AAPL,MSFT
```

## Watchlist actual (PostgreSQL)

### Conservador
| Símbolo | Descripción | Max alloc |
|---------|-------------|-----------|
| SPY | S&P 500 ETF | 15% |
| QQQ | Nasdaq-100 ETF | 10% |
| NVDA | GPU/AI | 8% |
| AAPL | Large cap tech | 8% |
| MSFT | Cloud/enterprise | 8% |
| META | Social/AI ads | 6% |
| AMZN | Cloud + e-commerce | 6% |
| XLK | Tech sector ETF | 8% |
| SOXX | Semiconductor ETF | 6% |

### Volátil
| Símbolo | Descripción | Max alloc |
|---------|-------------|-----------|
| BTC/USD | Bitcoin | 3% |
| ETH/USD | Ethereum | 2% |
| SOL/USD | Solana | 1.5% |
| TSLA | Tesla EV/AI | 3% |
| ARKK | ARK Innovation ETF | 2% |

## Base de datos (PostgreSQL)
- `watchlist` — símbolos activos y sus límites de allocación
- `trades` — historial de órdenes ejecutadas
- `journal_entries` — diarios diarios con P&L y reflexión de Claude
- `portfolio_snapshots` — valor del portafolio por día
- `agent_heartbeats` — logs de ejecución de cada rutina

## Arquitectura
El servidor Express corre continuamente y el `node-cron` interno dispara las rutinas.
No se necesita crontab externo del sistema para las rutinas de trading —
todo corre dentro del proceso Node.js.

Los **Claude Scheduled Tasks** (Cowork) complementan el bot con análisis
inteligente diario, alertas de performance y resumen semanal.

## Notas importantes para el agente
- El bot es de **paper trading** — ninguna orden usa dinero real hasta cambiar ALPACA_BASE_URL
- Siempre verificar que el circuit breaker (conservador) Y el volatile circuit breaker antes de nuevas órdenes
- Crypto (BTC/USD, ETH/USD, SOL/USD) opera 24/7 — el volatile-scan corre cada hora sin restricción de horario
- Los logs están en `backend/logs/` (Winston)
- El email diario se envía a alejandrogomezg49@gmail.com vía Gmail SMTP
- `ai-decisions.json` debe incluir decisiones para los **14 símbolos** (9 conservadores + 5 volátiles)
- Las decisiones del bucket volátil son leídas por `volatile-scan` cada hora; las conservadoras por `place-orders` a las 10:15 ET
- Para acciones volátiles stock (TSLA, ARKK): `volatile-scan` verifica market hours antes de ejecutar
- Para crypto (BTC/USD, ETH/USD, SOL/USD): sin restricción de horario, órdenes 24/7
