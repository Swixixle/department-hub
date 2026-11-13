# Putting the department server online

Updated 2026-11-12. This puts the server and the app at one HTTPS address on Fly.io, so coworkers can join from their
phones with a passkey and share the board. The schedule and everything else still live in each person's browser.

## What it costs

From Fly.io's own pricing pages on 2026-11-12: a shared-cpu-1x machine with 512 MB is $3.69 a month, a volume is
$0.15 per GB-month (1 GB here), automatic daily snapshots are kept 5 days with the first 10 GB of snapshots free, and
the HTTPS certificate is free for the first 10 hostnames. There is no plan fee. Expect about $4–5 a month before data
transfer ($0.02/GB out in North America). Check fly.io/pricing when you sign up; prices change.

## The one decision that is hard to undo: the address

A passkey belongs to the exact address it was made on. The app runs at `https://<app-name>.fly.dev`. If the address
changes later (a new app name, or moving to your own domain), every member makes a new passkey through the recovery
flow. Pick the name once.

## First time

1. Install Fly's command-line tool and sign in. Creating the account and entering payment details is yours to do.

   ```sh
   brew install flyctl
   fly auth signup        # or: fly auth login
   ```

2. From the repository folder, deploy. The name becomes the address.

   ```sh
   sh scripts/deploy-fly.sh <app-name>
   ```

   This writes `fly.toml`, creates the app and a 1 GB disk in Chicago, builds the Dockerfile on Fly's builders, and
   starts one always-on machine. It ends by checking `https://<app-name>.fly.dev/api/health`.

3. Make yourself the first administrator. This runs on the server itself, so it cannot be done over the web.

   ```sh
   fly ssh console --app <app-name> -C "node server/bootstrap.mjs --db /data/hub.sqlite --department respiratory --department-name 'Respiratory Care' --name 'Your Name'"
   ```

   It prints a one-time code that works for an hour. On your phone, open `https://<app-name>.fly.dev/#join=<code>`,
   read the notice, press **Create my passkey**, then **Sign in**.

4. Invite a second administrator straight away (Board → Account → Invite a coworker, then **Make administrator** once
   they are confirmed). With one administrator, losing that phone locks the department out of its own admin controls.

## Joining, for everyone else

The administrator makes an invitation link in Account and sends it by text or in person. The coworker opens it, makes a
passkey (Face ID, fingerprint or passcode — nothing leaves the phone), and reads a six-character code back to the
administrator in person or over a number they already had. The administrator types the code under **Waiting for you to
confirm**. Then the coworker signs in.

## Updating

Run the same command again. The disk and its data stay.

```sh
sh scripts/deploy-fly.sh <app-name>
```

## What was checked, and what was not

Checked here: the container built from this Dockerfile, run with its database on a mounted volume, served the app and
the API from one address; two separate Chromium profiles with Chromium's virtual passkey authenticator joined, were
confirmed by code, posted and saw each other's posts; a removed member was signed out on the next load; and the data
was still there after the container restarted. `tests/server/client.test.mjs` covers the same flow in Node.

Not checked: a real Fly deployment, a real iPhone or Android phone, real Face ID, or HTTPS on fly.dev. Those happen the
first time it is deployed.

## Backups

Fly takes a daily snapshot of the volume and keeps it 5 days. That is the only backup this sets up. Restoring one is
`fly volumes snapshots list` and then creating a volume from a snapshot; it has not been rehearsed. A tested restore
belongs on the list before the department relies on the board for anything important.
