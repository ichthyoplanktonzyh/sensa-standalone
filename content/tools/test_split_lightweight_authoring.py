"""No-cost checks for the split lightweight authoring boundary."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from content.tools.split_lightweight_authoring import (
    _compose,
    _core_path,
    _init_overlay,
    _load_json,
    _overlay_path,
    _split_combined,
    _write_json,
)


TEMPLATES = Path(__file__).resolve().parent.parent / "templates"


class SplitLightweightAuthoringTests(unittest.TestCase):
    def test_combined_authoring_round_trips_without_losing_fields(self) -> None:
        original = _load_json(TEMPLATES / "lightweight-learning-package-authoring.template.json")
        core, overlay = _split_combined(original)
        self.assertEqual(_compose(core, overlay), original)

    def test_changed_target_scene_invalidates_existing_overlay(self) -> None:
        original = _load_json(TEMPLATES / "lightweight-learning-package-authoring.template.json")
        core, overlay = _split_combined(original)
        core["target_core"]["scene_realization"]["example"] = "A different scene."
        with self.assertRaisesRegex(ValueError, "Stale Core reference"):
            _compose(core, overlay)

    def test_support_language_visual_text_does_not_change_core(self) -> None:
        original = _load_json(TEMPLATES / "lightweight-learning-package-authoring.template.json")
        core, overlay = _split_combined(original)
        overlay["support_language"] = "ja"
        overlay["visual_text"]["alt_text"] = "日本語の画像説明"
        combined = _compose(core, overlay)
        self.assertEqual(combined["route"], {"target": "en", "support": "ja"})
        self.assertEqual(combined["visual"]["alt_text"], "日本語の画像説明")
        self.assertEqual(combined["target_core"], original["target_core"])

    def test_init_overlay_binds_core_once(self) -> None:
        core = _load_json(TEMPLATES / "lightweight-target-core.template.json")
        with tempfile.TemporaryDirectory(prefix="sensa-split-authoring-test-") as directory:
            root = Path(directory)
            _write_json(_core_path(root, "en", core["sense_id"]), core, immutable=True)
            _init_overlay(root, "en", "ja", core["sense_id"])
            overlay = _load_json(_overlay_path(root, "en", "ja", core["sense_id"]))
            self.assertEqual(overlay["support_language"], "ja")
            self.assertEqual(overlay["sense_text"]["idea"], "")
            with self.assertRaisesRegex(ValueError, "already exists"):
                _init_overlay(root, "en", "ja", core["sense_id"])


if __name__ == "__main__":
    unittest.main()
