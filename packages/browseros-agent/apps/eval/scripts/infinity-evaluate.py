#!/usr/bin/env python3
"""
Evaluation helper for WebArena-Infinity verifier scripts.

Reads JSON from stdin with app_server_url, verifier_path, and task_id.
Fetches app state, runs the verifier, and outputs a JSON result to stdout.

NOTE: The exact verifier API may differ across apps. This implementation
assumes verifiers expose a verify(state) -> bool function. Adjust the
verifier invocation if the actual format differs (some may use check(),
validate(), or accept CLI args instead of a function call).

Usage:
    echo '{"app_server_url": "http://localhost:8000", "verifier_path": "/path/to/verify.py", "task_id": "gmail-task-001"}' | python infinity-evaluate.py
"""

import importlib.util
import json
import sys
import traceback
import urllib.request


def fetch_state(server_url: str) -> dict:
    url = f"{server_url}/api/state"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def load_verifier(verifier_path: str):
    spec = importlib.util.spec_from_file_location("verifier", verifier_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load verifier from {verifier_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_verifier(module, state: dict) -> bool:
    # Try common verifier function names
    for fn_name in ("verify", "check", "validate", "grade"):
        fn = getattr(module, fn_name, None)
        if callable(fn):
            result = fn(state)
            return bool(result)

    raise AttributeError(
        f"Verifier module has no verify/check/validate/grade function. "
        f"Available: {[a for a in dir(module) if not a.startswith('_')]}"
    )


def main():
    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({"pass": False, "reward": 0.0, "message": f"Invalid JSON input: {e}"}))
        sys.exit(1)

    server_url = data.get("app_server_url", "")
    verifier_path = data.get("verifier_path", "")
    task_id = data.get("task_id", "unknown")

    if not server_url or not verifier_path:
        print(json.dumps({
            "pass": False,
            "reward": 0.0,
            "message": "Missing app_server_url or verifier_path",
        }))
        sys.exit(1)

    state_snapshot = None
    try:
        state_snapshot = fetch_state(server_url)
    except Exception as e:
        print(json.dumps({
            "pass": False,
            "reward": 0.0,
            "message": f"Failed to fetch app state: {e}",
            "state_snapshot": None,
        }))
        sys.exit(1)

    try:
        verifier = load_verifier(verifier_path)
        passed = run_verifier(verifier, state_snapshot)
    except Exception as e:
        print(json.dumps({
            "pass": False,
            "reward": 0.0,
            "message": f"Verifier error: {e}\n{traceback.format_exc()}",
            "state_snapshot": state_snapshot,
        }))
        sys.exit(1)

    print(json.dumps({
        "pass": bool(passed),
        "reward": 1.0 if passed else 0.0,
        "message": "Verification passed" if passed else "Verification failed",
        "state_snapshot": state_snapshot,
    }))


if __name__ == "__main__":
    main()
