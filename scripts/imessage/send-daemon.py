#!/usr/bin/env python3
"""iMessage send-daemon — the local Mac half of the cloud → you iMessage channel.
Runs on the operator's Mac, NOT on the server.

JARVIS the cloud app queues outbound iMessages (proactive digests + replies) in the
imessage_outbox table. This daemon long-polls /outbox/poll, claims the next pending
message (atomic CAS via claim_next_imessage_outbox_command — FOR UPDATE SKIP LOCKED,
the proven JARVIS-note pattern), sends it through Messages.app via osascript, and
reports the outcome to /outbox/complete.

Sending a message is an OUTWARD action (it texts a real person), so `serve` and `send`
are gated behind --allow-send and MUST be run supervised the first time (the guardrail).

Reuse, not reinvention: this mirrors scripts/jarvis-note/daemon.py's serve loop, minus
the SQLCipher writer — the only local action here is an osascript send.

Config (env):
  JARVIS_APP_URL            cloud base URL (e.g. https://mydearestjarvis.vercel.app)
  IMESSAGE_INGEST_SECRET    operator bearer (the SAME secret the iMessage reader uses)

Usage:
  python3 scripts/imessage/send-daemon.py selftest
  python3 scripts/imessage/send-daemon.py send --to "+15551234567" --text "hi" --allow-send
  python3 scripts/imessage/send-daemon.py serve --allow-send [--once] [--wait-seconds 25]
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from typing import Any

POLL_PATH = "/api/integrations/imessage/outbox/poll"
COMPLETE_PATH = "/api/integrations/imessage/outbox/complete"

# AppleScript that sends one iMessage. Handle + text arrive as argv (NOT interpolated
# into the source), so there is no AppleScript/shell injection surface. Tries `buddy`
# first and falls back to `participant` (the term that resolves varies by macOS).
SEND_APPLESCRIPT = """on run argv
    set targetHandle to item 1 of argv
    set msgText to item 2 of argv
    tell application "Messages"
        set iService to 1st service whose service type = iMessage
        try
            set theTarget to buddy targetHandle of iService
        on error
            set theTarget to participant targetHandle of iService
        end try
        send msgText to theTarget
    end tell
end run
"""


# --------------------------------------------------------------------------- #
# Config + small helpers
# --------------------------------------------------------------------------- #
class Config:
    def __init__(self, args: argparse.Namespace) -> None:
        self.app_url = (getattr(args, "app_url", None) or os.environ.get("JARVIS_APP_URL") or "").strip()
        self.secret = (os.environ.get("IMESSAGE_INGEST_SECRET") or "").strip()
        self.worker = f"{socket.gethostname()}/{os.getpid()}"

    def require_network(self) -> None:
        if not self.app_url:
            raise RuntimeError("Set --app-url or JARVIS_APP_URL.")
        if not self.secret:
            raise RuntimeError("IMESSAGE_INGEST_SECRET is required (the operator bearer).")


def http_post(url: str, secret: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"POST {url} failed ({exc.code}): {detail}") from exc


# --------------------------------------------------------------------------- #
# The one local action: send via Messages.app
# --------------------------------------------------------------------------- #
def send_imessage(to_handle: str, body: str) -> dict[str, Any]:
    """Send one iMessage through Messages.app. Returns a small result dict on success;
    raises RuntimeError with osascript's stderr on failure."""
    if not to_handle or not body:
        raise RuntimeError("send_imessage requires a non-empty handle and body.")
    with tempfile.NamedTemporaryFile("w", suffix=".applescript", delete=False) as tmp:
        tmp.write(SEND_APPLESCRIPT)
        script_path = tmp.name
    try:
        proc = subprocess.run(
            ["osascript", script_path, to_handle, body],
            text=True,
            capture_output=True,
            timeout=30,
        )
    finally:
        try:
            os.unlink(script_path)
        except OSError:
            pass
    if proc.returncode != 0:
        raise RuntimeError(f"osascript send failed (rc={proc.returncode}): {proc.stderr.strip() or proc.stdout.strip()}")
    return {"sent": True, "to": to_handle, "chars": len(body)}


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #
def cmd_send(config: Config, to_handle: str, text: str, allow_send: bool) -> int:
    if not allow_send:
        raise RuntimeError("send texts a real person. Re-run with --allow-send (do the first run supervised).")
    result = send_imessage(to_handle, text)
    print(json.dumps({"send": result}, ensure_ascii=False))
    return 0


