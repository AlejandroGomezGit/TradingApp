# Guía de Comandos — Trading Bot

## 1. Arrancar el bot (primera vez)

```bash
# Terminal 1 — asegúrate de tener PostgreSQL corriendo
cd ~/Codigos/trading-app/backend

# Crear las tablas en la base de datos (solo la primera vez)
npm run migrate

# Arrancar el servidor con hot-reload
npm run dev
```

El servidor queda corriendo en http://localhost:3000
El scheduler interno arranca automáticamente y ejecutará las rutinas en su horario.

---

## 2. Verificar que todo funciona

```bash
# ¿Está vivo el servidor?
curl http://localhost:3000/api/health

# Ver estado del portfolio + posiciones + circuit breaker
curl http://localhost:3000/api/agent/status
```

---

## 3. Ejecutar rutinas manualmente (sin esperar el cron)

```bash
# Scan matutino (Fear & Greed, inicializa portfolio)
curl -X POST http://localhost:3000/api/agent/morning

# Correr análisis técnico (RSI, MACD, Bollinger, EMA, ATR)
curl -X POST http://localhost:3000/api/agent/strategy

# Ejecutar órdenes automáticas (pasan por RiskManager)
curl -X POST http://localhost:3000/api/agent/orders

# Revisión de mediodía (trailing stops, circuit breaker)
curl -X POST http://localhost:3000/api/agent/midday

# Scan nocturno (oportunidades para mañana)
curl -X POST http://localhost:3000/api/agent/evening

# Escribir diario del día + enviar email
curl -X POST http://localhost:3000/api/agent/journal
```

---

## 4. COMPRAR y VENDER manualmente

### Comprar acciones
```bash
# Comprar NVDA (qty automática basada en 2% del portfolio)
curl -X POST http://localhost:3000/api/agent/order/buy \
  -H "Content-Type: application/json" \
  -d '{"symbol": "NVDA"}'

# Comprar NVDA especificando cantidad
curl -X POST http://localhost:3000/api/agent/order/buy \
  -H "Content-Type: application/json" \
  -d '{"symbol": "NVDA", "qty": 3}'

# Comprar SPY
curl -X POST http://localhost:3000/api/agent/order/buy \
  -H "Content-Type: application/json" \
  -d '{"symbol": "SPY"}'
```

⚠️ Cada compra pasa por el RiskManager:
- Máximo 2% del portfolio por trade
- Máximo 3 posiciones abiertas
- Si hay circuit breaker activo → rechazada

### Vender (cerrar posición)
```bash
# Cerrar posición completa de NVDA
curl -X POST http://localhost:3000/api/agent/order/sell \
  -H "Content-Type: application/json" \
  -d '{"symbol": "NVDA"}'
```

### Cancelar todas las órdenes pendientes
```bash
curl -X DELETE http://localhost:3000/api/agent/orders
```

---

## 5. Ver datos de mercado

```bash
# Ver estado de todos los símbolos de la watchlist
curl -X POST http://localhost:3000/api/agent/research

# Ver datos de un símbolo específico
curl http://localhost:3000/api/agent/research/NVDA
curl http://localhost:3000/api/agent/research/SPY
```

---

## 6. Ver historial en la base de datos

```bash
# Portfolio actual
curl http://localhost:3000/api/portfolio

# Últimas trades ejecutadas
curl http://localhost:3000/api/trades

# Entradas del diario
curl http://localhost:3000/api/journal

# Watchlist activa
curl http://localhost:3000/api/watchlist
```

---

## 7. Backtest (Fase 1)

```bash
cd ~/Codigos/trading-app/backend
npm run backtest
```

Simula la estrategia con datos históricos de Alpaca y muestra:
- Sharpe ratio, Max drawdown, Win rate, Profit factor
- Log de cada trade simulado
- Evaluación: ¿listo para Fase 2 (paper trading)?

---

## 8. Tareas manuales (sin servidor corriendo)

```bash
# Correr una rutina sin levantar el servidor Express
npm run task:morning
npm run task:strategy
npm run task:orders
npm run task:midday
npm run task:evening
npm run task:journal
```

---

## Notas importantes

- **Paper trading**: todas las órdenes son virtuales. Nadie pierde dinero real.
- **RiskManager**: SIEMPRE se ejecuta antes de cualquier orden. No se puede saltar.
- **Circuit breaker**: si el P&L del día cae -5%, el bot para de operar automáticamente.
- **Logs**: revisa `backend/logs/` para ver qué hizo el bot.
- **Diarios**: los reportes de Claude Scheduled Tasks se guardan en `journal/`.
