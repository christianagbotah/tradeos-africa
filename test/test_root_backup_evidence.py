import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parent.parent / "ops/release/check-root-backup-evidence.py"
spec = importlib.util.spec_from_file_location("backup_evidence", MODULE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
NOW = dt.datetime(2026,11,25,12,0,tzinfo=dt.timezone.utc)

class BackupEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.backup = self.root / "20261125T115900Z"
        self.backup.mkdir(mode=0o700)
        lines = []
        for name in sorted(module.FILES):
            file = self.backup/name
            file.write_bytes(b"synthetic data")
            file.chmod(0o600)
            lines.append(hashlib.sha256(file.read_bytes()).hexdigest()+"  "+name)
        for name, data in (
            ("SHA256SUMS","\n".join(lines)+"\n"),
            ("restore-status.json",json.dumps({"databaseCount":3,"isolatedRestoresVerified":3,"migrationRows":60,"financialTablesVerified":5,"sourceDatabasesModified":False,"offsiteVerified":False})),
        ):
            file=self.backup/name
            file.write_text(data);file.chmod(0o600)
        # CI runs unprivileged. Only substitute ownership check for fixtures.
        original=module.checked
        def check_fixture(path,directory=False):
            if os.geteuid()==0:
                return original(path,directory)
            import stat
            s=path.lstat()
            if s.st_uid!=os.geteuid() or s.st_mode&0o077 or not (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)):
                raise ValueError("Untrusted fixture")
            return s
        self.patch=patch.object(module,"checked",check_fixture)
        self.patch.start()
    def tearDown(self):
        self.patch.stop();self.temp.cleanup()
    def test_fresh_and_stale(self):
        self.assertTrue(module.evidence(self.root,NOW)["fresh"])
        self.assertFalse(module.evidence(self.root,NOW+dt.timedelta(hours=2))["fresh"])
        self.assertFalse(module.evidence(self.root,NOW)["offsiteVerified"])
    def test_corrupted_archive_rejected(self):
        (self.backup/"tradeos_staging.dump").write_bytes(b"tampered")
        with self.assertRaises(ValueError):module.evidence(self.root,NOW)
    def test_incomplete_restore_rejected(self):
        (self.backup/"restore-status.json").write_text("{}")
        with self.assertRaises(ValueError):module.evidence(self.root,NOW)
    def test_writable_backup_rejected(self):
        (self.backup/"tradeos_staging.dump").chmod(0o644)
        with self.assertRaises(ValueError):module.evidence(self.root,NOW)
