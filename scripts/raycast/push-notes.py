#!/usr/bin/env python3
"""Operator-only Raycast Notes reader — runs on the operator's Mac, NOT on the server.

Raycast stores Notes in a SQLCipher-encrypted SQLite database at
~/Library/Application Support/com.raycast.macos/raycast-enc.sqlite. The decryption key
lives in the macOS Keychain (service "Raycast", account "database_key"); the passphrase
is sha256(database_key + salt). This script decrypts that DB locally, renders each note's
ProseMirror document JSON to markdown, extracts checkbox tasks and freeform bullets, and
POSTs a full snapshot to the hidden /api/integrations/raycast/ingest webhook. The server
never sees the encrypted DB or the Keychain key — all macOS-specific work happens here.

The decryption + markdown/item parsing is lifted from the Claude - Scheduler exporter
(scripts/raycast_notes_export.py), which has run against this DB in production.

REQUIREMENTS
  - `sqlcipher` CLI: `brew install sqlcipher`
  - The process needs read access to the Raycast DB and Keychain (run as the operator).
  - Python 3.9+ (stdlib only — no pip installs).

USAGE
  RAYCAST_INGEST_SECRET=... JARVIS_APP_URL=https://mydearestjarvis.vercel.app \
    python3 scripts/raycast/push-notes.py [--dry-run]

Schedule it (cron / launchd / a Claude scheduled task) for ongoing intake. The server
idle-skips byte-identical snapshots, so re-running when nothing changed is cheap and
writes nothing. See docs/decisions/operator-only-raycast.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_DB = Path.home() / "Library/Application Support/com.raycast.macos/raycast-enc.sqlite"
DATABASE_SALT = "yvkwWXzxPPBAqY2tmaKrB*DvYjjMaeEf"
SEPARATOR = "<<<RAYCAST_SEP>>>"
INGEST_PATH = "/api/integrations/raycast/ingest"


@dataclass
class RaycastNote:
    note_id: str
    title: str
    markdown: str
    created_at: str
    modified_at: str
    pinned: bool


# --- Decryption (mirrors the Scheduler exporter) ---------------------------------


def decode_hex_text(value: str) -> str:
    if not value:
        return ""
    return bytes.fromhex(value).decode("utf-8", errors="replace")


def uuid_from_hex(value: str) -> str:
    normalized = value.upper()
    if len(normalized) != 32:
        return normalized
    return "-".join(
        [normalized[0:8], normalized[8:12], normalized[12:16], normalized[16:20], normalized[20:32]]
    )


def keychain_value(account: str) -> str:
    try:
        return subprocess.check_output(
            ["security", "find-generic-password", "-s", "Raycast", "-a", account, "-w"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"Could not read Raycast Keychain account `{account}`") from exc


def sqlcipher_binary() -> str:
    found = shutil.which("sqlcipher")
    if found:
        return found
    homebrew = Path("/opt/homebrew/bin/sqlcipher")
    if homebrew.exists():
        return str(homebrew)
    raise RuntimeError("Could not find `sqlcipher`; install with `brew install sqlcipher`.")


def derive_passphrase() -> str:
    database_key = keychain_value("database_key")
    return hashlib.sha256((database_key + DATABASE_SALT).encode("utf-8")).hexdigest()


def copy_database(source: Path, temp_dir: Path) -> Path:
    copied = temp_dir / source.name
    shutil.copy2(source, copied)
    for suffix in ("-wal", "-shm"):
        sidecar = source.with_name(source.name + suffix)
        if sidecar.exists():
            shutil.copy2(sidecar, temp_dir / (source.name + suffix))
    return copied


def run_sqlcipher(db_path: Path, sql: str) -> str:
    proc = subprocess.run(
        [sqlcipher_binary(), str(db_path)],
        input=sql,
        text=True,
        capture_output=True,
        timeout=15,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "sqlcipher failed")
    if proc.stderr.strip():
        raise RuntimeError(proc.stderr.strip())
    return proc.stdout


# --- ProseMirror document -> markdown --------------------------------------------


def inline_to_md(node: dict[str, Any]) -> str:
    node_type = node.get("type")
    if node_type == "text":
        text = node.get("text", "")
        for mark in node.get("marks") or []:
            mark_type = mark.get("type")
            if mark_type == "bold":
                text = f"**{text}**"
            elif mark_type == "italic":
                text = f"*{text}*"
            elif mark_type == "code":
                text = f"`{text}`"
            elif mark_type in {"strike", "strikethrough"}:
                text = f"~~{text}~~"
        return text
    if node_type == "hardBreak":
        return "  \n"
    return "".join(inline_to_md(child) for child in node.get("content") or [])


def paragraph_text(node: dict[str, Any]) -> str:
    return "".join(inline_to_md(child) for child in node.get("content") or []).strip()


def block_to_md(node: dict[str, Any], indent: int = 0) -> list[str]:
    node_type = node.get("type")
    content = node.get("content") or []
    if node_type == "heading":
        level = (node.get("attrs") or {}).get("level") or 1
        return [f"{'#' * level} {paragraph_text(node)}"]
    if node_type == "paragraph":
        text = paragraph_text(node)
        return [text] if text else []
    if node_type == "horizontalRule":
        return ["---"]
    if node_type == "list":
        attrs = node.get("attrs") or {}
        kind = attrs.get("kind")
        checked = attrs.get("checked")
        prefix = "- "
        if kind == "task":
            prefix = "- [x] " if checked else "- [ ] "

        body_parts: list[str] = []
        nested: list[str] = []
        for child in content:
            if child.get("type") == "paragraph":
                text = paragraph_text(child)
                if text:
                    body_parts.append(text)
            else:
                nested.extend(block_to_md(child, indent + 2))
        lines = [f"{' ' * indent}{prefix}{' '.join(body_parts).strip()}"]
        lines.extend(nested)
        return lines

    lines: list[str] = []
    for child in content:
        lines.extend(block_to_md(child, indent))
    return lines


def document_to_markdown(document: dict[str, Any]) -> str:
    lines: list[str] = []
    for node in document.get("content") or []:
        block = block_to_md(node)
        if not block:
            continue
        if lines and lines[-1] != "":
            lines.append("")
        lines.extend(block)
    return "\n".join(lines).strip() + "\n"


def markdown_from_row(text: str, document_hex: str) -> str:
    if not document_hex:
        return text.rstrip() + "\n"
    try:
        document = json.loads(decode_hex_text(document_hex))
        return document_to_markdown(document)
    except Exception:  # noqa: BLE001 - fall back to the plain text column.
        return text.rstrip() + "\n"


def parse_pinned(value: str) -> bool:
    cleaned = (value or "").strip()
    return bool(cleaned) and cleaned not in {"0", "false", "False"}


def fetch_notes(db_path: Path, passphrase: str) -> list[RaycastNote]:
    sql = f"""
