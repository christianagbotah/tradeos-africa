"""Root-owned runtime sealing contract tests: no network/DB/deploy/activation.

The pure sealing library accepts the invoking owner for no-privilege tests;
its CLI is root-only, and the audited wrapper calls it after ledger checks.
"""
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'ops/release/seal-ci-artifact-candidate.py'
spec = importlib.util.spec_from_file_location('tradeos_candidate_seal', SCRIPT)
assert spec and spec.loader
seal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seal)
SHA = 'e' * 40

class CandidateSealTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='tradeos-ci-intake.', dir='/tmp')
        self.parent = Path(self.tmp.name)
        self.candidate = self.parent / f'tradeos-rehearsal-{SHA}'
        self.candidate.mkdir()
        (self.candidate / 'apps/web').mkdir(parents=True)
        (self.candidate / 'manifest.json').write_text(json.dumps({
            'schemaVersion':1, 'type':'TRADEOS_CI_RUNTIME_ARTIFACT_PILOT',
            'deployable':False, 'sourceCommit':SHA, 'requiredNodeMajor':22,
        }))
        (self.candidate / 'apps/web/server.js').write_text('module.exports = 1')
        (self.candidate / 'apps/web/start.sh').write_text('#!/bin/sh\nexit 0\n')
        (self.candidate / 'apps/web/start.sh').chmod(0o755)

    def tearDown(self):
        for current, subdirs, files in os.walk(self.candidate, followlinks=False):
            os.chmod(current, 0o700)
        self.tmp.cleanup()

    def test_seals_candidate_root_and_all_real_files_with_content_hash(self):
        result = seal.seal_candidate(SHA,self.candidate)
        self.assertTrue(result['candidateSealed'])
        self.assertEqual(result['sourceCommit'],SHA)
        self.assertFalse(result['deployable'])
        self.assertFalse(result['authorizedToDeploy'])
        self.assertFalse(result['serviceChanges'])
        self.assertFalse(result['releaseSymlinkChanged'])
        self.assertEqual(len(result['runtimeSha256']),64)
        self.assertEqual(self.candidate.stat().st_mode & 0o777,0o555)
        self.assertEqual((self.candidate/'apps/web/server.js').stat().st_mode & 0o777,0o444)
        self.assertEqual((self.candidate/'apps/web/start.sh').stat().st_mode & 0o777,0o555)
        snap,count,total,_=seal.snapshot_tree(self.candidate,os.geteuid())
        self.assertEqual(snap,result['runtimeSha256'])
        self.assertEqual(count,result['members'])
        self.assertEqual(total,result['totalRegularBytes'])

    def test_symlinks_stay_internal_and_link_target_is_hashed(self):
        (self.candidate/'apps/web/alias.js').symlink_to('server.js')
        result=seal.seal_candidate(SHA,self.candidate)
        self.assertTrue((self.candidate/'apps/web/alias.js').is_symlink())
        self.assertEqual((self.candidate/'apps/web/alias.js').resolve(),
                         (self.candidate/'apps/web/server.js').resolve())
        self.assertTrue(result['candidateSealed'])

    def test_hardlinks_inside_candidate_are_permitted(self):
        os.link(self.candidate/'apps/web/server.js',self.candidate/'apps/web/hardcopy.js')
        result=seal.seal_candidate(SHA,self.candidate)
        self.assertTrue(result['candidateSealed'])
        self.assertEqual((self.candidate/'apps/web/hardcopy.js').stat().st_ino,
                         (self.candidate/'apps/web/server.js').stat().st_ino)

    def test_hardlink_external_inode_is_rejected_before_chmod(self):
        external=self.parent/'outside.js'
        external.write_text('not part of artifact')
        os.link(external,self.candidate/'apps/web/malicious-hardlink.js')
        with self.assertRaisesRegex(seal.Rejected,'hardlink'):
            seal.seal_candidate(SHA,self.candidate)
        self.assertEqual(external.stat().st_mode & 0o777,0o644)

    def test_external_absolute_symlink_is_rejected_before_changes(self):
        (self.candidate/'apps/web/escape').symlink_to('/etc/passwd')
        with self.assertRaisesRegex(seal.Rejected,'absolute symlink'):
            seal.seal_candidate(SHA,self.candidate)
        self.assertEqual(self.candidate.stat().st_mode & 0o777,0o755)

    def test_symlink_traversal_outside_tree_is_rejected(self):
        (self.parent/'outside.js').write_text('outside candidate')
        (self.candidate/'apps/web/escape').symlink_to('../../../outside.js')
        with self.assertRaisesRegex(seal.Rejected,'escapes'):
            seal.seal_candidate(SHA,self.candidate)

    def test_special_file_is_rejected(self):
        os.mkfifo(self.candidate/'apps/web/fifo')
        with self.assertRaisesRegex(seal.Rejected,'special'):
            seal.seal_candidate(SHA,self.candidate)

    def test_wrong_sha_or_path_refused_without_modification(self):
        with self.assertRaises(seal.Rejected):
            seal.seal_candidate('f'*40,self.candidate)
        with self.assertRaises(seal.Rejected):
            seal.seal_candidate('bad',self.candidate)
        with self.assertRaises(seal.Rejected):
            seal.seal_candidate(SHA,self.parent)
        self.assertEqual(self.candidate.stat().st_mode & 0o777,0o755)

    def test_deployable_manifest_rejected(self):
        info=self.candidate/'manifest.json'
        data=json.loads(info.read_text())
        data['deployable']=True
        info.write_text(json.dumps(data))
        with self.assertRaisesRegex(seal.Rejected,'nondeployable'):
            seal.seal_candidate(SHA,self.candidate)

    def test_changed_contents_change_fingerprint(self):
        before=seal.snapshot_tree(self.candidate,os.geteuid())[0]
        (self.candidate/'apps/web/server.js').write_text('module.exports = 2')
        after=seal.snapshot_tree(self.candidate,os.geteuid())[0]
        self.assertNotEqual(before,after)

    def test_seal_refuses_symlinked_parent(self):
        alias=self.parent.parent/f'tradeos-ci-intake.alias-{os.getpid()}'
        alias.symlink_to(self.parent)
        try:
            with self.assertRaises(seal.Rejected):
                seal.seal_candidate(SHA,alias/self.candidate.name)
        finally:
            alias.unlink()

if __name__=='__main__':
    unittest.main()
