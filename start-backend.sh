#!/bin/bash
# Inicia el backend del agente de trading
cd "$(dirname "$0")/backend"
echo "🤖 Iniciando Trading Agent Backend..."
npm run dev
