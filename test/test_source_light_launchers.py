"""No-network contract tests for source-light API/Next launchers.

The fake Node executable records the executed entrypoint and process env;
nothing listens on ports, connects to databases or opens merchant sessions.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
LAUNCHER_SRC = ROOT / 'ops/release/runtime/bin'


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tradeos-standalone-test-')
        self.base = Path(self.temp.name)
        self.bundle = self.base / 'runtime'
        self.bin = self.bundle / 'bin'
        self.bin.mkdir(parents=True)
        for file in LAUNCHER_SRC.iterdir():
            shutil.copyfile(file, self.bin / file.name)
            (self.bin / file.name).chmod(0o755)
        for rel in ('apps/api/dist/server.js', 'apps/web/server.js',
                    'apps/system-admin/server.js'):
            p = self.bundle / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('// stub')
        (self.bundle / 'apps/web/entrypoint.txt').write_text('server.js\n')
        (self.bundle / 'apps/system-admin/entrypoint.txt').write_text('server.js\n')
        self.mock_bin = self.base / 'mock-bin'
        self.mock_bin.mkdir()
        self.mock_node = self.mock_bin / 'node'
        self.mock_node.write_text('''#!/usr/bin/env python3
import json, os, sys
if sys.argv[1:] == ['-p', 'process.versions.node.split(".")[0]']:
  print(os.environ.get('FAKE_NODE_MAJOR', '22'))
  sys.exit(0)
with open(os.environ['TRADEOS_MOCK_OUTPUT'], 'w', encoding='utf8') as out:
  json.dump({'args': sys.argv[1:], 'cwd': os.getcwd(), 'env': {
    name: os.environ.get(name) for name in [
      'HOST', 'PORT', 'HOSTNAME', 'NODE_ENV', 'TRADEOS_PASSWORD_RESET_FROM',
      'TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN', 'TRADEOS_ADMIN_RESET_PUBLIC_ORIGIN',
      'TEST_LITERAL', 'TRADEOS_HUBTEL_POS_ENABLED',
    ]}}, out)
''')
        self.mock_node.chmod(0o755)
        self.env_file = self.base / 'external-environment-file'
        self.env_file.write_text('')
        self.output = self.base / 'mock-node-output.json'

    def tearDown(self):
        self.temp.cleanup()

    def run_script(self, kind='api', *, env_file=None, changes=None):
        env = os.environ.copy()
        env['PATH'] = str(self.mock_bin) + os.pathsep + env['PATH']
        env['TRADEOS_MOCK_OUTPUT'] = str(self.output)
        env['TRADEOS_ENV_FILE'] = str(self.env_file if env_file is None else env_file)
        for key in ('PORT', 'HOST', 'WEB_PORT', 'WEB_HOST', 'ADMIN_PORT', 'ADMIN_HOST',
                    'TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN', 'NODE_ENV'):
            env.pop(key, None)
        env.update(changes or {})
        result = subprocess.run(['bash', str(self.bin / f'start-{kind}.sh')],
                                env=env, text=True, capture_output=True)
        data = json.loads(self.output.read_text()) if self.output.exists() else None
        return result, data

    def test_api_uses_external_env_and_preserves_recovery_defaults(self):
        self.env_file.write_text('TEST_LITERAL=$(touch /tmp/tradeos-never-execute)\n'
                                 'TRADEOS_HUBTEL_POS_ENABLED=false\n'
                                 'PORT=14036\n')
        result, data = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(data['env']['PORT'], '14036')
        self.assertEqual(data['env']['HOST'], '127.0.0.1')
        self.assertEqual(data['env']['NODE_ENV'], 'production')
        self.assertEqual(data['env']['TEST_LITERAL'], '$(touch /tmp/tradeos-never-execute)')
        self.assertEqual(data['env']['TRADEOS_PASSWORD_RESET_FROM'], 'mail@lightworldtech.com')
        self.assertEqual(data['env']['TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN'],
                         'https://tradeosafrica.lightworldtech.com')
        self.assertEqual(data['env']['TRADEOS_ADMIN_RESET_PUBLIC_ORIGIN'],
                         'https://tradeosadmin.lightworldtech.com')
        self.assertEqual(data['args'], [str(self.bundle / 'apps/api/dist/server.js')])
        self.assertEqual(data['cwd'], str(self.bundle / 'apps/api'))

    def test_web_uses_traced_standalone_server_and_web_specific_port(self):
        result, data = self.run_script('web', changes={'WEB_PORT': '13036', 'WEB_HOST': '127.0.0.1'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(data['args'], [str(self.bundle / 'apps/web/server.js')])
        self.assertEqual(data['env']['PORT'], '13036')
        self.assertEqual(data['env']['HOSTNAME'], '127.0.0.1')
        self.assertEqual(data['env']['NODE_ENV'], 'production')

    def test_admin_uses_traced_server_and_admin_specific_port(self):
        result, data = self.run_script('system-admin', changes={'ADMIN_PORT': '13038'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(data['args'], [str(self.bundle / 'apps/system-admin/server.js')])
        self.assertEqual(data['env']['PORT'], '13038')

    def test_next_monorepo_entrypoints_are_accepted(self):
        for kind in ('web', 'system-admin'):
            with self.subTest(kind=kind):
                app = self.bundle / 'apps' / kind
                (app / 'apps' / kind).mkdir(parents=True, exist_ok=True)
                (app / 'apps' / kind / 'server.js').write_text('// traced monorepo server')
                (app / 'entrypoint.txt').write_text(f'apps/{kind}/server.js\n')
                self.output.unlink(missing_ok=True)
                result, data = self.run_script(kind)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(data['args'], [str(app / 'apps' / kind / 'server.js')])

    def test_missing_external_env_fails_closed(self):
        result, data = self.run_script(env_file=self.base / 'missing.env')
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(data)

    def test_broken_env_rejected_without_running_node_application(self):
        for bad in ('MISSING_EQUALS\n', '2BAD=value\n', 'export BAD=value\n',
                    'KEY=a\nBAD KEY=value\n'):
            with self.subTest(bad=bad):
                self.env_file.write_text(bad)
                self.output.unlink(missing_ok=True)
                result, data = self.run_script()
                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(data)

    def test_external_origins_take_precedence(self):
        self.env_file.write_text('TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN=https://testing.example\n')
        result, data = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(data['env']['TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN'],
                         'https://testing.example')

    def test_non_loopback_bindings_denied_for_all_services(self):
        for kind, key in [('api', 'HOST'), ('web', 'WEB_HOST'), ('system-admin', 'ADMIN_HOST')]:
            with self.subTest(kind=kind):
                self.output.unlink(missing_ok=True)
                result, data = self.run_script(kind, changes={key: '0.0.0.0'})
                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(data)

    def test_invalid_ports_denied_without_launch(self):
        for bad in ('0', '65536', 'abc', '-1', '80364'):
            with self.subTest(bad=bad):
                self.output.unlink(missing_ok=True)
                result, data = self.run_script('api', changes={'PORT': bad})
                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(data)

    def test_rejects_injected_next_entrypoints(self):
        for malicious in ('../api/dist/server.js', '/etc/passwd', 'server.js; echo leak'):
            with self.subTest(malicious=malicious):
                (self.bundle / 'apps/web/entrypoint.txt').write_text(malicious)
                self.output.unlink(missing_ok=True)
                result, data = self.run_script('web')
                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(data)

    def test_rejects_symlinked_next_server(self):
        entry = self.bundle / 'apps/web/server.js'
        entry.unlink()
        entry.symlink_to(self.bundle / 'apps/api/dist/server.js')
        result, data = self.run_script('web')
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(data)

    def test_rejects_wrong_node_major(self):
        result, data = self.run_script(changes={'FAKE_NODE_MAJOR': '20'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(data)

    def test_missing_standalone_server_denied(self):
        (self.bundle / 'apps/api/dist/server.js').unlink()
        result, data = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(data)


if __name__ == '__main__':
    unittest.main()
