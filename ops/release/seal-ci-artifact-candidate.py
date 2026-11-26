#!/usr/bin/env python3
"""Seal a signed, safely unpacked TradeOS NONDEPLOYABLE pilot as a temporary root-owned candidate.

Usage: seal-ci-artifact-candidate.py <exact-source-sha> <temporary-extracted-runtime>

Invocation must follow the exact-main GitHub signature check, archive inspector,
quarantined extractor and optional read-only ledger preflight. The candidate
remains beneath /tmp/tradeos-ci-intake.*/tradeos-rehearsal-<SHA>; NEVER touch a
persistent release directory, service, credential, DB, or live symlink.

This tool does not establish artifact authenticity by itself: it requires the
trusted wrapper to verify the cryptographic attestation BEFORE it is invoked.
"""

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

SHA_PATTERN = re.compile(r'[0-9a-f]{40}\Z')
PARENT_PATTERN = re.compile(r'tradeos-ci-intake\.[A-Za-z0-9_-]+\Z')
MAX_ENTRIES = 150_000
MAX_BYTES = 3 * 1024 * 1024 * 1024


class Rejected(Exception):
    pass


def validate_candidate_path(sha: str, candidate: Path) -> Path:
    if not SHA_PATTERN.fullmatch(sha):
        raise Rejected('requires exact full lowercase source SHA')
    if not candidate.is_absolute() or candidate.name != f'tradeos-rehearsal-{sha}':
        raise Rejected('only exact-SHA temporary rehearsal can be sealed')
    parent = candidate.parent
    if not PARENT_PATTERN.fullmatch(parent.name) or parent.parent != Path('/tmp'):
        raise Rejected('only app-scoped temporary intake directory is allowed')
    if parent.is_symlink() or candidate.is_symlink() or not parent.is_dir() or not candidate.is_dir():
        raise Rejected('candidate and parent must be real directories')
    for item in (parent, candidate):
        info = os.lstat(item)
        if info.st_uid != os.geteuid() or not stat.S_ISDIR(info.st_mode):
            raise Rejected('candidate must belong to the trusted invoking identity')
    return candidate


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    # Do not follow a symlink or read FIFOs/devices: the tree walker classifies
    # entries before opening them. O_NOFOLLOW protects against link replacement.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        with os.fdopen(fd, 'rb') as file:
            for block in iter(lambda: file.read(1024 * 1024), b''):
                digest.update(block)
    finally:
        # file object closes fd in its context manager
        pass
    return digest.hexdigest()


def snapshot_tree(candidate: Path, expected_uid: int) -> tuple[str, int, int, list[tuple[Path, str]]]:
    digest = hashlib.sha256()
    count = 0
    total = 0
    visited = []
    internal_links = {}
    # No os.walk(..., followlinks=True) and no stat() on symlinks.
    dirs = [candidate]
    while dirs:
        current = dirs.pop()
        info = os.lstat(current)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != expected_uid:
            raise Rejected('untrusted ownership or symlink directory detected')
        rel = current.relative_to(candidate).as_posix()
        if rel != '.':
            count += 1
            digest.update(('D\0' + rel + '\n').encode('utf8'))
            visited.append((current, 'dir'))
        with os.scandir(current) as entries:
            children = sorted(entries, key=lambda e: e.name)
        for entry in children:
            path = current / entry.name
            st = os.lstat(path)
            if st.st_uid != expected_uid or st.st_mode & 0o6000:
                raise Rejected('candidate item is not owned by expected identity or has unsafe mode')
            name = path.relative_to(candidate).as_posix()
            if name.startswith('../') or name.startswith('/') or '\\' in name:
                raise Rejected('invalid candidate item path')
            if stat.S_ISDIR(st.st_mode):
                dirs.append(path)
                continue
            count += 1
            if count > MAX_ENTRIES:
                raise Rejected('candidate entry count over limit')
            if stat.S_ISREG(st.st_mode):
                total += st.st_size
                if total > MAX_BYTES:
                    raise Rejected('candidate size exceeds verified archive upper bound')
                marker = 'X' if st.st_mode & 0o111 else 'F'
                digest.update((f'{marker}\0{name}\0{st.st_size}\0{_hash_file(path)}\n').encode('utf8'))
                visited.append((path, 'exec' if marker == 'X' else 'file'))
                # Hardlinks from archive may have multiple member names, but
                # their inode's link count cannot exceed its in-tree refs.
                key = (st.st_dev, st.st_ino)
                old = internal_links.get(key, (0, st.st_nlink))
                internal_links[key] = (old[0] + 1, st.st_nlink)
            elif stat.S_ISLNK(st.st_mode):
                target = os.readlink(path)
                if os.path.isabs(target):
                    raise Rejected('absolute symlink in candidate')
                resolved = path.resolve(strict=True)
                if candidate != resolved and candidate not in resolved.parents:
                    raise Rejected('candidate symlink escapes temporary tree')
                digest.update(('L\0' + name + '\0' + target + '\n').encode('utf8'))
                visited.append((path, 'symlink'))
            else:
                raise Rejected('special file in candidate')
        if count > MAX_ENTRIES:
            raise Rejected('candidate entry count over limit')
    if any(internal_count != nlink for internal_count, nlink in internal_links.values()):
        raise Rejected('candidate hardlink references inode outside trusted tree')
    return digest.hexdigest(), count, total, visited


