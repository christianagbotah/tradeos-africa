"""Release-profile acceptance: the pilot CLI remains fail closed."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from test_ci_artifact_intake import fixture_files, make_archive, SHA, ROOT

class ReleaseProfileTests(unittest.TestCase):
    def make(self, folder, *, corrupt=False, approval=True, pilot=False):
        files = fixture_files()
        name = "0001_probe.sql"
        digest = hashlib.sha256(files["packages/db/migrations/" + name]).hexdigest()
        if not pilot:
            files["manifest.json"] = json.dumps({
                "schemaVersion": 2, "type": "TRADEOS_SIGNED_RUNTIME_RELEASE",
                "sourceCommit": SHA, "requiredNodeMajor": 22, "deployable": True,
                "requiresOperatorApproval": approval, "environment": "staging",
                "migrationChecksums": {name: "0"*64 if corrupt else digest},
            }).encode()
            # The fixture archive builder needs the parent directory to be present.
            import tarfile
            directory = tarfile.TarInfo("./apps/api/dist/scripts")
            directory.type = tarfile.DIRTYPE
            directory.mode = 0o755
            files["apps/api/dist/scripts/apply-migrations.js"] = b"// fixture"
            extra = [(directory, None)]
        else:
            extra = []
        make_archive(folder, files=files, extra=extra)
        old = folder / f"tradeos-runtime-pilot-{SHA}.tar.gz"
        target = folder / f"tradeos-runtime-release-{SHA}.tar.gz"
        old.rename(target)
        (folder / (target.name + ".sha256")).write_text(
            hashlib.sha256(target.read_bytes()).hexdigest() + "  " + target.name + "\n")

    def extract(self, folder):
        return subprocess.run(
            ["python3", str(ROOT / "ops/release/rehearse-signed-runtime-release.py"),
             SHA, str(folder), str(folder / "tradeos-rehearsal-release")],
            capture_output=True, text=True, check=False,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})

    def test_release_requires_explicit_approval_and_exact_migration_digest(self):
        for bad in ("digest", "approval", "pilot"):
            with self.subTest(bad=bad), tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp)
                self.make(folder, corrupt=bad=="digest", approval=bad!="approval", pilot=bad=="pilot")
                self.assertNotEqual(self.extract(folder).returncode, 0)
                self.assertFalse((folder / "tradeos-rehearsal-release").exists())

    def test_release_extracts_without_authorizing_activation(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.make(folder)
            result = self.extract(folder)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertTrue(report["deployable"])
            self.assertFalse(report["authorizedToDeploy"])
            self.assertFalse(report["productionReleaseTouched"])

    def test_pilot_cli_rejects_release_manifest_even_with_pilot_filename(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.make(folder)
            release = folder / f"tradeos-runtime-release-{SHA}.tar.gz"
            pilot = folder / f"tradeos-runtime-pilot-{SHA}.tar.gz"
            release.rename(pilot)
            (folder / (pilot.name + ".sha256")).write_text(hashlib.sha256(pilot.read_bytes()).hexdigest()+"  "+pilot.name+"\n")
            result = subprocess.run(["python3", str(ROOT / "ops/release/inspect-ci-artifact-pilot.py"), SHA, str(folder)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
