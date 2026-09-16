"""Guard for the reply-language rule in CLAUDE.md (fork-owned, see FORK.md).

The framework's user-facing prose is written out in English inside
`.claude/`, so without an explicit rule an agent reads it as a script and
answers an Italian user in English. The rule lives in CLAUDE.md alone -
deliberately, to keep the fork's diff off upstream-pristine files - which
makes this the only place it can be pinned.
"""
import unittest
from pathlib import Path

CLAUDE_MD = Path(__file__).resolve().parent.parent / "CLAUDE.md"
HEADING = "## Interaction Language"


class TestInteractionLanguage(unittest.TestCase):
    def setUp(self):
        text = CLAUDE_MD.read_text(encoding="utf-8")
        self.assertIn(HEADING, text, f"CLAUDE.md must carry a '{HEADING}' section")
        body = text.split(HEADING, 1)[1].split("\n## ", 1)[0]
        # Collapsed so a reflowed line never fails an assertion.
        self.body = " ".join(body.split())

    def test_states_the_rule_and_its_fallback(self):
        self.assertIn("language the user writes in", self.body)
        self.assertIn("CV language", self.body)

    def test_unset_profile_defaults_to_italian(self):
        # A bare `/setup` carries no prose AND runs before `CV language` is
        # filled in, so an English last resort would answer this fork's own
        # onboarding in the wrong language.
        self.assertIn("/setup", self.body)
        self.assertIn("Italian", self.body)
        self.assertNotIn("then English", self.body)

    def test_quoted_english_is_a_template_not_a_script(self):
        self.assertIn("template to translate", self.body)

    def test_identifiers_stay_untranslated(self):
        for identifier in ("`drafted`", "`no_response`"):
            self.assertIn(identifier, self.body)

    def test_document_language_is_left_alone(self):
        self.assertIn("cover letter", self.body)


if __name__ == "__main__":
    unittest.main()
