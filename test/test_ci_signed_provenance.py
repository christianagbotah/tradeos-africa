"""No-network fail-closed contract tests for the signed TradeOS pilot intake.

A fake `gh` process checks that all required signer/source provenance constraints
are passed to GitHub CLI. Real cryptographic verification runs with the real
GitHub CLI only, in the main-push VPS audit after the GitHub attestation exists.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
VERIFIER = ROOT / 'ops/release/verify-attested-artifact-pilot.sh'
SHA = '0123456789abcdef0123456789abcdef01234567'
REPO = 'christianagbotah/tradeos-africa'

MOCK_GH = '''#!/usr/bin/env python3
import os, sys
args = sys.argv[1:]
sha = os.environ['TEST_EXPECT_SHA']
expected = ['attestation', 'verify', os.environ['TEST_EXPECT_ARCHIVE'],
  '--repo', 'christianagbotah/tradeos-africa',
  '--signer-workflow', 'christianagbotah/tradeos-africa/.github/workflows/runtime-artifact-pilot.yml',
  '--source-ref', 'refs/heads/main', '--source-digest', sha,
  '--predicate-type', 'https://slsa.dev/provenance/v1', '--format', 'json']
if args != expected:
    print('GitHub attestation constraints do not match the exact main SHA/signer', file=sys.stderr)
    sys.exit(3)
mode = os.environ.get('TEST_ATTEST_MODE', 'success')
if mode == 'cli-reject':
    sys.exit(1)
if mode == 'empty':
    print('[]')
elif mode == 'object':
    print('{"notAnArray":true}')
elif mode == 'malformed':
    print('{invalid-json')
else:
    print('[{"verificationResult":{"statement":{"predicateType":"https://slsa.dev/provenance/v1"}}}]')
'''


class SignedArtifactProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tradeos-signed-provenance-test-')
        self.base = Path(self.temp.name)
        self.archive = self.base / f'tradeos-runtime-pilot-{SHA}.tar.gz'
        self.archive.write_bytes(b'fake-test-payload-not-a-real-archive')
        self.tools = self.base / 'fake-tools'
        self.tools.mkdir()
        gh = self.tools / 'gh'
        gh.write_text(MOCK_GH)
        gh.chmod(0o755)

    def tearDown(self):
        self.temp.cleanup()

    def verify(self, mode='success', *, sha=SHA, archive=None):
        env = os.environ.copy()
        env['PATH'] = str(self.tools) + os.pathsep + env['PATH']
        env['TEST_ATTEST_MODE'] = mode
        env['TEST_EXPECT_SHA'] = SHA
        env['TEST_EXPECT_ARCHIVE'] = str(self.archive)
        return subprocess.run(['bash', str(VERIFIER), sha, str(archive or self.archive)],
                              env=env, text=True, capture_output=True, check=False)

    def test_accepts_only_verified_array_for_pinned_main_signer_and_sha(self):
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('attestationVerified=true', result.stdout)
        self.assertIn(SHA, result.stdout)
        self.assertIn('/.github/workflows/runtime-artifact-pilot.yml', result.stdout)

    def test_fails_when_github_cli_rejects_signature_or_source(self):
        result = self.verify('cli-reject')
        self.assertEqual(result.returncode, 65)
        self.assertNotIn('attestationVerified=true', result.stdout)

    def test_fails_on_empty_attestation_result(self):
        result = self.verify('empty')
        self.assertEqual(result.returncode, 65)

    def test_fails_on_nonarray_result(self):
        result = self.verify('object')
        self.assertEqual(result.returncode, 65)

    def test_fails_on_invalid_json(self):
        result = self.verify('malformed')
        self.assertEqual(result.returncode, 65)

    def test_fails_on_mismatched_full_sha(self):
        result = self.verify(sha='f' * 40)
        self.assertEqual(result.returncode, 65)

    def test_fails_on_short_sha(self):
        result = self.verify(sha=SHA[:12])
        self.assertEqual(result.returncode, 64)

    def test_fails_on_wrong_archive_filename(self):
        wrong = self.base / 'wrong-name.tar.gz'
        wrong.write_bytes(b'payload')
        result = self.verify(archive=wrong)
        self.assertEqual(result.returncode, 65)

    def test_fails_on_missing_archive(self):
        self.archive.unlink()
        result = self.verify()
        self.assertEqual(result.returncode, 65)

    def test_fails_on_empty_archive(self):
        self.archive.write_bytes(b'')
        result = self.verify()
        self.assertEqual(result.returncode, 65)

    def test_fails_on_symlink_archive(self):
        target = self.base / 'other-file'
        target.write_bytes(b'payload')
        self.archive.unlink()
        self.archive.symlink_to(target)
        result = self.verify()
        self.assertEqual(result.returncode, 65)

    def test_fails_with_extra_arguments(self):
        result = subprocess.run(['bash', str(VERIFIER), SHA, str(self.archive), '--unsafe'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 64)


if __name__ == '__main__':
    unittest.main()
