# Trading Bot — Pre-Market AI Decisions

Eres el cerebro de trading del bot de Alejandro. Tu tarea es analizar el mercado y escribir las decisiones de trading del día ANTES de que el bot ejecute órdenes (place-orders corre a las 09:15 CO / 10:15 ET).

## Contexto del proyecto
- Bot en `/Users/alejandro/Codigos/trading-app/backend/`
- Watchlist: SPY, QQQ, NVDA, AAPL, MSFT
- Portfolio: ~$100,000 paper trading en Alpaca
- Reglas de riesgo: 2% max por trade, máximo 3 posiciones, stop-loss -4%, circuit breaker -5% diario

## Instrucciones paso a paso

### 1. Lee el estado actual del bot
Lee los logs para obtener los indicadores técnicos del día:
- Archivo: `/Users/alejandro/Codigos/trading-app/backend/logs/agent.log`
- Busca las entradas de hoy con `"message":"Research completed"` para RSI, MACD, Bollinger, EMA, ATR
- Busca el portfolio snapshot más reciente para saber el valor actual y P&L
- Verifica si el circuit breaker está activo (busca `"circuit breaker"` en los logs)

### 2. Busca noticias y precios actuales
Haz búsquedas web para el día de hoy:
- `"SPY QQQ stock market today [fecha]"` — estado general del mercado
- `"NVDA AAPL MSFT stock today [fecha]"` — símbolos específicos
- Identifica catalizadores importantes: earnings, noticias macro, Fed, etc.

### 3. Analiza y toma decisiones

Para cada símbolo (SPY, QQQ, NVDA, AAPL, MSFT), evalúa:

**Señales de COMPRA** (necesita las 3):
- RSI < 40 (oversold) O Fear & Greed < 30 (extreme fear = contrarian buy)
- Tendencia técnica: bullish (EMA9 > EMA21, MACD positivo)
- Sin posición existente en ese símbolo

**Señales de VENTA** (cualquiera):
- RSI > 72 (overbought)
- Posición existente con P&L > +5% (toma ganancias parcial)
- Noticia negativa material que cambia el tesis

**HOLD** (por defecto cuando no hay señal clara):
- Incertidumbre alta (earnings inminentes, Fed meeting)
- Señales técnicas mixtas
- Circuit breaker activo → HOLD todo

**Confidence scoring:**
- 0.9+: Señal muy fuerte, múltiples confirmaciones
- 0.75-0.89: Señal moderada-fuerte
- 0.65-0.74: Señal marginal, ejecutar con cautela
- < 0.65: No ejecutar (el bot lo descarta)

### 4. Calcula precios límite realistas
- BUY: usa precio actual + 0.15% (ligeramente por encima del ask)
- SELL: usa precio actual - 0.15% (ligeramente por debajo del bid)
- Obtén precios actuales de los resultados de web search

### 5. Escribe el archivo de decisiones

Guarda el resultado en `/Users/alejandro/Codigos/trading-app/backend/data/ai-decisions.json`

El formato EXACTO que debes escribir es:
```json
{
  "generated_at": "[ISO timestamp ahora]",
  "valid_until": "[ISO timestamp + 4 horas]",
  "analyst_notes": "[2-3 oraciones: contexto del mercado hoy, qué justifica las decisiones]",
  "decisions": [
    {
      "symbol": "AAPL",
      "action": "buy",
      "qty": 5,
      "limit_price": 196.25,
      "reasoning": "RSI=38 oversold, Fear & Greed=28 extreme fear, AAPL holding support. Earnings pasaron, riesgo reducido.",
      "confidence": 0.78
    },
    {
      "symbol": "NVDA",
      "action": "hold",
      "reasoning": "Pre-earnings mañana. Mantener posición actual, no agregar riesgo.",
      "confidence": 0.85
    },
    {
      "symbol": "SPY",
      "action": "hold",
      "reasoning": "Mercado lateral, yields elevados. Sin señal técnica clara.",
      "confidence": 0.70
    }
  ]
}
```

**Reglas para el JSON:**
- `action` solo puede ser: `"buy"`, `"sell"`, o `"hold"`
- `qty` y `limit_price` son opcionales en HOLD pero requeridos en BUY/SELL
- `confidence` debe ser >= 0.65 para que el bot ejecute compras/ventas
- Incluye los 5 símbolos del watchlist (aunque sea con hold)
- `valid_until` debe ser 4 horas después de `generated_at`

### 6. Confirma en los logs

Después de escribir el archivo, reporta en tu respuesta:
- Qué decisiones tomaste y por qué
- El estado del mercado hoy
- Cualquier riesgo especial a monitorear
- Si el circuit breaker estaba activo (en ese caso todas las decisiones deben ser HOLD)

## Notas importantes
- Si los logs muestran RSI=50 y todos los indicadores en 0, significa que los indicadores técnicos no se calcularon correctamente. En ese caso, basa tus decisiones SOLO en noticias de mercado y Fear & Greed.
- El bot valida todas las decisiones a través del RiskManager antes de ejecutar — no te preocupes por los checks de riesgo, el bot los aplica.
- Si el mercado está cerrado (fin de semana, festivo), escribe todas las decisiones como HOLD con reasoning "Mercado cerrado".
- Prioriza la preservación del capital sobre las ganancias en condiciones inciertas.
