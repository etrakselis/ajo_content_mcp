#!/bin/sh
set -eu

CREDENTIALS_FILE="${AJO_CREDENTIALS_FILE:-/app/config/credentials.json}"
SETTINGS_FILE="${AJO_SETTINGS_FILE:-/app/config/settings.json}"
GENERATED_CREDENTIALS_ENV_FILE="${AJO_GENERATED_CREDENTIALS_ENV_FILE:-/app/.env.credentials}"
GENERATED_SETTINGS_ENV_FILE="${AJO_GENERATED_SETTINGS_ENV_FILE:-/app/.env.settings}"

if [ -f "$SETTINGS_FILE" ]; then
  node /app/scripts/load-settings-env.mjs "$SETTINGS_FILE" "$GENERATED_SETTINGS_ENV_FILE"
  . "$GENERATED_SETTINGS_ENV_FILE"
elif [ -f /app/.env.settings ]; then
  . /app/.env.settings
fi

if [ -f "$CREDENTIALS_FILE" ]; then
  node /app/scripts/load-credentials-env.mjs "$CREDENTIALS_FILE" "$GENERATED_CREDENTIALS_ENV_FILE"
  . "$GENERATED_CREDENTIALS_ENV_FILE"
elif [ -f /app/.env.credentials ]; then
  . /app/.env.credentials
fi

if [ -f /app/.env ]; then
  . /app/.env
fi

exec "$@"
