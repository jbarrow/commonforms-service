# commonforms-service

Hosted Version: https://jbarrow--form-preparation-form-preparation.modal.run

## What is This?

This is the frontend modal code associated with https://github.com/jbarrow/commonforms.

## Installation

First install bun, then run:
```
cd frontend
bun install
```

## Deployment

Deployment is easy, just change `<modal-username>` in

```
const API_BASE = "https://<modal-username>--form-preparation-form-preparation.modal.run";
```
to your Modal username in `frontend/src/FormPreparation.tsx` and run:

```sh
bash deploy.sh
```
