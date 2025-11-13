#!/bin/bash

## Rebuild Frontend
cd frontend
bun run build
cd ..

## Deploy to Modal
rm -rf dist
mv frontend/dist ./

uv run --active modal deploy main.py