def cmd_serve(config: Config, allow_send: bool, once: bool, wait_seconds: int) -> int:
    if not allow_send:
        raise RuntimeError(
            "serve sends LIVE iMessages. Re-run with --allow-send, and do the first run "
            "supervised (the guardrail)."
        )
    config.require_network()
    poll_url = config.app_url.rstrip("/") + POLL_PATH
    complete_url = config.app_url.rstrip("/") + COMPLETE_PATH

    while True:
        resp = http_post(
            poll_url,
            config.secret,
            {"worker": config.worker, "waitSeconds": wait_seconds},
            timeout=wait_seconds + 15,
        )
        message = resp.get("message")
        if message:
            mid = message["id"]
            try:
                result = send_imessage(message["toHandle"], message["body"])
                http_post(
                    complete_url,
                    config.secret,
                    {"messageId": mid, "status": "sent", "result": result},
                    timeout=30,
                )
                print(json.dumps({"sent": mid, "kind": message.get("kind")}, ensure_ascii=False))
            except Exception as exc:  # noqa: BLE001 - report failure, keep serving
                http_post(
                    complete_url,
                    config.secret,
                    {"messageId": mid, "status": "failed", "error": str(exc)},
                    timeout=30,
                )
                print(json.dumps({"failed": mid, "error": str(exc)}), file=sys.stderr)
        if once:
            return 0


def cmd_selftest(config: Config) -> int:
    checks: list[tuple[str, bool, str]] = []

    def check(name: str, fn: Any) -> None:
        try:
            checks.append((name, True, fn()))
        except Exception as exc:  # noqa: BLE001
            checks.append((name, False, str(exc)))

    check("osascript present", lambda: subprocess.run(["which", "osascript"], capture_output=True, text=True, check=True).stdout.strip() or "found")
    check(
        "Messages iMessage service",
        lambda: (
            subprocess.run(
                ["osascript", "-e", 'tell application "Messages" to get name of 1st service whose service type = iMessage'],
                capture_output=True, text=True, timeout=15,
            ).stdout.strip() or "no iMessage service — is Messages signed in?"
        ),
    )
    check("config", lambda: f"app_url={'set' if config.app_url else 'UNSET'} secret={'set' if config.secret else 'UNSET'}")

    ok = all(passed for _, passed, _ in checks)
    for name, passed, detail in checks:
        print(f"  [{'ok' if passed else 'FAIL'}] {name}: {detail}")
    print("\nSELFTEST PASS" if ok else "\nSELFTEST FAILED")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="iMessage send-daemon (local Mac bridge).")
    parser.add_argument("--app-url", default=None)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("selftest", help="Check osascript + Messages iMessage service + config. No send/network.")

    p_send = sub.add_parser("send", help="Send one iMessage directly (isolates the osascript path). LIVE.")
    p_send.add_argument("--to", required=True, help="Recipient iMessage handle (phone/email).")
    p_send.add_argument("--text", required=True, help="Message body.")
    p_send.add_argument("--allow-send", action="store_true", help="Required: confirms a live send.")

    p_serve = sub.add_parser("serve", help="Long-poll + send queued messages (JARVIS → you). LIVE.")
    p_serve.add_argument("--allow-send", action="store_true", help="Required: enables live sends.")
    p_serve.add_argument("--once", action="store_true", help="Handle one poll cycle then exit.")
    p_serve.add_argument("--wait-seconds", type=int, default=25, help="Long-poll hold (server clamps).")

    args = parser.parse_args()
    config = Config(args)

    if args.command == "selftest":
        return cmd_selftest(config)
    if args.command == "send":
        return cmd_send(config, to_handle=args.to, text=args.text, allow_send=args.allow_send)
    if args.command == "serve":
        return cmd_serve(config, allow_send=args.allow_send, once=args.once, wait_seconds=args.wait_seconds)
    parser.error(f"unknown command {args.command}")
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:  # noqa: BLE001 - CLI should surface clear failure.
        print(f"send-daemon failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