PRAGMA key = '{passphrase}';
.separator {SEPARATOR}
SELECT
  hex(id),
  hex(CAST(title AS BLOB)),
  hex(CAST(text AS BLOB)),
  createdAt,
  modifiedAt,
  ifnull(pinned, ''),
  hex(CAST(document AS BLOB))
FROM raycastNotes
WHERE deletedAt IS NULL
ORDER BY modifiedAt DESC;
"""
    output = run_sqlcipher(db_path, sql)
    notes: list[RaycastNote] = []
    for line in output.splitlines():
        if not line or line == "ok":
            continue
        parts = line.split(SEPARATOR)
        if len(parts) != 7:
            raise RuntimeError(f"Unexpected Raycast row shape: {len(parts)} fields")
        note_id_hex, title_hex, text_hex, created_at, modified_at, pinned, doc_hex = parts
        notes.append(
            RaycastNote(
                note_id=uuid_from_hex(note_id_hex),
                title=decode_hex_text(title_hex),
                markdown=markdown_from_row(decode_hex_text(text_hex), doc_hex),
                created_at=created_at,
                modified_at=modified_at,
                pinned=parse_pinned(pinned),
            )
        )
    return notes


# --- Item extraction (tasks + bullets), mirrors the Scheduler exporter ------------

import re  # noqa: E402 - kept next to the regexes that use it.

ITEM_RE = re.compile(r"^(?P<indent>\s*)-\s+(?:(?P<box>\[[ xX]\])\s+)?(?P<text>.+?)\s*$")
HEADING_RE = re.compile(r"^(?P<marks>#{1,6})\s+(?P<title>.+?)\s*$")


def extract_items(notes: list[RaycastNote]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for note in notes:
        heading_stack: list[str] = []
        for line in note.markdown.splitlines():
            heading_match = HEADING_RE.match(line)
            if heading_match:
                level = len(heading_match.group("marks"))
                heading_stack = heading_stack[: level - 1]
                heading_stack.append(heading_match.group("title").strip())
                continue
            item_match = ITEM_RE.match(line)
            if not item_match:
                continue
            box = item_match.group("box")
            text = item_match.group("text").strip()
            if not text or text in {"[ ]", "[x]", "[X]"}:
                continue
            items.append(
                {
                    "kind": "task" if box else "bullet",
                    "checked": None if not box else box.lower() == "[x]",
                    "text": text,
                    "noteTitle": note.title or None,
                    "section": " > ".join(heading_stack) or None,
                }
            )
    return items


def build_payload(notes: list[RaycastNote]) -> dict[str, Any]:
    return {
        "notes": [
            {
                "id": note.note_id,
                "title": note.title,
                "markdown": note.markdown,
                "createdAt": str(note.created_at) if note.created_at else None,
                "modifiedAt": str(note.modified_at) if note.modified_at else None,
                "pinned": note.pinned,
            }
            for note in notes
        ],
        "items": extract_items(notes),
    }


def post_payload(app_url: str, secret: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = app_url.rstrip("/") + INGEST_PATH
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ingest failed ({exc.code}): {detail}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description="Push Raycast Notes into JARVIS as source context.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--app-url", default=os.environ.get("JARVIS_APP_URL"))
    parser.add_argument("--dry-run", action="store_true", help="Print the payload summary without POSTing.")
    args = parser.parse_args()

    if not args.db.exists():
        raise RuntimeError(f"Raycast database not found at {args.db}")

    passphrase = derive_passphrase()
    with tempfile.TemporaryDirectory(prefix="raycast-push-") as temp:
        db_copy = copy_database(args.db, Path(temp))
        notes = fetch_notes(db_copy, passphrase)

    payload = build_payload(notes)
    open_tasks = sum(1 for item in payload["items"] if item["kind"] == "task" and item["checked"] is not True)
    bullets = sum(1 for item in payload["items"] if item["kind"] == "bullet")

    if args.dry_run:
        print(
            json.dumps(
                {
                    "notes": len(payload["notes"]),
                    "items": len(payload["items"]),
                    "openTasks": open_tasks,
                    "bullets": bullets,
                    "note_titles": [note["title"] or "(untitled)" for note in payload["notes"]],
                },
                indent=2,
                ensure_ascii=False,
            )
        )
        return 0

    secret = os.environ.get("RAYCAST_INGEST_SECRET", "").strip()
    if not secret:
        raise RuntimeError("RAYCAST_INGEST_SECRET is required (set it in the environment).")
    if not args.app_url:
        raise RuntimeError("Set --app-url or the JARVIS_APP_URL environment variable.")

    result = post_payload(args.app_url, secret, payload)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 - CLI should surface clear failure.
        print(f"push-notes.py failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
