"""Pure stdlib regression tests for read-only CI artifact inspection."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
INSPECT = ROOT / 'ops/release/inspect-ci-artifact-pilot.py'
SHA = 'a' * 40


def fixture_files():
    return {
        'manifest.json': json.dumps({
            'schemaVersion': 1, 'type': 'TRADEOS_CI_RUNTIME_ARTIFACT_PILOT',
            'deployable': False, 'sourceCommit': SHA, 'requiredNodeMajor': 22,
        }).encode(),
        'apps/api/dist/server.js': b'console.log("test");',
        'apps/api/package.json': b'{"name":"@tradeos/api"}',
        'apps/web/entrypoint.txt': b'server.js\n',
        'apps/web/server.js': b'console.log("web");',
        'apps/system-admin/entrypoint.txt': b'server.js\n',
        'apps/system-admin/server.js': b'console.log("admin");',
        'packages/db/migrations/0001_probe.sql': b'SELECT 1;',
    }


def make_archive(out: Path, *, files=None, extra=None, checksum_override=None):
    name = f'tradeos-runtime-pilot-{SHA}.tar.gz'
    target = out / name
    payload = fixture_files() if files is None else files
    directories = ['apps', 'apps/api', 'apps/api/dist', 'apps/api/node_modules',
                   'apps/web', 'apps/system-admin', 'packages', 'packages/db',
                   'packages/db/migrations']
    with tarfile.open(target, 'w:gz') as archive:
        for folder in directories:
            member = tarfile.TarInfo('./' + folder)
            member.type = tarfile.DIRTYPE
            member.mode = 0o755
            archive.addfile(member)
        for path, content in payload.items():
            member = tarfile.TarInfo('./' + path)
            member.mode = 0o644
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
        for member, content in extra or []:
            archive.addfile(member, io.BytesIO(content) if content is not None else None)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    (out / (name + '.sha256')).write_text(
        checksum_override if checksum_override is not None else f'{digest}  {name}\n',
        encoding='ascii',
    )


def inspect(path: Path, sha: str = SHA):
    return subprocess.run(['python3', str(INSPECT), sha, str(path)],
                          text=True, capture_output=True, check=False)


class ArtifactAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tradeos-pilot-unit-')
        self.path = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_accepts_verified_nondeployable_minimal_bundle(self):
        make_archive(self.path)
        result = inspect(self.path)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['checksumVerified'])
        self.assertFalse(json.loads(result.stdout)['deployable'])

    def test_accepts_internal_hardlinks_and_symlinks(self):
        hardlink = tarfile.TarInfo('./apps/web/hardcopy.js')
        hardlink.type = tarfile.LNKTYPE
        hardlink.linkname = './apps/web/server.js'
        symlink = tarfile.TarInfo('./apps/web/symlink.js')
        symlink.type = tarfile.SYMTYPE
        symlink.linkname = './server.js'
        make_archive(self.path, extra=[(hardlink, None), (symlink, None)])
        self.assertEqual(inspect(self.path).returncode, 0)

    def test_rejects_mismatched_sha(self):
        make_archive(self.path)
        self.assertNotEqual(inspect(self.path, 'b' * 40).returncode, 0)

    def test_rejects_untrusted_checksum(self):
        make_archive(self.path, checksum_override='0' * 64 +
                     f'  tradeos-runtime-pilot-{SHA}.tar.gz\n')
        self.assertNotEqual(inspect(self.path).returncode, 0)

    def test_rejects_checksum_filename_injection(self):
        make_archive(self.path, checksum_override='0' * 64 + '  ../../unrelated\n')
        self.assertNotEqual(inspect(self.path).returncode, 0)

    def test_rejects_deployable_manifest(self):
        files = fixture_files()
        data = json.loads(files['manifest.json'])
        data['deployable'] = True
        files['manifest.json'] = json.dumps(data).encode()
        make_archive(self.path, files=files)
        self.assertNotEqual(inspect(self.path).returncode, 0)

    def test_rejects_hidden_secrets(self):
        files = fixture_files()
        files['.env.staging'] = b'PRIVATE=never-ship\n'
        make_archive(self.path, files=files)
        self.assertNotEqual(inspect(self.path).returncode, 0)

    def test_rejects_traversal_even_if_digest_matches(self):
        bad = tarfile.TarInfo('./../../outside')
        bad.size = 2
        make_archive(self.path, extra=[(bad, b'no')])
        self.assertNotEqual(inspect(self.path).returncode, 0)

    def test_rejects_absolute_symlink(self):
        link = tarfile.TarInfo('./apps/web/escape')
        link.type = tarfile.SYMTYPE
        link.linkname = '/etc/passwd'
        make_archive(self.path, extra=[(link, None)])
        self.assertNotEqual(inspect(self.path).returncode, 0)

    def test_rejects_missing_symlink_target(self):
        link = tarfile.TarInfo('./apps/web/missing')
        link.type = tarfile.SYMTYPE
        link.linkname = './not-here'
        make_archive(self.path, extra=[(link, None)])
        self.assertNotEqual(inspect(self.path).returncode, 0)

    def test_rejects_external_hardlink(self):
        link = tarfile.TarInfo('./apps/web/escape')
        link.type = tarfile.LNKTYPE
        link.linkname = '../../etc/passwd'
        make_archive(self.path, extra=[(link, None)])
        self.assertNotEqual(inspect(self.path).returncode, 0)

    def test_rejects_device_entries(self):
        device = tarfile.TarInfo('./apps/api/node_modules/device')
        device.type = tarfile.CHRTYPE
        make_archive(self.path, extra=[(device, None)])
        self.assertNotEqual(inspect(self.path).returncode, 0)

    def test_rejects_duplicate_file_paths(self):
        duplicate = tarfile.TarInfo('./apps/web/server.js')
        duplicate.size = 3
        make_archive(self.path, extra=[(duplicate, b'bad')])
        self.assertNotEqual(inspect(self.path).returncode, 0)

    def test_rejects_missing_entrypoint(self):
        files = fixture_files()
        files.pop('apps/web/server.js')
        make_archive(self.path, files=files)
        self.assertNotEqual(inspect(self.path).returncode, 0)


if __name__ == '__main__':
    unittest.main()
