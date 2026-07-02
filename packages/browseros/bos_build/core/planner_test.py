#!/usr/bin/env python3
"""Golden tests: plan() must reproduce the module lists the deleted
config/release.*.yaml files encoded (source file named per case)."""

import tempfile
import unittest
from pathlib import Path

from bos_build.core.planner import (
    Switches,
    load_profile,
    plan,
    plan_runs,
    required_env,
)

RELEASE = Switches(preset="release")
CI = Switches(preset="release", clean=False, provision="none", sign=False, upload=False)
UNIVERSAL = Switches(preset="release", architectures=("universal",))


class ReleaseGoldenTest(unittest.TestCase):
    def test_macos_arm64_signed(self):
        # release.browseros.macos.arm64.yaml / release.macos.arm64.yaml
        self.assertEqual(
            plan(RELEASE, "arm64", "macos"),
            [
                "clean",
                "git_setup",
                "sparkle_setup",
                "download_resources",
                "resources",
                "bundled_extensions",
                "chromium_replace",
                "string_replaces",
                "series_patches",
                "patches",
                "configure",
                "compile",
                "sign_macos",
                "package_macos",
                "upload",
            ],
        )

    def test_windows_signed(self):
        # release.browseros.windows.yaml — note sparkle_sign AFTER package
        self.assertEqual(
            plan(RELEASE, "x64", "windows"),
            [
                "clean",
                "git_setup",
                "winsparkle_setup",
                "download_resources",
                "resources",
                "bundled_extensions",
                "chromium_replace",
                "string_replaces",
                "series_patches",
                "patches",
                "configure",
                "compile",
                "sign_windows",
                "package_windows",
                "sparkle_sign",
                "upload",
            ],
        )

    def test_linux_never_plans_sign(self):
        # release.browseros.linux.yaml
        steps = plan(RELEASE, "x64", "linux")
        self.assertEqual(
            steps,
            [
                "clean",
                "git_setup",
                "download_resources",
                "resources",
                "bundled_extensions",
                "chromium_replace",
                "string_replaces",
                "series_patches",
                "patches",
                "configure",
                "compile",
                "package_linux",
                "upload",
            ],
        )
        self.assertFalse(any(s.startswith("sign") for s in steps))

    def test_macos_universal(self):
        # release.browseros.macos.universal.yaml — three sequential runs on
        # one prepped tree: prep exactly once (repeating clean/git_setup/
        # patches would reset it), resources per arch, then the merge
        self.assertEqual(
            plan_runs(UNIVERSAL, "macos"),
            [
                (
                    "arm64",
                    [
                        "clean",
                        "git_setup",
                        "sparkle_setup",
                        "download_resources",
                        "bundled_extensions",
                        "chromium_replace",
                        "string_replaces",
                        "series_patches",
                        "patches",
                        "resources",
                        "configure",
                        "compile",
                        "sign_macos",
                        "package_macos",
                        "upload",
                    ],
                ),
                (
                    "x64",
                    [
                        "resources",
                        "configure",
                        "compile",
                        "sign_macos",
                        "package_macos",
                        "upload",
                    ],
                ),
                (
                    "universal",
                    ["merge_universal", "sign_macos", "package_macos", "upload"],
                ),
            ],
        )

    def test_universal_rejected_off_macos(self):
        with self.assertRaisesRegex(ValueError, "only supported on macos"):
            plan_runs(UNIVERSAL, "linux")

    def test_noupload_variant(self):
        # release.macos.arm64.noupload.yaml == release minus upload
        steps = plan(Switches(preset="release", upload=False), "arm64", "macos")
        self.assertEqual(steps[-1], "package_macos")
        self.assertNotIn("upload", steps)


class CiGoldenTest(unittest.TestCase):
    def test_macos_ci_keeps_sparkle_setup_unsigned(self):
        # release.macos.arm64.ci.yaml
        self.assertEqual(
            plan(CI, "arm64", "macos"),
            [
                "sparkle_setup",
                "download_resources",
                "resources",
                "bundled_extensions",
                "chromium_replace",
                "string_replaces",
                "series_patches",
                "patches",
                "configure",
                "compile",
                "package_macos",
            ],
        )

    def test_windows_ci_swaps_sign_for_mini_installer(self):
        # release.windows.ci.yaml — no winsparkle_setup, no sparkle_sign
        self.assertEqual(
            plan(CI, "x64", "windows"),
            [
                "download_resources",
                "resources",
                "bundled_extensions",
                "chromium_replace",
                "string_replaces",
                "series_patches",
                "patches",
                "configure",
                "compile",
                "mini_installer",
                "package_windows",
            ],
        )

    def test_linux_ci(self):
        # release.linux.ci.yaml
        self.assertEqual(
            plan(CI, "x64", "linux"),
            [
                "download_resources",
                "resources",
                "bundled_extensions",
                "chromium_replace",
                "string_replaces",
                "series_patches",
                "patches",
                "configure",
                "compile",
                "package_linux",
            ],
        )


