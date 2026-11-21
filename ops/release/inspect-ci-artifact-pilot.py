#!/usr/bin/env python3
"""Read-only, fail-closed TradeOS GitHub CI pilot archive acceptance audit.

Usage: inspect-ci-artifact-pilot.py <40-char GitHub commit SHA> <artifact directory>
This cannot extract, activate, deploy, migrate or connect to a service.
"""
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import sys
import tarfile

MAX_COMPRESSED = 1024 * 1024 * 1024
MAX_EXPANDED = 3 * 1024 * 1024 * 1024
MAX_MEMBERS = 150_000
SHA_PATTERN = re.compile(r"[0-9a-f]{40}\Z")


class Rejected(Exception):
    pass


def safe_member_name(raw: str) -> str:
    if not raw or raw.startswith('/') or '\\' in raw or len(raw) > 1024:
        raise Rejected('archive contains an unsafe member name')
    if any(ord(c) < 32 or ord(c) == 127 for c in raw):
        raise Rejected('archive contains a control character in a member name')
    if raw in ('.', './'):
        return '.'
    segments = raw.removeprefix('./').rstrip('/').split('/')
    if any(p in ('', '.', '..') for p in segments):
        raise Rejected('archive contains traversal or ambiguous member names')
    return '/'.join(segments)


