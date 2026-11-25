#!/usr/bin/env python3
"""Release-only isolated inspection and extraction; never activates services."""
import importlib.util
import json
from pathlib import Path
import sys
spec = importlib.util.spec_from_file_location("release_unpack", Path(__file__).with_name("rehearse-ci-artifact-pilot.py"))
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(64)
    try:
        print(json.dumps(module.rehearse(sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3]), profile="release"), sort_keys=True))
    except (module.Rejected, OSError, ValueError, KeyError) as error:
        print("release-rejected: " + str(error), file=sys.stderr)
        sys.exit(65)