class DebugGoldenTest(unittest.TestCase):
    def test_debug_macos(self):
        # config/debug.yaml — no clean, no bundled_extensions, no
        # series_patches, no sparkle_setup, no sign, no upload
        self.assertEqual(
            plan(Switches(preset="debug"), "arm64", "macos"),
            [
                "git_setup",
                "download_resources",
                "resources",
                "chromium_replace",
                "string_replaces",
                "patches",
                "configure",
                "compile",
                "package_macos",
            ],
        )

    def test_debug_rejects_universal(self):
        with self.assertRaisesRegex(ValueError, "not supported for debug"):
            plan_runs(Switches(preset="debug", architectures=("universal",)), "macos")

    def test_debug_rejection_wins_over_platform(self):
        with self.assertRaisesRegex(ValueError, "not supported for debug"):
            plan_runs(Switches(preset="debug", architectures=("universal",)), "linux")


class SwitchesTest(unittest.TestCase):
    def test_unknown_preset_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unknown preset"):
            Switches(preset="nightly").resolved()

    def test_invalid_arch_rejected(self):
        with self.assertRaisesRegex(ValueError, "Invalid architecture"):
            Switches(architectures=("mips",)).resolved()

    def test_invalid_provision_rejected(self):
        with self.assertRaisesRegex(ValueError, "Invalid provision"):
            Switches(provision="warp").resolved()

    def test_multi_arch_plans_per_arch(self):
        sw = Switches(preset="release", architectures=("x64", "arm64")).resolved()
        plans = [plan(sw, arch, "linux") for arch in sw.architectures]
        self.assertEqual(len(plans), 2)
        self.assertEqual(plans[0], plans[1])

    def test_build_type_follows_preset(self):
        self.assertEqual(Switches(preset="release").build_type, "release")
        self.assertEqual(Switches(preset="debug").build_type, "debug")


class RequiredEnvTest(unittest.TestCase):
    def test_signed_macos_requires_cert_and_notarization(self):
        # parity with release.*.macos.*.yaml required_envs
        env = required_env(plan(RELEASE, "arm64", "macos"))
        self.assertEqual(
            env,
            [
                "MACOS_CERTIFICATE_NAME",
                "PROD_MACOS_NOTARIZATION_APPLE_ID",
                "PROD_MACOS_NOTARIZATION_TEAM_ID",
                "PROD_MACOS_NOTARIZATION_PWD",
            ],
        )

    def test_signed_windows_requires_esigner_and_sparkle_key(self):
        # parity with release.*.windows.yaml required_envs
        env = required_env(plan(RELEASE, "x64", "windows"))
        self.assertEqual(
            env,
            [
                "CODE_SIGN_TOOL_PATH",
                "ESIGNER_USERNAME",
                "ESIGNER_PASSWORD",
                "ESIGNER_TOTP_SECRET",
                "SPARKLE_PRIVATE_KEY",
            ],
        )

    def test_unsigned_ci_requires_nothing(self):
        self.assertEqual(required_env(plan(CI, "x64", "windows")), [])
        self.assertEqual(required_env(plan(CI, "arm64", "macos")), [])


class ProfileTest(unittest.TestCase):
    def _load(self, text: str) -> Switches:
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
            f.write(text)
            path = Path(f.name)
        self.addCleanup(path.unlink)
        return load_profile(path)

    def test_nightly_ci_profile_maps_to_switches(self):
        sw = self._load(
            "preset: release\nclean: false\nprovision: none\nsign: false\nupload: false\n"
        )
        self.assertEqual(
            plan(sw, "arm64", "macos"), plan(CI, "arm64", "macos")
        )

    def test_arch_list(self):
        sw = self._load("preset: release\narch: [x64, arm64]\n")
        self.assertEqual(sw.architectures, ("x64", "arm64"))

    def test_unknown_key_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unknown profile keys"):
            self._load("preset: release\nmodules: [clean]\n")




