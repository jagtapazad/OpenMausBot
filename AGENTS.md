# OpenMausBot agent notes

Before claiming a server or conversation change works, follow
[`docs/verification/README.md`](docs/verification/README.md). Always launch an
isolated fixture; never verify mutations against the user's live app or data.

UI changes follow [`DESIGN.md`](DESIGN.md).

## Comments

Write a comment only for what the code cannot say:

- a license or attribution notice;
- a fact forced by something outside this code (a vendor, CLI, OS, browser,
  Electron or protocol behaviour), with its version when it has one;
- the doc comment of a public contract: the wire types in `shared/`, the
  driver interface, the preload bridge, `config.json` fields people edit;
- a link to an upstream issue;
- a security invariant or a known open risk.

Do not narrate what the next line does, restate a name, record history ("used
to", "no longer", PR or issue numbers, plan or slice names: git has it), point
at other files, draw banners or leave commented-out code. When our own code
needs a paragraph to explain a surprise, change the code instead: a better
name, a type, an extracted function, one shared helper. A rule ("never X",
"must match Y") belongs in a type, a test or a lint rule. Never suppress a lint
rule that guards correctness; fix the code.

More specific `AGENTS.md` files override this note within their directories.

## This fork

This is `jagtapazad/OpenMausBot`, a fork of `milind-soni/OpenMausBot` that adds
Jaya (`server/jaya/`, `src/components/jaya/`): outcome agents, phone calls and
a gig worker backstop. Follow `.claude/skills/fork-workflow` for git and pull
requests, and `.claude/skills/jaya-security` for any Jaya change.

- Pull requests go to `jagtapazad/OpenMausBot` only. Never push, open a pull
  request or publish anything to `milind-soni/OpenMausBot` or its release,
  npm, image or update channels.
- The release, publish and image workflows are disabled in this fork's
  Actions settings; leave the workflow files as upstream has them so syncs
  merge cleanly.
- The product name is Jaya. "OpenMausBot" and "MausBot" are trademarks of
  their owner; do not use them as this fork's product name.
