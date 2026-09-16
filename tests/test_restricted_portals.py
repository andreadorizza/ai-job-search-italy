"""Guards for the restricted-portal opt-in tier (fork-owned; see FORK.md).

Some Italian job boards disallow automated access in robots.txt or prohibit it
in their terms. Where a technical route exists anyway, this fork ships the
portal skill but gates it *twice*:

  1. `SKILL.md` frontmatter declares `access: restricted` and `enabled: false`
  2. the CLI itself refuses to run unless AI_JOB_SEARCH_ALLOW_RESTRICTED=1

Two independent gates, because a single flag is one careless edit away from
being on. These tests fail the build if a restricted skill ever loses either
one, or if the mechanism is quietly dropped from the docs that describe it.

They pass vacuously while no restricted portal is installed - that is correct,
and the docs assertions still hold the mechanism in place until one is.
"""

import re
import unittest
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
AGENT_SKILLS = REPO / ".agents" / "skills"
OPT_IN_ENV = "AI_JOB_SEARCH_ALLOW_RESTRICTED"
ERROR_CODE = "RESTRICTED_PORTAL_NOT_ENABLED"
GATE_FN = "assertRestrictedOptIn"

VALID_RESTRICTIONS = {"robots-disallowed", "tos-prohibited", "anti-bot"}


def frontmatter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 4)
    if end == -1:
        return {}
    data = yaml.safe_load(text[4:end])
    return data if isinstance(data, dict) else {}


def portal_skills():
    if not AGENT_SKILLS.is_dir():
        return []
    return sorted(p for p in AGENT_SKILLS.glob("*/SKILL.md"))


def restricted_skills():
    return [p for p in portal_skills() if frontmatter(p).get("access") == "restricted"]


class RestrictedSkillsDeclareTheTierProperly(unittest.TestCase):
    def test_access_key_is_a_known_tier(self):
        for skill in portal_skills():
            access = frontmatter(skill).get("access", "open")
            with self.subTest(skill=skill.parent.name):
                self.assertIn(
                    access,
                    {"open", "restricted"},
                    f"{skill.parent.name}: 'access' must be 'open' or 'restricted', got {access!r}",
                )

    def test_restricted_skills_ship_disabled(self):
        for skill in restricted_skills():
            with self.subTest(skill=skill.parent.name):
                self.assertIs(
                    frontmatter(skill).get("enabled"),
                    False,
                    f"{skill.parent.name}: a restricted portal must also ship 'enabled: false' - "
                    "the two gates are independent on purpose",
                )

    def test_restricted_skills_name_their_reason(self):
        for skill in restricted_skills():
            reason = frontmatter(skill).get("restriction")
            with self.subTest(skill=skill.parent.name):
                self.assertIn(
                    reason,
                    VALID_RESTRICTIONS,
                    f"{skill.parent.name}: 'restriction' must say why access is limited, "
                    f"one of {sorted(VALID_RESTRICTIONS)}; got {reason!r}",
                )

    def test_restricted_skills_name_the_opt_in_variable(self):
        for skill in restricted_skills():
            with self.subTest(skill=skill.parent.name):
                self.assertEqual(
                    frontmatter(skill).get("opt-in"),
                    OPT_IN_ENV,
                    f"{skill.parent.name}: 'opt-in' must name {OPT_IN_ENV} so the gate is "
                    "discoverable from the skill file alone",
                )

    def test_restricted_skills_carry_a_personal_use_warning(self):
        for skill in restricted_skills():
            body = skill.read_text(encoding="utf-8").lower()
            with self.subTest(skill=skill.parent.name):
                self.assertIn(
                    "personal use",
                    body,
                    f"{skill.parent.name}: a restricted portal must carry a visible "
                    "personal-use-only warning, as /add-portal requires",
                )


class RestrictedClisEnforceTheGateThemselves(unittest.TestCase):
    """Frontmatter governs what Claude does; only the CLI stops a direct invocation."""

    def _cli_src(self, skill: Path) -> Path:
        return skill.parent / "cli" / "src"

    def test_helpers_define_the_gate(self):
        for skill in restricted_skills():
            helpers = self._cli_src(skill) / "helpers.ts"
            with self.subTest(skill=skill.parent.name):
                self.assertTrue(helpers.is_file(), f"{skill.parent.name}: cli/src/helpers.ts is missing")
                text = helpers.read_text(encoding="utf-8")
                self.assertIn(
                    GATE_FN, text, f"{skill.parent.name}: helpers.ts must define {GATE_FN}()"
                )
                self.assertIn(
                    OPT_IN_ENV,
                    text,
                    f"{skill.parent.name}: the gate must read {OPT_IN_ENV} from the environment",
                )
                self.assertIn(
                    ERROR_CODE,
                    text,
                    f"{skill.parent.name}: refusing must use the {ERROR_CODE} error code",
                )

    def test_every_command_calls_the_gate(self):
        for skill in restricted_skills():
            commands = self._cli_src(skill) / "commands"
            with self.subTest(skill=skill.parent.name):
                self.assertTrue(commands.is_dir(), f"{skill.parent.name}: cli/src/commands/ is missing")
                for cmd in sorted(commands.glob("*.ts")):
                    self.assertIn(
                        GATE_FN,
                        cmd.read_text(encoding="utf-8"),
                        f"{skill.parent.name}/{cmd.name}: every command of a restricted portal "
                        f"must call {GATE_FN}() before doing any network work",
                    )

    def test_gate_checks_for_the_explicit_opt_in_value(self):
        """An unset variable must refuse; only the literal "1" may let it through."""
        for skill in restricted_skills():
            helpers = (self._cli_src(skill) / "helpers.ts").read_text(encoding="utf-8")
            with self.subTest(skill=skill.parent.name):
                self.assertRegex(
                    helpers,
                    re.compile(rf"{OPT_IN_ENV}\s*\]?\s*!==\s*[\"']1[\"']"),
                    f"{skill.parent.name}: the gate must compare {OPT_IN_ENV} against \"1\" "
                    "explicitly - a truthiness check lets 'no'/'false'/'0' through",
                )


class TheMechanismStaysDocumented(unittest.TestCase):
    """Vacuous skill assertions above are only safe while the contract is written down."""

    def test_scrape_honors_the_tier(self):
        text = (REPO / ".claude" / "skills" / "job-scraper" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("access: restricted", text, "/scrape must document the restricted tier")
        self.assertIn(OPT_IN_ENV, text, f"/scrape must name {OPT_IN_ENV}")

    def test_add_portal_scaffolds_the_tier(self):
        text = (REPO / ".claude" / "commands" / "add-portal.md").read_text(encoding="utf-8")
        self.assertIn(OPT_IN_ENV, text, f"/add-portal must name {OPT_IN_ENV}")
        self.assertIn(ERROR_CODE, text, f"/add-portal must specify the {ERROR_CODE} error code")

    def test_fork_doc_explains_the_tier(self):
        text = (REPO / "FORK.md").read_text(encoding="utf-8")
        self.assertIn(OPT_IN_ENV, text, f"FORK.md must name {OPT_IN_ENV}")


if __name__ == "__main__":
    unittest.main()
