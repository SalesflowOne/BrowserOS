#!/usr/bin/env python3
"""Tests for Windows signing path discovery."""

import unittest
import subprocess
from tempfile import TemporaryDirectory
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from unittest import mock

from bos_build.core.context import Context
from bos_build.core.products import get_product_descriptor
from bos_build.lib.env import EnvConfig
from . import windows
from .windows import (
    WindowsSignModule,
    get_browseros_server_binary_paths,
    get_existing_browseros_server_binary_paths,
    get_missing_required_browseros_server_binary_paths,
)


FAKE_PASSWORD = "FAKE_WINDOWS_SIGNING_PASSWORD_FOR_REDACTION_TEST"
FAKE_TOTP = "FAKE_WINDOWS_SIGNING_TOTP_FOR_REDACTION_TEST"


class WindowsSignPathsTest(unittest.TestCase):
    def test_browseros_and_claw_server_binaries_are_expected_for_signing(self):
        build_output_dir = Path("/tmp/out/Default")

        self.assertEqual(
            get_browseros_server_binary_paths(build_output_dir),
            [
                build_output_dir
                / "BrowserOSServer"
                / "default"
                / "resources"
                / "bin"
                / "browseros_server.exe",
                build_output_dir
                / "BrowserClawServer"
                / "default"
                / "resources"
                / "bin"
                / "browseros-claw-server.exe",
            ],
        )

    def test_missing_optional_claw_binary_is_not_required_before_packaging(self):
        with TemporaryDirectory() as tmp:
            build_output_dir = Path(tmp)
            self._write_binary(
                build_output_dir
                / "BrowserOSServer"
                / "default"
                / "resources"
                / "bin"
                / "browseros_server.exe"
            )

            self.assertEqual(
                get_existing_browseros_server_binary_paths(build_output_dir),
                [
                    build_output_dir
                    / "BrowserOSServer"
                    / "default"
                    / "resources"
                    / "bin"
                    / "browseros_server.exe"
                ],
            )
            self.assertEqual(
                get_missing_required_browseros_server_binary_paths(build_output_dir),
                [],
            )

    def test_missing_claw_binary_is_required_once_root_is_packaged(self):
        with TemporaryDirectory() as tmp:
            build_output_dir = Path(tmp)
            self._write_binary(
                build_output_dir
                / "BrowserOSServer"
                / "default"
                / "resources"
                / "bin"
                / "browseros_server.exe"
            )
            (
                build_output_dir
                / "BrowserClawServer"
                / "default"
                / "resources"
                / "bin"
            ).mkdir(parents=True)

            self.assertEqual(
                get_missing_required_browseros_server_binary_paths(build_output_dir),
                [
                    build_output_dir
                    / "BrowserClawServer"
                    / "default"
                    / "resources"
                    / "bin"
                    / "browseros-claw-server.exe"
                ],
            )

    def test_sign_executables_fails_when_required_server_binary_missing(self):
        with TemporaryDirectory() as tmp:
            build_output_dir = Path(tmp)
            self._write_binary(build_output_dir / "chrome.exe")

            with self.assertRaisesRegex(RuntimeError, "browseros_server.exe"):
                WindowsSignModule()._sign_executables(
                    build_output_dir, self._ctx("browseros")
                )

    def test_missing_chrome_is_fatal_for_each_product(self):
        for product_id in ("browseros", "browserclaw"):
            with self.subTest(product=product_id), TemporaryDirectory() as tmp:
                build_output_dir = Path(tmp)
                for binary in get_browseros_server_binary_paths(
                    build_output_dir, product_id
                ):
                    self._write_binary(binary)

                with mock.patch(
                    "bos_build.steps.sign.windows.sign_with_codesigntool"
                ) as sign:
                    with self.assertRaisesRegex(
                        RuntimeError, "Missing primary browser executable:.*chrome.exe"
                    ):
                        WindowsSignModule()._sign_executables(
                            build_output_dir, self._ctx(product_id)
                        )

                sign.assert_not_called()

    def test_browserclaw_requires_claw_binary(self):
        with TemporaryDirectory() as tmp:
            build_output_dir = Path(tmp)
            self._write_binary(build_output_dir / "chrome.exe")

            with self.assertRaisesRegex(RuntimeError, "browseros-claw-server.exe"):
                WindowsSignModule()._sign_executables(
                    build_output_dir, self._ctx("browserclaw")
                )

    def _write_binary(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"binary")

    def _ctx(self, product: str):
        return cast(
            Context,
            SimpleNamespace(product=get_product_descriptor(product), env=mock.Mock()),
        )


class WindowsSignLoggingTest(unittest.TestCase):
    def test_logs_redacted_credentials_but_executes_original_command(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            tool = root / "CodeSignTool.bat"
            binary = root / "browser.exe"
            tool.write_bytes(b"tool")
            binary.write_bytes(b"unsigned")
            env = cast(
                EnvConfig,
                SimpleNamespace(
                    code_sign_tool_exe=str(tool),
                    code_sign_tool_path=None,
                    esigner_username="build@example.test",
                    esigner_password=FAKE_PASSWORD,
                    esigner_totp_secret=FAKE_TOTP,
                    esigner_credential_id="fake-credential-id",
                ),
            )

            def fake_run(command, **kwargs):
                if isinstance(command, str):
                    signed_file = root / "signed_temp" / binary.name
                    signed_file.write_bytes(b"signed")
                    return subprocess.CompletedProcess(
                        command,
                        0,
                        stdout=f"tool echoed {FAKE_PASSWORD}",
                        stderr=f"diagnostic echoed {FAKE_TOTP}",
                    )
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout="Valid",
                    stderr="",
                )

            with (
                mock.patch.object(windows.subprocess, "run", side_effect=fake_run) as run,
                mock.patch.object(windows, "log_info") as log_info,
                mock.patch.object(windows, "log_error") as log_error,
            ):
                self.assertTrue(windows.sign_with_codesigntool([binary], env))

        executed_command = run.call_args_list[0].args[0]
        self.assertIn(f'-password "{FAKE_PASSWORD}"', executed_command)
        self.assertIn(f"-totp_secret {FAKE_TOTP}", executed_command)
        self.assertTrue(run.call_args_list[0].kwargs["shell"])

        logged = "\n".join(
            str(call.args[0]) for call in [*log_info.call_args_list, *log_error.call_args_list]
        )
        self.assertNotIn(FAKE_PASSWORD, logged)
        self.assertNotIn(FAKE_TOTP, logged)
        self.assertIn("-password ***", logged)
        self.assertIn("-totp_secret ***", logged)
        self.assertIn("tool echoed ***", logged)
        self.assertIn("diagnostic echoed ***", logged)


if __name__ == "__main__":
    unittest.main()