def inspect(sha: str, directory: Path) -> dict:
    if not SHA_PATTERN.fullmatch(sha):
        raise Rejected('expected full lowercase Git commit SHA')
    if not directory.is_dir() or directory.is_symlink():
        raise Rejected('artifact directory must be a real directory')
    name = f'tradeos-runtime-pilot-{sha}.tar.gz'
    archive = directory / name
    checksum = directory / (name + '.sha256')
    for file in (archive, checksum):
        if file.is_symlink() or not file.is_file():
            raise Rejected('missing or unsafe artifact file')
    if archive.stat().st_size < 1 or archive.stat().st_size > MAX_COMPRESSED:
        raise Rejected('artifact compressed size exceeds intake limit')
    expected_checksum = checksum.read_text(encoding='ascii')
    if not re.fullmatch(r'[0-9a-f]{64}  ' + re.escape(name) + r'\n', expected_checksum):
        raise Rejected('checksum must name exactly the expected artifact')
    digest = hashlib.sha256()
    with archive.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.hexdigest() != expected_checksum[:64]:
        raise Rejected('artifact digest mismatch')

    members: dict[str, tarfile.TarInfo] = {}
    expanded = 0
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar:
            key = safe_member_name(member.name)
            if key in members:
                raise Rejected('duplicate member path in archive')
            if len(members) >= MAX_MEMBERS:
                raise Rejected('artifact contains too many members')
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise Rejected('archive contains a device, hardlink, FIFO or special file')
            if member.mode & 0o6000:
                raise Rejected('archive contains setuid or setgid bits')
            if member.size < 0:
                raise Rejected('negative member size')
            if member.isfile():
                expanded += member.size
                if expanded > MAX_EXPANDED:
                    raise Rejected('archive expanded size exceeds intake limit')
            if member.islnk():
                # GNU tar records hardlink targets as paths rooted at the
                # archive root; never trust absolute/external link targets.
                target = safe_member_name(member.linkname)
                if target == '.':
                    raise Rejected('hardlink targets a directory root')
            if member.issym():
                target = member.linkname
                if not target or posixpath.isabs(target) or '\\' in target:
                    raise Rejected('absolute or unsafe symlink')
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(key), target))
                if resolved in ('..', '.') or resolved.startswith('../'):
                    raise Rejected('symlink escapes archive root')
            members[key] = member

        for key, member in members.items():
            if member.islnk():
                target = safe_member_name(member.linkname)
                seen_hardlinks = {key}
                for _ in range(64):
                    if target in seen_hardlinks:
                        raise Rejected('cyclic hardlink chain')
                    seen_hardlinks.add(target)
                    referenced = members.get(target)
                    if referenced is None:
                        raise Rejected('hardlink target missing from archive')
                    if referenced.isfile():
                        break
                    if not referenced.islnk():
                        raise Rejected('hardlink targets a non-file')
                    target = safe_member_name(referenced.linkname)
                else:
                    raise Rejected('hardlink chain exceeds safety limit')

        def regular_member(key: str) -> tarfile.TarInfo:
            item = members.get(key)
            if item is None or not item.isfile():
                raise Rejected(f'missing required regular runtime file: {key}')
            return item

        manifest_item = regular_member('manifest.json')
        if manifest_item.size > 8192:
            raise Rejected('manifest unexpectedly large')
        stream = tar.extractfile(manifest_item)
        if stream is None:
            raise Rejected('manifest unreadable')
        manifest = json.load(stream)
        if not isinstance(manifest, dict) or manifest.get('schemaVersion') != 1 or \
                manifest.get('type') != 'TRADEOS_CI_RUNTIME_ARTIFACT_PILOT' or \
                manifest.get('deployable') is not False or \
                manifest.get('sourceCommit') != sha or manifest.get('requiredNodeMajor') != 22:
            raise Rejected('manifest is not an exact, nondeployable CI pilot for the requested SHA')
        for key in ('apps/api/dist/server.js', 'apps/api/package.json',
                    'bin/start-api.sh', 'bin/start-web.sh',
                    'bin/start-system-admin.sh', 'bin/runtime-env.sh'):
            item = regular_member(key)
            if key.startswith('bin/') and not item.mode & 0o111:
                raise Rejected('source-light launcher is not executable')
        for dirname in ('packages/db/migrations', 'apps/api/node_modules'):
            if dirname not in members or not members[dirname].isdir():
                raise Rejected(f'missing runtime directory: {dirname}')
        for app in ('web', 'system-admin'):
            entry = regular_member(f'apps/{app}/entrypoint.txt')
            if entry.size > 100:
                raise Rejected('Next entrypoint too large')
            data = tar.extractfile(entry)
            if data is None:
                raise Rejected('Next entrypoint unreadable')
            relative = data.read().decode('ascii').strip()
            if relative not in ('server.js', f'apps/{app}/server.js'):
                raise Rejected('unrecognized Next standalone entrypoint')
            regular_member(f'apps/{app}/{relative}')
        forbidden = {'apps/api/src', 'apps/api/test', 'apps/web/app',
                     'apps/system-admin/app', '.git', '.env', '.env.staging',
                     '.env.local', 'node_modules'}
        if any(key in members for key in forbidden):
            raise Rejected('source, credential, or repository content found in runtime bundle')
        # The packager verifies all symlinks against its stage root. Recheck
        # their targets and reject symlink chains escaping or ending missing.
        for key, member in members.items():
            if not member.issym():
                continue
            target = posixpath.normpath(posixpath.join(posixpath.dirname(key), member.linkname))
            seen = set()
            for _ in range(64):
                if target in seen:
                    raise Rejected('cyclic symlink chain')
                seen.add(target)
                parts = target.split('/')
                changed = False
                for i in range(1, len(parts) + 1):
                    part = '/'.join(parts[:i])
                    nested = members.get(part)
                    if nested is not None and nested.issym():
                        base = posixpath.dirname(part)
                        target = posixpath.normpath(posixpath.join(base, nested.linkname, *parts[i:]))
                        if target in ('..', '.') or target.startswith('../') or target.startswith('/'):
                            raise Rejected('symlink chain escapes archive root')
                        changed = True
                        break
                if not changed:
                    break
            else:
                raise Rejected('symlink chain exceeds safety limit')
            if target not in members:
                raise Rejected('symlink chain references missing archive content')

    return {
        'type': 'TradeOS nondeployable pilot intake',
        'sourceCommit': sha,
        'checksumVerified': True,
        'deployable': False,
        'compressedBytes': archive.stat().st_size,
        'expandedBytes': expanded,
        'memberCount': len(members),
        'privateDataTouched': False,
        'extractionPerformed': False,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 64
    try:
        result = inspect(argv[1], Path(argv[2]))
    except (Rejected, OSError, ValueError, KeyError, UnicodeError, tarfile.TarError) as exc:
        print(f'artifact-rejected: {exc}', file=sys.stderr)
        return 65
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
