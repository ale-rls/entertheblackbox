#!/usr/bin/env bash
# Provisions an admin-dashboard operator account. Operators are provisioned
# by whoever holds the PocketBase superuser credentials (createRule on the
# `operators` collection is superuser-only) -- there is no public signup.
#
# Usage:
#   pocketbase/scripts/create-operator.sh <email> <password>
#
# Env:
#   POCKETBASE_URL (default http://127.0.0.1:8090)
#   POCKETBASE_ADMIN_EMAIL (default dev@smartphonecracy.local)
#   POCKETBASE_ADMIN_PASSWORD (default dev-pocketbase-password)
set -euo pipefail

EMAIL="${1:?usage: create-operator.sh <email> <password>}"
PASSWORD="${2:?usage: create-operator.sh <email> <password>}"
URL="${POCKETBASE_URL:-http://127.0.0.1:8090}"
ADMIN_EMAIL="${POCKETBASE_ADMIN_EMAIL:-dev@smartphonecracy.local}"
ADMIN_PASSWORD="${POCKETBASE_ADMIN_PASSWORD:-dev-pocketbase-password}"

TOKEN=$(curl -sf -X POST "${URL}/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "{\"identity\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -sf -X POST "${URL}/api/collections/operators/records" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"passwordConfirm\":\"${PASSWORD}\",\"role\":\"operator\",\"emailVisibility\":true,\"verified\":true}" \
  | python3 -m json.tool

echo "OK: created operator ${EMAIL}"