def seal_candidate(sha: str, candidate: Path) -> dict:
    candidate = validate_candidate_path(sha, candidate)
    manifest_path = candidate / 'manifest.json'
    info = os.lstat(manifest_path)
    if not stat.S_ISREG(info.st_mode) or info.st_size > 8192:
        raise Rejected('pilot manifest missing or not a regular small file')
    manifest = json.loads(manifest_path.read_text('utf8'))
    if (manifest.get('schemaVersion') != 1 or
        manifest.get('type') != 'TRADEOS_CI_RUNTIME_ARTIFACT_PILOT' or
        manifest.get('sourceCommit') != sha or
        manifest.get('requiredNodeMajor') != 22 or manifest.get('deployable') is not False):
        raise Rejected('candidate is not the exact, explicitly nondeployable runtime pilot')
    fingerprint, count, total, visited = snapshot_tree(candidate, os.geteuid())
    # Seal only after complete and successful tree verification. Root is the
    # trusted authority in normal operation, no application identity may write.
    # Change all file modes before directories to maintain traversal access.
    for item, kind in visited:
        if kind in ('file', 'exec'):
            os.chmod(item, 0o555 if kind == 'exec' else 0o444, follow_symlinks=False)
    for item, kind in reversed(visited):
        if kind == 'dir':
            os.chmod(item, 0o555, follow_symlinks=False)
    os.chmod(candidate, 0o555, follow_symlinks=False)
    # Verify seal content identity after permission changes, and reject any
    # concurrent modification. Mode isn't part of the content fingerprint.
    fingerprint_after, count_after, total_after, _ = snapshot_tree(candidate, os.geteuid())
    if (fingerprint_after, count_after, total_after) != (fingerprint, count, total):
        raise Rejected('candidate content changed while sealing')
    return {'sourceCommit': sha, 'candidateSealed': True,
            'deployable': False, 'authorizedToDeploy': False,
            'runtimeSha256': fingerprint, 'members': count,
            'totalRegularBytes': total, 'permissions': 'root-owned-readonly',
            'serviceChanges': False, 'databaseWrites': False,
            'releaseSymlinkChanged': False}


def main(argv: list[str]) -> int:
    if len(argv) != 3 or os.geteuid() != 0:
        print('usage: root-only seal-ci-artifact-candidate.py <full-sha> <exact-temporary-runtime>', file=sys.stderr)
        return 64
    try:
        print(json.dumps(seal_candidate(argv[1], Path(argv[2])), sort_keys=True))
        return 0
    except (Rejected, OSError, ValueError, KeyError, UnicodeError) as exc:
        print(f'candidate-seal-rejected: {exc}', file=sys.stderr)
        return 65


if __name__ == '__main__':
    sys.exit(main(sys.argv))
