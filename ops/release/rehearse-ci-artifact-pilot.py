#!/usr/bin/env python3
"""Fail-closed extraction of a NONDEPLOYABLE CI pilot into an isolated temp sandbox.

Usage: rehearse-ci-artifact-pilot.py <exact SHA> <downloaded artifact directory> <new sandbox path>
No production release activation, migration, network, database or process startup.
Sandbox must be new and begin with 'tradeos-rehearsal-' beneath /tmp or RUNNER_TEMP.
"""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import posixpath
import shutil
import stat
import sys
import tarfile

spec = importlib.util.spec_from_file_location(
    'tradeos_pilot_inspector', Path(__file__).with_name('inspect-ci-artifact-pilot.py')
)
assert spec and spec.loader
inspect_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspect_mod)

Rejected = inspect_mod.Rejected
O_DIR_NOFOLLOW = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
O_FILE_EXCLUSIVE = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC


def require_new_sandbox(output: Path) -> Path:
    if not output.is_absolute() or not output.name.startswith('tradeos-rehearsal-'):
        raise Rejected('sandbox must be an absolute, uniquely named tradeos-rehearsal- path')
    parent = output.parent
    if not parent.is_dir() or parent.is_symlink() or output.exists() or output.is_symlink():
        raise Rejected('sandbox parent must be real and the requested sandbox must not exist')
    parent_real = parent.resolve(strict=True)
    allowed_roots = [Path('/tmp').resolve(strict=True)]
    if os.environ.get('RUNNER_TEMP'):
        allowed_roots.append(Path(os.environ['RUNNER_TEMP']).resolve(strict=True))
    if not any(parent_real == root or root in parent_real.parents for root in allowed_roots):
        raise Rejected('sandbox must be beneath /tmp or the GitHub runner temporary directory')
    if parent_real == Path('/'):
        raise Rejected('sandbox cannot be located at filesystem root')
    parent_st = parent_real.stat()
    if parent_st.st_uid != os.geteuid() and not (parent_st.st_mode & stat.S_ISVTX):
        raise Rejected('sandbox parent is not owned by the running identity')
    return parent_real / output.name


def verify_archive_structure(tar: tarfile.TarFile) -> dict[str, tarfile.TarInfo]:
    members = {}
    for member in tar:
        key = inspect_mod.safe_member_name(member.name)
        if key in members:
            raise Rejected('duplicate archive member')
        members[key] = member
    for key, member in members.items():
        if key == '.':
            continue
        parts = key.split('/')
        for count in range(1, len(parts)):
            parent_key = '/'.join(parts[:count])
            parent = members.get(parent_key)
            if parent is not None and not parent.isdir():
                raise Rejected('archive entry nested under a non-directory, including symlink')
        if member.islnk():
            target = inspect_mod.safe_member_name(member.linkname)
            if not target or target == '.':
                raise Rejected('hardlink targets invalid archive path')
    return members


def _open_directory(root_fd: int, parts: list[str]) -> int:
    current = os.dup(root_fd)
    try:
        for part in parts:
            next_fd = os.open(part, O_DIR_NOFOLLOW, dir_fd=current)
            os.close(current)
            current = next_fd
        return current
    except BaseException:
        os.close(current)
        raise


def _make_directory(root_fd: int, key: str) -> None:
    parts = key.split('/')
    parent_fd = _open_directory(root_fd, parts[:-1])
    try:
        os.mkdir(parts[-1], mode=0o755, dir_fd=parent_fd)
    finally:
        os.close(parent_fd)


def _write_file(root_fd: int, tar: tarfile.TarFile, key: str, item: tarfile.TarInfo) -> None:
    parts = key.split('/')
    parent_fd = _open_directory(root_fd, parts[:-1])
    flags = O_FILE_EXCLUSIVE
    fd = -1
    try:
        fd = os.open(parts[-1], flags, 0o600, dir_fd=parent_fd)
        stream = tar.extractfile(item)
        if stream is None:
            raise Rejected('unable to stream regular archive member')
        count = 0
        with stream, os.fdopen(fd, 'wb', closefd=True) as output:
            fd = -1
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                count += len(chunk)
                if count > item.size:
                    raise Rejected('regular member streamed more than declared')
                output.write(chunk)
            if count != item.size:
                raise Rejected('regular member truncated')
            os.fchmod(output.fileno(), 0o755 if item.mode & 0o111 else 0o644)
    finally:
        if fd != -1:
            os.close(fd)
        os.close(parent_fd)