class PreflightTest(unittest.TestCase):
    def test_lists_all_missing_env_vars_not_first_only(self):
        import os
        from unittest import mock

        from bos_build.core.planner import preflight

        clean = {
            k: v
            for k, v in os.environ.items()
            if not k.startswith(("MACOS_", "PROD_MACOS_"))
        }
        with mock.patch.dict(os.environ, clean, clear=True):
            with self.assertRaises(ValueError) as err:
                preflight(plan(RELEASE, "arm64", "macos"), platform="macos")

        message = str(err.exception)
        self.assertIn("MACOS_CERTIFICATE_NAME", message)
        self.assertIn("PROD_MACOS_NOTARIZATION_APPLE_ID", message)
        self.assertIn("PROD_MACOS_NOTARIZATION_TEAM_ID", message)
        self.assertIn("PROD_MACOS_NOTARIZATION_PWD", message)

    def test_platform_mismatch_rejected(self):
        from bos_build.core.planner import preflight

        with self.assertRaisesRegex(ValueError, "does not apply to platform 'linux'"):
            preflight(["clean", "sign_macos"], platform="linux")

    def test_unknown_step_rejected(self):
        from bos_build.core.planner import preflight

        with self.assertRaisesRegex(ValueError, "unknown step: nonsense"):
            preflight(["nonsense"], platform="linux")

    def test_unsigned_ci_pipeline_preflights_clean(self):
        from bos_build.core.planner import preflight

        preflight(plan(CI, "x64", "linux"), platform="linux")

    def test_step_preflight_hook_failures_reported(self):
        from types import SimpleNamespace
        from unittest import mock

        from bos_build.core import step as step_mod
        from bos_build.core.planner import preflight
        from bos_build.core.step import Step, ValidationError

        class NeedsTool(Step):
            def preflight(self, context):
                raise ValidationError("xcode 26 required")

            def validate(self, context):
                pass

            def execute(self, context):
                pass

        with mock.patch.dict(step_mod._REGISTRY, {"needs_tool": NeedsTool}):
            with self.assertRaisesRegex(ValueError, "xcode 26 required"):
                preflight(["needs_tool"], platform="linux", ctx=SimpleNamespace())


class DownloadSwitchTest(unittest.TestCase):
    def test_no_download_drops_resource_download_only(self):
        # nightly-macos-build.yml stages server resources locally and used
        # to rewrite the yaml to drop download_resources
        with_dl = plan(RELEASE, "arm64", "macos")
        without = plan(Switches(preset="release", download=False), "arm64", "macos")
        self.assertEqual(
            [s for s in with_dl if s != "download_resources"], without
        )

    def test_shipped_nightly_ci_profile_matches_ci_switches(self):
        shipped = (
            Path(__file__).resolve().parents[1] / "profiles" / "nightly-ci.yaml"
        )
        sw = load_profile(shipped)
        for platform, arch in (("macos", "arm64"), ("windows", "x64"), ("linux", "x64")):
            self.assertEqual(
                plan(sw, arch, platform),
                plan(CI, arch, platform),
                f"profile drift on {platform}/{arch}",
            )



class UniversalRunsTest(unittest.TestCase):
    def test_flat_plan_rejects_universal(self):
        with self.assertRaisesRegex(ValueError, "plan_runs"):
            plan(RELEASE, "universal", "macos")

    def test_universal_requires_sign(self):
        with self.assertRaisesRegex(ValueError, "always signed"):
            plan_runs(
                Switches(preset="release", architectures=("universal",), sign=False),
                "macos",
            )

    def test_universal_rejected_in_multi_arch_list(self):
        with self.assertRaisesRegex(ValueError, "cannot be combined"):
            plan_runs(
                Switches(preset="release", architectures=("x64", "universal")),
                "macos",
            )

    def test_noupload_drops_upload_from_every_run(self):
        runs = plan_runs(
            Switches(preset="release", architectures=("universal",), upload=False),
            "macos",
        )
        self.assertEqual([arch for arch, _ in runs], ["arm64", "x64", "universal"])
        for arch, steps in runs:
            self.assertNotIn("upload", steps, arch)
            self.assertEqual(steps[-1], "package_macos", arch)

    def test_non_universal_runs_match_flat_plan_per_arch(self):
        sw = Switches(preset="release", architectures=("x64", "arm64"))
        self.assertEqual(
            plan_runs(sw, "linux"),
            [(arch, plan(sw, arch, "linux")) for arch in ("x64", "arm64")],
        )


class UniversalEnvTest(unittest.TestCase):
    def test_universal_runs_require_signing_env_upfront(self):
        # parity with the deleted release.*.macos.universal.yaml required_envs
        for arch, steps in plan_runs(UNIVERSAL, "macos"):
            self.assertEqual(
                required_env(steps),
                [
                    "MACOS_CERTIFICATE_NAME",
                    "PROD_MACOS_NOTARIZATION_APPLE_ID",
                    "PROD_MACOS_NOTARIZATION_TEAM_ID",
                    "PROD_MACOS_NOTARIZATION_PWD",
                ],
                arch,
            )

if __name__ == "__main__":
    unittest.main()
