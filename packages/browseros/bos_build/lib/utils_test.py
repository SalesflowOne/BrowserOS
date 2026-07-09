#!/usr/bin/env python3
"""Tests for command and logging redaction."""

import io
import os
import subprocess
import unittest
from contextlib import redirect_stdout
from unittest import mock

from . import logger, utils


FAKE_PASSWORD = "FAKE_ESIGNER_PASSWORD_FOR_REDACTION_TEST"
FAKE_TOTP = "FAKE_ESIGNER_TOTP_FOR_REDACTION_TEST"
FAKE_KEYCHAIN_PASSWORD = "FAKE_KEYCHAIN_PASSWORD_FOR_REDACTION_TEST"


class _FakeProcess:
    def __init__(self, output: str, returncode: int = 0):
        self.stdout = io.StringIO(output)
        self.returncode = returncode

    def wait(self) -> None:
        return None


class CommandRedactionTest(unittest.TestCase):
    def test_redacts_separate_and_inline_secret_flags_without_mutating_command(self):
        command = [
            "CodeSignTool.bat",
            "sign",
            "-username",
            "build@example.test",
            "-password",
            f'"{FAKE_PASSWORD}"',
            "-totp_secret",
            FAKE_TOTP,
            "--password=FAKE_INLINE_PASSWORD_FOR_REDACTION_TEST",
            "artifact.exe",
        ]
        original = command.copy()

        displayed = utils.redact_command(command)

        self.assertEqual(command, original)
        self.assertIn("-username build@example.test", displayed)
        self.assertIn("-password ***", displayed)
        self.assertIn("-totp_secret ***", displayed)
        self.assertIn("--password=***", displayed)
        for secret in (
            FAKE_PASSWORD,
            FAKE_TOTP,
            "FAKE_INLINE_PASSWORD_FOR_REDACTION_TEST",
        ):
            self.assertNotIn(secret, displayed)

    def test_redacts_keychain_password_flag(self):
        displayed = utils.redact_command(
            [
                "security",
                "unlock-keychain",
                "-p",
                FAKE_KEYCHAIN_PASSWORD,
                "login.keychain-db",
            ]
        )

        self.assertEqual(
            displayed,
            "security unlock-keychain -p *** login.keychain-db",
        )

    def test_redacts_configured_secret_values_from_arbitrary_text(self):
        with mock.patch.dict(
            os.environ,
            {"ESIGNER_PASSWORD": FAKE_PASSWORD},
            clear=False,
        ):
            displayed = utils.redact_sensitive_text(
                f"signer echoed password={FAKE_PASSWORD}"
            )

        self.assertEqual(displayed, "signer echoed password=***")


class LoggingSinkRedactionTest(unittest.TestCase):
    def test_console_and_file_sinks_redact_configured_values(self):
        file_output = io.StringIO()
        with (
            mock.patch.dict(
                os.environ,
                {"ESIGNER_PASSWORD": FAKE_PASSWORD},
                clear=False,
            ),
            mock.patch.object(logger, "_ensure_log_file", return_value=file_output),
            mock.patch.object(logger.typer, "echo") as echo,
        ):
            logger.log_info(f"tool output: {FAKE_PASSWORD}")

        console_message = echo.call_args.args[0]
        self.assertEqual(console_message, "tool output: ***")
        self.assertNotIn(FAKE_PASSWORD, file_output.getvalue())
        self.assertIn("INFO: tool output: ***", file_output.getvalue())


class RunCommandRedactionTest(unittest.TestCase):
    def test_streams_redacted_output_but_returns_raw_output(self):
        command = [
            "fake-signer",
            "-password",
            f'"{FAKE_PASSWORD}"',
            "-totp_secret",
            FAKE_TOTP,
        ]
        process = _FakeProcess(
            f"echoed {FAKE_PASSWORD} and {FAKE_TOTP}\n",
            returncode=0,
        )
        file_messages = []
        info_messages = []
        console_output = io.StringIO()

        with (
            mock.patch.object(
                utils.subprocess, "Popen", return_value=process
            ) as popen,
            mock.patch.object(utils, "_log_to_file", side_effect=file_messages.append),
            mock.patch.object(utils, "log_info", side_effect=info_messages.append),
            redirect_stdout(console_output),
        ):
            result = utils.run_command(command)

        logged = "\n".join(file_messages + info_messages) + console_output.getvalue()
        self.assertNotIn(FAKE_PASSWORD, logged)
        self.assertNotIn(FAKE_TOTP, logged)
        self.assertIn("-password ***", logged)
        self.assertIn("-totp_secret ***", logged)
        self.assertIn("echoed *** and ***", logged)
        self.assertEqual(
            result.stdout,
            f"echoed {FAKE_PASSWORD} and {FAKE_TOTP}",
        )
        self.assertEqual(result.args, command)
        self.assertEqual(popen.call_args.args[0], command)

    def test_failure_logs_never_repeat_the_raw_command(self):
        command = ["fake-signer", "-password", FAKE_PASSWORD]
        process = _FakeProcess("", returncode=7)
        file_messages = []
        error_messages = []

        with (
            mock.patch.object(utils.subprocess, "Popen", return_value=process),
            mock.patch.object(utils, "_log_to_file", side_effect=file_messages.append),
            mock.patch.object(utils, "log_info"),
            mock.patch.object(utils, "log_error", side_effect=error_messages.append),
            self.assertRaises(subprocess.CalledProcessError) as raised,
        ):
            utils.run_command(command)

        logged = "\n".join(file_messages + error_messages)
        self.assertNotIn(FAKE_PASSWORD, logged)
        self.assertIn("Command failed: fake-signer -password ***", logged)
        self.assertNotIn(FAKE_PASSWORD, str(raised.exception))
        self.assertEqual(raised.exception.cmd, "fake-signer -password ***")


if __name__ == "__main__":
    unittest.main()