def _write_hardlink(root_fd: int, key: str, target: str) -> None:
    dest_parts = key.split('/')
    target_parts = target.split('/')
    src_fd = _open_directory(root_fd, target_parts[:-1])
    dest_fd = _open_directory(root_fd, dest_parts[:-1])
    try:
        os.link(target_parts[-1], dest_parts[-1], src_dir_fd=src_fd,
                dst_dir_fd=dest_fd, follow_symlinks=False)
    finally:
        os.close(src_fd)
        os.close(dest_fd)


def _write_symlink(root_fd: int, key: str, target: str) -> None:
    parts = key.split('/')
    parent_fd = _open_directory(root_fd, parts[:-1])
    try:
        os.symlink(target, parts[-1], dir_fd=parent_fd)
    finally:
        os.close(parent_fd)


def _target_regular(members: dict[str, tarfile.TarInfo], item: tarfile.TarInfo) -> str:
    key = inspect_mod.safe_member_name(item.linkname)
    seen = set()
    while True:
        if key in seen:
            raise Rejected('cyclic archive hardlink reference')
        seen.add(key)
        target = members.get(key)
        if target is None:
            raise Rejected('hardlink missing target')
        if target.isfile():
            return key
        if not target.islnk():
            raise Rejected('hardlink to non-regular file')
        key = inspect_mod.safe_member_name(target.linkname)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def rehearse(sha: str, folder: Path, output: Path) -> dict:
    # Inspect SHA, digest, provenance marker, exact manifest, payload and all
    # symlink chains BEFORE creating any output directory.
    metadata = inspect_mod.inspect(sha, folder)
    if metadata['deployable'] is not False:
        raise Rejected('rehearsal is allowed only for nondeployable pilot artifacts')
    archive = folder / f'tradeos-runtime-pilot-{sha}.tar.gz'
    before_sha256 = _sha256(archive)
    destination = require_new_sandbox(output)
    created = False
    root_inode = None
    try:
        with tarfile.open(archive, 'r:gz') as tar:
            members = verify_archive_structure(tar)
            # The payload is not trusted to choose output names or parents.
            destination.mkdir(mode=0o700)
            created = True
            root_inode = destination.stat().st_ino
            root_fd = os.open(destination, O_DIR_NOFOLLOW)
            try:
                # Create all real directories first, regardless of tar ordering.
                directories = [key for key, item in members.items() if key != '.' and item.isdir()]
                for key in sorted(directories, key=lambda value: (value.count('/'), value)):
                    _make_directory(root_fd, key)
                for key, item in members.items():
                    if item.isfile():
                        _write_file(root_fd, tar, key, item)
                for key, item in members.items():
                    if item.islnk():
                        _write_hardlink(root_fd, key, _target_regular(members, item))
                for key, item in members.items():
                    if item.issym():
                        _write_symlink(root_fd, key, item.linkname)
            finally:
                os.close(root_fd)

        if before_sha256 != _sha256(archive):
            raise Rejected('archive content changed after verification')
        # Verify every symlink resolves within the sandbox, not just lexical
        # link paths. Missing or cyclic symlinks also fail closed.
        dest_real = destination.resolve(strict=True)
        for key, item in members.items():
            if item.issym():
                real = (destination / key).resolve(strict=True)
                if real != dest_real and dest_real not in real.parents:
                    raise Rejected('resolved archive symlink escapes quarantine')
        return {
            'sourceCommit': sha,
            'deployable': False,
            'sandbox': str(destination),
            'extractedMembers': len(members),
            'expandedRegularBytes': metadata['expandedBytes'],
            'checksumsReverified': True,
            'processesStarted': False,
            'productionReleaseTouched': False,
        }
    except BaseException:
        if created and root_inode is not None and destination.is_dir() and not destination.is_symlink() and destination.stat().st_ino == root_inode:
            shutil.rmtree(destination)
        raise


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print(__doc__, file=sys.stderr)
        return 64
    try:
        print(json.dumps(rehearse(argv[1], Path(argv[2]), Path(argv[3])), sort_keys=True))
        return 0
    except (Rejected, OSError, ValueError, KeyError, UnicodeError, tarfile.TarError) as exc:
        print(f'rehearsal-rejected: {exc}', file=sys.stderr)
        return 65


if __name__ == '__main__':
    sys.exit(main(sys.argv))
