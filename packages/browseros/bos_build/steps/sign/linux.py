#!/usr/bin/env python3
"""Linux signing module for BrowserOS"""

from typing import List
from ...core.step import Step, step
from ...core.context import Context
from ...core.utils import log_info, log_warning


@step("sign_linux", phase="sign", platforms=("linux",), notify=True)
class LinuxSignModule(Step):
    produces = []
    requires = []
    description = "Linux code signing (no-op)"

    def validate(self, ctx: Context) -> None:
        pass

    def execute(self, ctx: Context) -> None:
        log_info("Code signing is not required for Linux packages")
def sign_universal(contexts: List[Context]) -> bool:
    """Linux doesn't support universal binaries"""
    log_warning("Universal signing is not supported on Linux")
    return True


def check_signing_environment() -> bool:
    """Linux doesn't require signing environment"""
    return True
