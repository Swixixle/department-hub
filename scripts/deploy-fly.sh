#!/bin/sh
# Puts the department server on Fly.io, or updates it.
#
#   sh scripts/deploy-fly.sh <app-name>          first time: creates the app, its disk, and deploys
#   sh scripts/deploy-fly.sh <app-name>          later: deploys the current code; the disk and its data stay
#
# The app is then at https://<app-name>.fly.dev. Passkeys are tied to that exact address: change it later and every
# member has to make a new passkey. Pick the name once.
#
# Needs: flyctl (brew install flyctl) and a Fly account you have signed in to (fly auth login).
# This script creates no account, enters no payment details and sends nobody anything.
set -eu

APP="${1:-}"
REGION="${FLY_REGION:-ord}"            # Chicago, the closest Fly region to Indiana
if [ -z "$APP" ]; then
  echo "Give the app a name: sh scripts/deploy-fly.sh <app-name>   (lowercase letters, numbers and dashes)" >&2
  exit 1
fi
case "$APP" in *[!a-z0-9-]*) echo "The name can only have lowercase letters, numbers and dashes." >&2; exit 1;; esac
command -v fly >/dev/null 2>&1 || { echo "flyctl is not installed. Run: brew install flyctl" >&2; exit 1; }
fly auth whoami >/dev/null 2>&1 || { echo "Not signed in to Fly. Run: fly auth login" >&2; exit 1; }

cd "$(dirname "$0")/.."
HOST="$APP.fly.dev"

# The configuration, written fresh each time from the name, so nothing has to be edited by hand.
cat > fly.toml <<EOF
# Written by scripts/deploy-fly.sh. Re-running the script rewrites it.
app = "$APP"
primary_region = "$REGION"

[build]

[env]
  DEPARTMENT_HUB_RP_ID = "$HOST"
  DEPARTMENT_HUB_RP_ORIGIN = "https://$HOST"
  DEPARTMENT_HUB_RP_NAME = "Department Hub"
  DEPARTMENT_HUB_BUILD = "fly"

[[mounts]]
  source = "hub_data"
  destination = "/data"

[http_service]
  internal_port = 8080
  force_https = true
  # Always on: a sleeping server would make the first person each shift wait while it wakes.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    path = "/api/health"
    timeout = "5s"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
EOF

if ! fly apps list 2>/dev/null | awk '{print $1}' | grep -qx "$APP"; then
  echo "Creating the app $APP..."
  fly apps create "$APP"
fi
if ! fly volumes list --app "$APP" 2>/dev/null | grep -q hub_data; then
  echo "Creating a 1 GB disk for the database in $REGION..."
  fly volumes create hub_data --app "$APP" --region "$REGION" --size 1 --yes
fi

echo "Deploying..."
fly deploy --app "$APP" --ha=false

echo
echo "Running at https://$HOST"
curl -fsS "https://$HOST/api/health" && echo
echo
echo "First time only: make yourself the first administrator with"
echo "  fly ssh console --app $APP -C \"node server/bootstrap.mjs --db /data/hub.sqlite --department respiratory --department-name 'Respiratory Care' --name 'YOUR NAME'\""
echo "It prints a one-time code. Open https://$HOST/#join=<that code> on your phone."
