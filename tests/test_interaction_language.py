"""Guards for the reply-language rule.

The framework's user-facing prose - welcome messages, fit tables, confirmation
prompts - is written in English inside `.claude/commands/*.md` and the skill
files. Without an explicit rule, an agent reads that prose as a script and
answers an Italian user in English, which is what this rule exists to stop.

The rule is canonical in CLAUDE.md's `## Interaction Language` section and
pointed at from SKILL.md and AGENTS.md (thin-pointer design, AGENTS.md). These
tests pin (a) that the canonical section exists and still carries its three
load-bearing clauses, (b) that the pointers point at it rather than restating
it, and (c) that the rule keeps conversation language separate from document
language, so nobody "fixes" it into switching the CV language per posting.
"""
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CLAUDE_MD = REPO / "CLAUDE.md"
SKILL = REPO / ".claude" / "skills" / "job-application-assistant" / "SKILL.md"
AGENTS = REPO / "AGENTS.md"
SETUP = REPO / ".claude" / "commands" / "setup.md"

HEADING = "## Interaction Language"


def section(text, heading):
    """Return the body of a markdown section up to the next same-or-higher heading."""
    pattern = re.compile(
        rf"^{re.escape(heading)}[^\n]*\n(.*?)(?=^## |\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(text)
    return match.group(1) if match else ""


class TestCanonicalRule(unittest.TestCase):
    def setUp(self):
        self.body = section(CLAUDE_MD.read_text(encoding="utf-8"), HEADING)

    def test_section_exists(self):
        self.assertTrue(
            self.body.strip(),
            f"CLAUDE.md must carry a '{HEADING}' section - it is the canonical "
            "home of the reply-language rule",
        )

    def test_states_the_rule(self):
        self.assertIn(
            "language the user writes in",
            self.body,
            "the rule must say to answer in the language the user writes in",
        )

    def test_names_the_fallback_order(self):
        self.assertIn(
            "CV language",
            self.body,
            "the rule must name the fallback used when the user's language is unclear",
        )
        self.assertIn(
            "English",
            self.body,
            "the rule must name English as the last-resort fallback",
        )

    def test_quoted_prose_is_a_template_not_a_script(self):
        self.assertRegex(
            self.body,
            r"template to render, not a script to copy",
            "the rule must say the English prose quoted in .claude/ is a template "
            "to translate, not a script to copy verbatim",
        )

    def test_identifiers_are_never_translated(self):
        for identifier in ("`drafted`", "`applied`", "`no_response`"):
            self.assertIn(
                identifier,
                self.body,
                "the rule must name tracker status values among the identifiers "
                "that stay untranslated - a translated status breaks the tracker",
            )

    def test_document_language_is_left_alone(self):
        self.assertIn(
            "cover letter",
            self.body,
            "the rule must state that cover letters follow their posting's language, "
            "not the conversation's",
        )


class TestPointers(unittest.TestCase):
    def test_skill_points_at_claude_md(self):
        text = SKILL.read_text(encoding="utf-8")
        self.assertIn(HEADING, text)
        self.assertIn("CLAUDE.md", text)

    def test_agents_md_points_at_claude_md(self):
        text = AGENTS.read_text(encoding="utf-8")
        self.assertIn(HEADING, text)
        self.assertIn("[CLAUDE.md](CLAUDE.md)", text)

    def test_setup_renders_its_prompts_in_the_users_language(self):
        text = SETUP.read_text(encoding="utf-8")
        self.assertIn(
            HEADING,
            text,
            "/setup runs before the profile exists and owns the first English prose "
            "a user sees, so it must point at the rule explicitly",
        )


if __name__ == "__main__":
    unittest.main()
