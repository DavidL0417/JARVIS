#!/usr/bin/env python3
"""JARVIS-note daemon — the local Mac bridge between the Raycast "JARVIS" note and
the cloud JARVIS app. Runs on the operator's Mac, NOT on the server.

Two directions (see docs/decisions/jarvis-note-daemon.md):

  • CAPTURE (you → JARVIS): WAL-aware read of the "JARVIS" note → diff vs last-sent
    → POST to /api/integrations/jarvis-note/capture. Non-destructive. Triggered by
    the "Send to JARVIS" Raycast command (`capture`) — ambient FSEvents later.

  • SERVE (JARVIS → you): long-poll /commands/poll → claim a command → write the
    "JARVIS" note via the SHARED Scheduler writer (claude_note_board.py) under the
    SHARED .claude-note-board.lock → POST /commands/complete. This MUTATES the
    encrypted Raycast DB, so it is gated behind --allow-writes and MUST be run
    supervised the first time (the guardrail). Backup + read-back verify + the shared
    lock are the safety nets.

Reuse, not reinvention:
  • Reads reuse the JARVIS repo's own reader, scripts/raycast/push-notes.py.
  • Writes reuse the Claude - Scheduler writer (claude_note_board.py / rne) so the
    daemon shares its proven quit→write→relaunch path AND its single lock — the two
    processes therefore never write the Raycast DB concurrently.

Config (env):
  JARVIS_APP_URL            cloud base URL (e.g. https://mydearestjarvis.vercel.app)
  RAYCAST_INGEST_SECRET     operator bearer (same secret as the Raycast intake)
  SCHEDULER_REPO            path to the Claude - Scheduler repo
                            (default: ~/Developer/Claude - Scheduler)
  JARVIS_NOTE_DAEMON_STATE  last-sent state file (default: ~/.jarvis/jarvis-note-daemon.state.json)

Usage:
  python3 scripts/jarvis-note/daemon.py selftest
  python3 scripts/jarvis-note/daemon.py capture [--dry-run] [--force]
  python3 scripts/jarvis-note/daemon.py serve --allow-writes   # supervised
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import socket
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# The Raycast note titled "JARVIS" — the operator's interactive surface with the
# cloud app. Excluded from the Scheduler's reader (see the Scheduler repo's
# memory/jarvis-note-boundary.md); owned end-to-end by this daemon.
JARVIS_NOTE_ID = "C8C158FD-188D-495E-AC0F-F6B5987AD364"
JARVIS_NOTE_ID_HEX = "C8C158FD188D495EAC0FF6B5987AD364"

# Mirrors lib/jarvis-note/commands.ts renderConfirmText: a confirm checkbox embeds
# "(#<8 hex>)" so a tick maps back to its command row.
ACK_TOKEN_RE = re.compile(r"\(#([0-9a-f]{8})\)")

CAPTURE_PATH = "/api/integrations/jarvis-note/capture"
POLL_PATH = "/api/integrations/jarvis-note/commands/poll"
COMPLETE_PATH = "/api/integrations/jarvis-note/commands/complete"

DEFAULT_SCHEDULER_REPO = Path.home() / "Developer/Claude - Scheduler"
DEFAULT_STATE_FILE = Path.home() / ".jarvis/jarvis-note-daemon.state.json"


# --------------------------------------------------------------------------- #
# Cross-module imports (the read + write halves live in two repos)
# --------------------------------------------------------------------------- #
def load_reader() -> Any:
    """The JARVIS repo's own Raycast reader (hyphenated filename → importlib)."""
    reader_path = Path(__file__).resolve().parent.parent / "raycast" / "push-notes.py"
    spec = importlib.util.spec_from_file_location("jarvis_raycast_reader", reader_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["jarvis_raycast_reader"] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def load_writer(scheduler_repo: Path) -> tuple[Any, Any]:
    """The Claude - Scheduler writer (cnb) + its DB helpers (rne). Importing cnb
    binds the SHARED lock path (cnb.LOCK_PATH in the Scheduler repo)."""
    scripts = scheduler_repo / "scripts"
    if not (scripts / "claude_note_board.py").exists():
        raise RuntimeError(
            f"Scheduler writer not found under {scripts}. Set SCHEDULER_REPO to the "
            "Claude - Scheduler repo so the daemon can share its writer + lock."
        )
    sys.path.insert(0, str(scripts))
    import claude_note_board as cnb  # noqa: E402
    import raycast_notes_export as rne  # noqa: E402
    return cnb, rne


# --------------------------------------------------------------------------- #
# Config + small helpers
# --------------------------------------------------------------------------- #
class Config:
    def __init__(self, args: argparse.Namespace) -> None:
        self.app_url = (args.app_url or os.environ.get("JARVIS_APP_URL") or "").strip()
        self.secret = (os.environ.get("RAYCAST_INGEST_SECRET") or "").strip()
        self.scheduler_repo = Path(
            os.environ.get("SCHEDULER_REPO") or str(DEFAULT_SCHEDULER_REPO)
        ).expanduser()
        self.state_file = Path(
            os.environ.get("JARVIS_NOTE_DAEMON_STATE") or str(DEFAULT_STATE_FILE)
        ).expanduser()
        self.worker = f"{socket.gethostname()}/{os.getpid()}"

    def require_network(self) -> None:
        if not self.app_url:
            raise RuntimeError("Set --app-url or JARVIS_APP_URL.")
        if not self.secret:
            raise RuntimeError("RAYCAST_INGEST_SECRET is required (the operator bearer).")


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


def read_state(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text("utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def write_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2), "utf-8")


def node_text(node: dict[str, Any]) -> str:
    """Visible text of a single content node. Handles a paragraph/heading directly
    (David's typed lines are paragraphs) AND a list node via its paragraph child
    (bullets/tasks) — so delete_lines can match either."""
    def inline(n: dict[str, Any]) -> str:
        if n.get("type") == "text":
            return n.get("text", "")
        return "".join(inline(c) for c in n.get("content") or [])

    node_type = node.get("type")
    if node_type in ("paragraph", "heading"):
        return inline(node).strip()
    if node_type == "list":
        for child in node.get("content") or []:
            if child.get("type") == "paragraph":
                return inline(child).strip()
        return ""
    return inline(node).strip()


# --------------------------------------------------------------------------- #
# CAPTURE (you → JARVIS) — non-destructive read + diff + upload
# --------------------------------------------------------------------------- #
def extract_jarvis_items(reader: Any, note: Any) -> list[dict[str, Any]]:
    """Like the reader's extract_items, but ALSO captures plain paragraph lines as
    items. The JARVIS note is a chat surface where David types naturally — not just
    bullets — so the brain must see those plain lines. Headings and horizontal rules
    are skipped; bullet/task lines keep their normal parsing. Authorship is by leading
    status icon (agent lines start with one; David's never do), so our own replies and
    confirm checkboxes are tagged 'agent' and excluded from David's lines downstream."""
    items: list[dict[str, Any]] = []
    heading_stack: list[str] = []
    for line in note.markdown.splitlines():
        heading_match = reader.HEADING_RE.match(line)
        if heading_match:
            level = len(heading_match.group("marks"))
            heading_stack = heading_stack[: level - 1]
            heading_stack.append(heading_match.group("title").strip())
            continue
        stripped = line.strip()
        if not stripped or stripped == "---":
            continue
        section = " > ".join(heading_stack) or None
        item_match = reader.ITEM_RE.match(line)
        if item_match:
            box = item_match.group("box")
            text = item_match.group("text").strip()
            if not text or text in {"[ ]", "[x]", "[X]"}:
                continue
            items.append({
                "kind": "task" if box else "bullet",
                "checked": None if not box else box.lower() == "[x]",
                "text": text,
                "noteTitle": note.title or None,
                "section": section,
                "authored": reader.line_author(text),
            })
        else:
            # Plain paragraph line — David's natural typing on the JARVIS note.
            items.append({
                "kind": "bullet",
                "checked": None,
                "text": stripped,
                "noteTitle": note.title or None,
                "section": section,
                "authored": reader.line_author(stripped),
            })
    return items


def read_jarvis_note(reader: Any) -> tuple[Any | None, list[dict[str, Any]]]:
    """WAL-aware read of just the JARVIS note + its parsed items (all authors,
    incl. plain paragraph lines)."""
    passphrase = reader.derive_passphrase()
    with tempfile.TemporaryDirectory(prefix="jarvis-note-read-") as tmp:
        db = reader.copy_database(reader.DEFAULT_DB, Path(tmp))
        notes = reader.fetch_notes(db, passphrase)
    note = next((n for n in notes if n.note_id.upper() == JARVIS_NOTE_ID), None)
    if note is None:
        return None, []
    items = extract_jarvis_items(reader, note)
    return note, items


def build_capture(note: Any, items: list[dict[str, Any]]) -> dict[str, Any]:
    content_hash = hashlib.sha256(note.markdown.encode("utf-8")).hexdigest()
    # ack tokens = "(#token)" in TICKED task lines (the operator confirmed them).
    acked: list[str] = []
    for item in items:
        if item.get("kind") == "task" and item.get("checked") is True:
            acked.extend(ACK_TOKEN_RE.findall(item.get("text", "")))
    return {
        "noteMarkdown": note.markdown,
        "contentHash": content_hash,
        "items": items,
        "ackedTokens": sorted(set(acked)),
        "unchanged": False,
    }


def capture_once(config: Config, reader: Any, force: bool = False) -> dict[str, Any]:
    """Read the JARVIS note, diff vs last-sent, POST to /capture if changed (or
    forced). Returns a summary dict. Non-destructive (read-only on Raycast)."""
    note, items = read_jarvis_note(reader)
    if note is None:
        return {"error": f"JARVIS note {JARVIS_NOTE_ID} not found"}

    capture = build_capture(note, items)
    state = read_state(config.state_file)
    unchanged = state.get("last_hash") == capture["contentHash"]
    capture["unchanged"] = unchanged
    summary = {
        "note": note.title,
        "items": len(items),
        "ackedTokens": capture["ackedTokens"],
        "contentHash": capture["contentHash"][:12],
        "unchanged": unchanged,
    }

    if unchanged and not force:
        return {"skipped": "unchanged", **summary}

    config.require_network()
    result = http_post(config.app_url.rstrip("/") + CAPTURE_PATH, config.secret, capture, timeout=30)
    state["last_hash"] = capture["contentHash"]
    state["last_capture_at"] = int(time.time())
    write_state(config.state_file, state)
    return {"posted": True, **summary, "result": result}


def cmd_capture(config: Config, dry_run: bool, force: bool) -> int:
    reader = load_reader()
    if dry_run:
        note, items = read_jarvis_note(reader)
        if note is None:
            print(json.dumps({"error": f"JARVIS note {JARVIS_NOTE_ID} not found"}))
            return 1
        capture = build_capture(note, items)
        state = read_state(config.state_file)
        print(json.dumps({
            "dryRun": True,
            "note": note.title,
            "items": len(items),
            "ackedTokens": capture["ackedTokens"],
            "contentHash": capture["contentHash"][:12],
            "unchanged": state.get("last_hash") == capture["contentHash"],
        }, indent=2, ensure_ascii=False))
        return 0

    out = capture_once(config, reader, force=force)
    print(json.dumps(out, ensure_ascii=False))
    return 1 if "error" in out else 0


# --------------------------------------------------------------------------- #
# WATCH (ambient capture) — you → JARVIS with no trigger
# --------------------------------------------------------------------------- #
def cmd_watch(config: Config, debounce: float) -> int:
    """Ambient capture: kqueue-watch the Raycast WAL file (every note edit lands
    there), sleep in the kernel at zero CPU until a write wakes us, then capture
    once after `debounce` seconds of quiet (so we read after David stops typing,
    not mid-keystroke). Spurious wakeups from OTHER notes are idle-skipped by the
    content-hash diff. No polling."""
    import select  # stdlib; macOS kqueue

    config.require_network()
    reader = load_reader()
    wal = Path(str(reader.DEFAULT_DB) + "-wal")
    o_evtonly = getattr(os, "O_EVTONLY", 0x8000)
    gone_flags = select.KQ_NOTE_DELETE | select.KQ_NOTE_RENAME | getattr(select, "KQ_NOTE_REVOKE", 0)
    write_flags = select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND | gone_flags

    print(json.dumps({"watch": "started", "wal": str(wal), "debounce_s": debounce}), flush=True)

    def capture_now() -> None:
        try:
            out = capture_once(config, reader)
            if out.get("posted"):
                print(json.dumps({"ambient_capture": out.get("contentHash"), "items": out.get("items"), "acked": out.get("ackedTokens")}), flush=True)
        except Exception as exc:  # noqa: BLE001 - keep watching across a transient failure
            print(json.dumps({"watch_capture_error": str(exc)}), file=sys.stderr, flush=True)

    while True:  # outer loop re-arms the watch if the WAL is rotated/checkpoint-deleted
        try:
            fd = os.open(str(wal), o_evtonly)
        except FileNotFoundError:
            time.sleep(5)
            continue
        kq = select.kqueue()
        kev = select.kevent(
            fd,
            filter=select.KQ_FILTER_VNODE,
            flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR,
            fflags=write_flags,
        )
        pending = False
        try:
            while True:
                # Block forever for the first write; then wait only `debounce` for quiet.
                events = kq.control([kev], 1, debounce if pending else None)
                if events:
                    if events[0].fflags & gone_flags:
                        capture_now()
                        break  # re-arm on a fresh WAL fd
                    pending = True
                elif pending:  # timed out with no new write = quiet → capture
                    capture_now()
                    pending = False
        finally:
            try:
                kq.close()
            finally:
                os.close(fd)


# --------------------------------------------------------------------------- #
# SERVE (JARVIS → you) — long-poll + apply (LIVE WRITES, supervised)
# --------------------------------------------------------------------------- #
def apply_command(cnb: Any, rne: Any, command: dict[str, Any]) -> dict[str, Any]:
    """Surgically apply one command to the JARVIS note, reusing the Scheduler
    writer's machinery (lock, backup, quit→write→relaunch, read-back verify).
    Holds the SHARED lock so it never overlaps a Scheduler board write."""
    kind = command["kind"]
    payload = command.get("payload") or {}

    cnb.acquire_lock()
    try:
        cnb.backup_db()
        passphrase = rne.derive_passphrase()
        meta, document = _fetch_jarvis_doc(rne, passphrase)

        # Same pre-write guards the Scheduler writer enforces.
        if meta["deletedAt"] is not None:
            raise RuntimeError("JARVIS note is deleted; refusing to write.")
        if meta["syncId"] is not None:
            raise RuntimeError("JARVIS note has a syncId (Raycast cloud sync on); refusing to write.")
        if meta["schema_version"] != 2:
            raise RuntimeError(f"unexpected documentSchemaVersion={meta['schema_version']}; refusing.")

        content = list(document.get("content") or [])
        before = len(content)
        if kind == "append":
            for line in payload.get("lines", []):
                content.append(cnb._list_node(None, line))
        elif kind == "confirm":
            content.append(cnb._list_node("[ ]", payload["confirmText"]))
        elif kind == "delete_lines":
            wanted = {m.strip() for m in payload.get("match", [])}
            content = [n for n in content if node_text(n).strip() not in wanted]
        else:
            raise RuntimeError(f"unknown command kind: {kind}")

        document["content"] = content
        verify = _write_jarvis_doc(cnb, rne, passphrase, document)
        return {"kind": kind, "nodesBefore": before, "nodesAfter": len(content), **verify}
    finally:
        cnb.release_lock()


def _fetch_jarvis_doc(rne: Any, passphrase: str) -> tuple[dict[str, Any], dict[str, Any]]:
    sep = "<<<RAYCAST_SEP>>>"
    with tempfile.TemporaryDirectory(prefix="jarvis-note-write-read-") as tmp:
        db = rne.copy_database(rne.DEFAULT_DB, Path(tmp))
        meta_sql = (
            f"PRAGMA key='{passphrase}';\n.separator {sep}\n"
            "SELECT documentSchemaVersion, quote(syncId), quote(deletedAt), "
            "hex(CAST(document AS BLOB)) "
            f"FROM raycastNotes WHERE hex(id)='{JARVIS_NOTE_ID_HEX}';"
        )
        rows = [ln for ln in rne.run_sqlcipher(db, meta_sql).splitlines() if ln.strip() and ln.strip() != "ok"]
        if not rows:
            raise RuntimeError(f"JARVIS note (id {JARVIS_NOTE_ID_HEX}) not found in DB.")
        parts = rows[0].split(sep)
        doc_raw = rne.decode_hex_text(parts[3]) if len(parts) > 3 and parts[3] else ""
        document = json.loads(doc_raw) if doc_raw else {"type": "doc", "content": []}
        meta = {
            "schema_version": int(parts[0]) if parts[0].isdigit() else None,
            "syncId": None if parts[1] == "NULL" else parts[1],
            "deletedAt": None if parts[2] == "NULL" else parts[2],
        }
        return meta, document


def _write_jarvis_doc(cnb: Any, rne: Any, passphrase: str, document: dict[str, Any]) -> dict[str, Any]:
    """UPDATE the JARVIS note's text+document+modifiedAt (never openedAt), with the
    Scheduler writer's quit→write→relaunch + read-back verify. Targets the JARVIS id."""
    import subprocess  # local: only the live-write path needs it

    text = cnb.doc_to_plaintext(document)
    doc_hex = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8").hex()
    text_hex = text.encode("utf-8").hex()
    modified = cnb.db_stamp(cnb.utc_now())
    sql = (
        f"PRAGMA key='{passphrase}';\nPRAGMA busy_timeout=8000;\n"
        f"UPDATE raycastNotes SET text=CAST(x'{text_hex}' AS TEXT), "
        f"document=x'{doc_hex}', modifiedAt='{modified}' "
        f"WHERE hex(id)='{JARVIS_NOTE_ID_HEX}';\nSELECT 'rows=' || changes();"
    )

    running = cnb._raycast_running()
    if running:
        cnb._quit_raycast()
    proc = subprocess.run(
        [rne.sqlcipher_binary(), str(rne.DEFAULT_DB)],
        input=sql, text=True, capture_output=True, timeout=20,
    )
    if running:
        cnb._relaunch_raycast()
    if proc.returncode != 0 or "rows=1" not in proc.stdout:
        raise RuntimeError(f"write failed: rc={proc.returncode} out={proc.stdout!r} err={proc.stderr!r}")

    _, fresh = _fetch_jarvis_doc(rne, passphrase)
    return {"verified": fresh == document, "modifiedAt": modified}


def cmd_serve(config: Config, allow_writes: bool, once: bool, wait_seconds: int) -> int:
    if not allow_writes:
        raise RuntimeError(
            "serve performs LIVE writes to the encrypted Raycast DB. Re-run with "
            "--allow-writes, and do the first run supervised (the guardrail)."
        )
    config.require_network()
    cnb, rne = load_writer(config.scheduler_repo)
    poll_url = config.app_url.rstrip("/") + POLL_PATH
    complete_url = config.app_url.rstrip("/") + COMPLETE_PATH

    while True:
        resp = http_post(poll_url, config.secret, {"worker": config.worker, "waitSeconds": wait_seconds}, timeout=wait_seconds + 15)
        command = resp.get("command")
        if command:
            try:
                result = apply_command(cnb, rne, command)
                http_post(complete_url, config.secret, {"commandId": command["id"], "status": "done", "result": result}, timeout=30)
                print(json.dumps({"applied": command["id"], **result}, ensure_ascii=False))
            except Exception as exc:  # noqa: BLE001 - report failure, keep serving
                http_post(complete_url, config.secret, {"commandId": command["id"], "status": "failed", "error": str(exc)}, timeout=30)
                print(json.dumps({"failed": command["id"], "error": str(exc)}), file=sys.stderr)
        if once:
            return 0


# --------------------------------------------------------------------------- #
# SELFTEST — wiring check, no writes, no required network
# --------------------------------------------------------------------------- #
def cmd_selftest(config: Config) -> int:
    checks: list[tuple[str, bool, str]] = []

    def check(name: str, fn: Any) -> None:
        try:
            detail = fn()
            checks.append((name, True, detail))
        except Exception as exc:  # noqa: BLE001
            checks.append((name, False, str(exc)))

    reader_holder: dict[str, Any] = {}

    def _reader() -> str:
        reader_holder["m"] = load_reader()
        return "scripts/raycast/push-notes.py imported"

    def _writer() -> str:
        cnb, _ = load_writer(config.scheduler_repo)
        return f"shared lock: {cnb.LOCK_PATH}"

    def _note() -> str:
        note, items = read_jarvis_note(reader_holder["m"])
        if note is None:
            raise RuntimeError(f"JARVIS note {JARVIS_NOTE_ID} not found")
        return f"read '{note.title}' ({len(items)} items)"

    check("reader import", _reader)
    check("writer import (shared lock)", _writer)
    check("read JARVIS note", _note)
    check("config", lambda: f"app_url={'set' if config.app_url else 'UNSET'} secret={'set' if config.secret else 'UNSET'}")

    ok = all(passed for _, passed, _ in checks)
    for name, passed, detail in checks:
        print(f"  [{'ok' if passed else 'FAIL'}] {name}: {detail}")
    print("\nSELFTEST PASS" if ok else "\nSELFTEST FAILED")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="JARVIS-note daemon (local Mac bridge).")
    parser.add_argument("--app-url", default=None)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("selftest", help="Check wiring (imports, note readable, config). No writes/network.")

    p_capture = sub.add_parser("capture", help="Read the JARVIS note, diff, upload (you → JARVIS).")
    p_capture.add_argument("--dry-run", action="store_true", help="Print what would be sent; no POST.")
    p_capture.add_argument("--force", action="store_true", help="POST even if unchanged.")

    p_serve = sub.add_parser("serve", help="Long-poll + apply commands (JARVIS → you). LIVE WRITES.")
    p_serve.add_argument("--allow-writes", action="store_true", help="Required: enables live Raycast writes.")
    p_serve.add_argument("--once", action="store_true", help="Handle one poll cycle then exit.")
    p_serve.add_argument("--wait-seconds", type=int, default=25, help="Long-poll hold (server clamps).")

    p_watch = sub.add_parser("watch", help="Ambient capture: kqueue-watch the note, auto-capture on quiet (you → JARVIS).")
    p_watch.add_argument("--debounce", type=float, default=10.0, help="Seconds of quiet after an edit before capturing.")

    args = parser.parse_args()
    config = Config(args)

    if args.command == "selftest":
        return cmd_selftest(config)
    if args.command == "capture":
        return cmd_capture(config, dry_run=args.dry_run, force=args.force)
    if args.command == "serve":
        return cmd_serve(config, allow_writes=args.allow_writes, once=args.once, wait_seconds=args.wait_seconds)
    if args.command == "watch":
        return cmd_watch(config, debounce=args.debounce)
    parser.error(f"unknown command {args.command}")
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:  # noqa: BLE001 - CLI should surface clear failure.
        print(f"daemon failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
