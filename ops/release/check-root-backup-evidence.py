#!/usr/bin/env python3
"""Root-only read-only verification of the existing TradeOS backup/restore evidence."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

FILES = {"globals.sql", "tradeos_staging.dump", "tradeos_account_ctrl_test.dump", "tradeos_settings_v2_test.dump"}
def checked(path, directory=False):
    s = path.lstat()
    if s.st_uid != 0 or s.st_mode & 0o077 or not (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)):
        raise ValueError("Untrusted backup path")
    return s

def evidence(root, now):
    checked(root, True)
    candidates = sorted((p for p in root.iterdir() if re.fullmatch(r"\d{8}T\d{6}Z", p.name)), reverse=True)
    if not candidates:
        raise ValueError("No completed local backup")
    backup = candidates[0]
    checked(backup, True)
    stamp = dt.datetime.strptime(backup.name, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
    age = (now - stamp).total_seconds()
    if age < 0:
        raise ValueError("Backup clock mismatch")
    report_file = backup / "restore-status.json"
    if checked(report_file).st_size > 8192:
        raise ValueError("Unexpected restore report size")
    report = json.loads(report_file.read_text())
    if report.get("databaseCount") != 3 or report.get("isolatedRestoresVerified") != 3 or report.get("sourceDatabasesModified") is not False or report.get("financialTablesVerified") != 5 or report.get("migrationRows") not in (60, 64):
        raise ValueError("Restore report incomplete")
    sums = backup / "SHA256SUMS"
    if checked(sums).st_size > 8192:
        raise ValueError("Unexpected checksum size")
    seen = set()
    for line in sums.read_text().splitlines():
        m = re.fullmatch(r"([0-9a-f]{64})  ([a-zA-Z0-9_.-]+)", line)
        if not m or m[2] not in FILES or m[2] in seen:
            raise ValueError("Invalid backup inventory")
        seen.add(m[2])
        file = backup / m[2]
        size = checked(file).st_size
        if size <= 0 or size > 3 * 1024**3:
            raise ValueError("Invalid backup size")
        digest = hashlib.sha256()
        with file.open("rb") as f:
            for block in iter(lambda: f.read(1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() != m[1]:
            raise ValueError("Backup digest mismatch")
    if seen != FILES:
        raise ValueError("Incomplete backup inventory")
    return {"checksumsVerified": True, "isolatedRestoresVerified": 3, "migrationRows": report["migrationRows"], "ageSeconds": age, "offsiteVerified": report.get("offsiteVerified") is True, "fresh": age <= 3600}

if __name__ == "__main__":
    try:
        if os.geteuid() != 0 or len(sys.argv) != 1:
            raise ValueError("Root-only fixed backup path")
        print(json.dumps(evidence(Path("/home/lightworld/backups/tradeos-staging-databases"), dt.datetime.now(dt.timezone.utc))))
    except (OSError, ValueError, KeyError):
        print('{"checksumsVerified":false,"fresh":false,"offsiteVerified":false}')
        sys.exit(65)
