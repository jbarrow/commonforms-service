#!/bin/bash

URL="https://jbarrow--form-preparation-form-preparation.modal.run"

DOC_ID=$(
    curl -s -X POST "${URL}/upload" \
        -H "Accept: application/json" \
        -F "file=@test.pdf;type=application/pdf" \
    | jq -r '.documentId'
)

if [ -z "$DOC_ID" ]; then
    echo "Failed to parse documentId" >&2
    exit 1
fi

echo "Document ID: $DOC_ID"

RESPONSE=$(
    curl -s -X POST "${URL}/detect" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -d '{"documentId": "'"$DOC_ID"'", "config": {"model": "small", "use_signature_fields": false, "keep_existing_fields": false}}'
)

echo $RESPONSE

STATUS=$(echo $RESPONSE | jq -r '.status')

if [ -z "$STATUS" ] ; then
    echo "Blank status returned"
    echo $RESPONSE
    exit 1
fi

echo "Status: $STATUS"

while [[ "$STATUS" = "enqueued" || "$STATUS" = "running" ]] ; do
    RESPONSE=$(
        curl -s -X GET "${URL}/poll?documentId=${DOC_ID}" \
            -H "Content-Type: application/json" \
            -H "Accept: application/json"
    )

    STATUS=$(echo $RESPONSE | jq -r '.status')

    sleep 1

    echo "Response: $RESPONSE"
done


